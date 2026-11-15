import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from fireblock_analysis.risk_model import MathematicalRiskModel, evaluate_model
from fireblock_analysis.weather import timestamp, weather_features
from fireblock_analysis.pipeline import run


class WeatherTests(unittest.TestCase):
    record = {"bbox": [0, 0, 2, 1], "source": "test forecast",
        "issued_at": "2026-11-13T11:00:00Z", "valid_from": "2026-11-13T12:00:00Z",
        "valid_to": "2026-11-13T13:00:00Z", "wind_mph": 30, "humidity_pct": 10, "temperature_c": 40}

    def features(self, records):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weather.json"
            path.write_text(json.dumps({"schema": "fireblock.weather.v1", "records": records}))
            return weather_features(path, np.array([[.5, 1.5]]), np.array([[.5, .5]]),
                1, 1, timestamp("2026-11-13T12:00:00Z"))

    def test_full_cell_coverage_and_newest_forecast_win(self):
        pressure, records = self.features([self.record,
            {**self.record, "bbox": [0, 0, 1, 1], "issued_at": "2026-11-13T12:00:00Z", "wind_mph": 0}])
        np.testing.assert_allclose(pressure, [[.5, 1]])
        self.assertEqual(records[0, 0]["wind_mph"], 0)
        pressure, _ = self.features([{**self.record, "bbox": [.1, 0, 2, 1]}])
        self.assertTrue(np.isnan(pressure[0, 0]))
        self.assertEqual(pressure[0, 1], 1)

    def test_missing_stale_future_expired_and_partial_weather_are_unavailable(self):
        for change in ({"issued_at": "2026-11-13T05:59:59Z"},
                {"issued_at": "2026-11-13T12:00:01Z"}, {"valid_from": "2026-11-13T11:00:00Z", "valid_to": "2026-11-13T12:00:00Z"},
                {"valid_from": "2026-11-13T12:00:01Z"}, {"humidity_pct": None}):
            with self.subTest(change=change):
                pressure, records = self.features([{**self.record, **change}])
                self.assertTrue(np.isnan(pressure).all())
                self.assertTrue(all(record is None for record in records.flat))
        pressure, _ = self.features([])
        self.assertTrue(np.isnan(pressure).all())

    def test_invalid_measurements_and_timezones_fail(self):
        for change in ({"wind_mph": -1}, {"humidity_pct": 101}, {"temperature_c": float("nan")},
                {"issued_at": "2026-11-13T11:00:00"}, {"bbox": [0, 0, 0, 1]}, {"source": ""}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.features([{**self.record, **change}])

    def test_weather_blend_bounds_monotonicity_and_unknown_imagery(self):
        model = MathematicalRiskModel()
        base = {"ndvi": np.array([.8, .8, .8, .8, .2, np.nan]),
            "ndmi": np.full(6, -.4), "hotspot_pressure": np.zeros(6),
            "weather_pressure": np.array([0, .5, 1, np.nan, 1, 1])}
        np.testing.assert_allclose(evaluate_model(model, base, {})[:5], [49, 64, 79, 70, 0])
        self.assertTrue(np.isnan(evaluate_model(model, base, {})[-1]))
        np.testing.assert_allclose(evaluate_model(model, base, {"weather_weight": 0})[:4], [70]*4)
        for weight in (-.1, 1.1, float("nan"), True):
            with self.assertRaises(ValueError):
                evaluate_model(model, base, {"weather_weight": weight})
        for field, calm, severe in (("wind_mph", 0, 30), ("humidity_pct", 60, 10), ("temperature_c", 15, 40)):
            low, _ = self.features([{**self.record, field: calm}])
            high, _ = self.features([{**self.record, field: severe}])
            self.assertTrue((high > low).all())

    def test_pipeline_materializes_and_hashes_weather_input(self):
        class Storage:
            def download_version(self, identity, path):
                if identity == "weather-version":
                    Path(path).write_text(json.dumps({"schema": "fireblock.weather.v1", "records": [WeatherTests.record]}))
                else:
                    Path(path).write_text("latitude,longitude,acq_date,acq_time\n0.005,0.005,2026-11-13,1000\n")
        with tempfile.TemporaryDirectory() as tmp:
            config = {"output_root": tmp, "storage": {"upload_results": False, "local_retention": "keep"},
                "bbox": [0, 0, .01, .01], "risk": {"enabled": True, "as_of": "2026-11-13T12:00:00Z"},
                "weather": {"file_id": "weather-version"}, "firms": [{"id": "fires", "input": {"file_id": "fires-version"}}]}
            result = run(config, Storage())
            manifest = json.loads(Path(result).read_text())
            self.assertEqual(len(manifest["inputs"]), 2)
            self.assertEqual(manifest["inputs"][1]["file_id"], "weather-version")
            self.assertEqual(len(manifest["inputs"][1]["sha256"]), 64)
            features = json.loads((Path(result).parent / "risk/risk_map.geojson").read_text())["features"]
            cell = features[0]["properties"]
            self.assertEqual(cell["weather_pressure"], 1)
            self.assertEqual(cell["weather"]["source"], "test forecast")
            self.assertIsNone(cell["risk_score"])  # Weather cannot manufacture imagery.
            self.assertEqual(manifest["risk"]["model_id"], "fireblock-relative-risk-v2")


if __name__ == "__main__":
    unittest.main()
