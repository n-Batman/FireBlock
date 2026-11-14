import copy
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds

from fireblock_analysis.risk import build_risk, grid, score_features, validate_risk
from fireblock_analysis.pipeline import run
from fireblock_analysis.prediction import build_prediction
from fireblock_analysis.controller import ParserController


class RiskTests(unittest.TestCase):
    bbox = [0, 0, .02, .02]
    options = {"enabled": True, "as_of": "2026-11-13T12:00:00Z", "cell_km": 1.2,
               "hotspot_radius_km": .3, "min_valid_fraction": .6}

    def scene(self, root, identity="scene", stamp="2026-11-12T12:00:00Z"):
        folder = root / identity
        folder.mkdir()
        for name in ("ndvi", "ndmi"):
            array = np.full((32, 32), .8 if name == "ndvi" else .4, dtype="float32")
            if name == "ndmi":
                array[:16, :16] = -.4
            array[:16, 16:] = -9999
            with rasterio.open(folder / f"{name}.tif", "w", driver="GTiff", count=1,
                    width=32, height=32, dtype="float32", nodata=-9999, crs="EPSG:4326",
                    transform=from_bounds(*self.bbox, 32, 32)) as out:
                out.write(array, 1)
        return {"id": identity, "acquired_at": stamp, "indices": {
            name: {"raster": f"{name}.tif"} for name in ("ndvi", "ndmi")}}

    def detection(self, stamp="2026-11-13T12:00:00Z", confidence="high"):
        return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [.005, .015]},
            "properties": {"acquired_at": stamp, "confidence": {"kind": "viirs_category", "value": confidence},
                "frp_mw": 20, "attributes": {"satellite": "N20", "instrument": "VIIRS"}}}

    def test_scores_are_bounded_and_monotonic(self):
        ndvi = np.array([.8, .8, .8, .2])
        ndmi = np.array([.4, -.4, -.4, -.4])
        scores, _, _ = score_features(ndvi, ndmi, np.array([0, 0, 1, 1]), {})
        np.testing.assert_allclose(scores, [0, 70, 100, 0])

    def test_map_raster_masks_time_and_hotspots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = {"scenes": [self.scene(root)], "firms": [{"id": "fires"}]}
            (root / "fires").mkdir()
            observations = [self.detection(), self.detection(), self.detection(confidence="low"),
                self.detection("2026-11-14T12:00:00Z"), self.detection("2026-11-01T12:00:00Z")]
            (root / "fires/detections.ndjson").write_text("\n".join(json.dumps(f) for f in observations))
            summary = build_risk(manifest, root, self.options, self.bbox)
            self.assertEqual((summary["rows"], summary["columns"], summary["known_cells"]), (2, 2, 3))
            self.assertEqual(summary["recent_detections"], 1)
            self.assertEqual(summary["ignored_detections"], {"future": 1, "stale": 1, "low_confidence": 1, "duplicates": 1})
            features = [json.loads(line) for line in (root / "risk/features.ndjson").read_text().splitlines()]
            scores = [f["properties"]["risk_score"] for f in features]
            self.assertAlmostEqual(scores[0], 100, places=4)
            self.assertIsNone(scores[1])
            self.assertAlmostEqual(scores[2], 0, places=4)
            with rasterio.open(root / "risk/risk_score.tif") as raster:
                self.assertEqual(str(raster.crs), "EPSG:4326")
                self.assertEqual(raster.read(1)[0, 1], -9999)
            page = (root / "risk/risk_map.html").read_text(encoding="utf-8")
            self.assertIn("Experimental index", page)
            self.assertNotIn("__DATA__", page)
            self.assertFalse(summary["prediction_available"])

    def test_stale_unknown_and_newest_scene_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = {"scenes": [self.scene(root, "old", "2026-10-01T00:00:00Z"),
                self.scene(root, "future", "2026-11-14T00:00:00Z"), self.scene(root, "missing", None)]}
            summary = build_risk(manifest, root, self.options, self.bbox)
            self.assertEqual(summary["known_cells"], 0)
            self.assertTrue(all(f["properties"]["risk_score"] is None for f in
                map(json.loads, (root / "risk/features.ndjson").read_text().splitlines())))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenes = [self.scene(root, "older", "2026-11-11T00:00:00Z"), self.scene(root, "newer")]
            build_risk({"scenes": scenes}, root, self.options, self.bbox)
            known = [json.loads(line)["properties"] for line in (root / "risk/features.ndjson").read_text().splitlines()]
            self.assertEqual({p["scene_id"] for p in known if p["risk_score"] is not None}, {"newer"})

    def test_config_rejects_resource_and_time_errors(self):
        for changes in ({"as_of": "2026-11-13"}, {"cell_km": 0}, {"max_cells": 1},
                {"dryness_weight": 0, "hotspot_weight": 0}, {"samples_per_cell": 100}):
            with self.assertRaises((ValueError, KeyError)):
                validate_risk({**self.options, **changes}, self.bbox)
        self.assertEqual(grid(self.bbox, self.options), (2, 2))

    def test_cloud_discovery_loads_version_pinned_scene_time(self):
        class Storage:
            def list_objects(self, prefix):
                return [{"fileName": "raw/b/copernicus/p/product.zip", "fileId": "zip-v1"},
                        {"fileName": "raw/b/copernicus/p/metadata.json", "fileId": "metadata-v1"}]
            def download_version(self, identity, path):
                if identity != "metadata-v1":
                    raise AssertionError("Only acquisition metadata should be fetched during discovery")
                Path(path).write_text(json.dumps({"ContentDate": {"Start": "2026-11-12T12:00:00Z"}}))
        resolved = ParserController(Storage()).discover({"storage": {}, "source": {"prefix": "raw/"},
            "bbox": self.bbox, "risk": self.options})
        self.assertEqual(resolved["scenes"][0]["acquired_at"], "2026-11-12T12:00:00Z")
        self.assertEqual(resolved["scenes"][0]["archive"], {"file_id": "zip-v1"})
        self.assertEqual(resolved["discovery"]["scene_time_sources"][0]["file_id"], "metadata-v1")

    def test_analysis_pipeline_generates_and_uploads_map_before_manifest(self):
        class Backend:
            uploads = []
            def download(self, key, destination):
                Path(destination).write_text("latitude,longitude,acq_date,acq_time\n.015,.005,2026-11-13,1200\n")
            def upload(self, path, key):
                self.uploads.append(key)
                return {"key": key, "file_id": str(len(self.uploads))}
        with tempfile.TemporaryDirectory() as tmp:
            backend = Backend()
            result = run({"output_root": tmp, "bbox": self.bbox, "risk": self.options,
                "storage": {}, "firms": [{"id": "fires", "input": {"key": "raw/fires.csv"}}]}, backend)
            manifest = json.loads(result.read_text())
            self.assertEqual(manifest["status"], "complete")
            self.assertEqual(manifest["risk"]["known_cells"], 0)
            self.assertTrue(any(key.endswith("/risk/risk_map.html") for key in backend.uploads))
            self.assertTrue(backend.uploads[-1].endswith("/manifest.json"))

    def test_future_model_interface_validates_provenance_and_unknowns(self):
        class Model:
            model_id = "unit-test-model-only"
            feature_schema = "fireblock.risk-features.v1"
            trained_until = "2026-11-01T00:00:00Z"
            horizon_hours = 24
            target_definition = "test event within cell during forecast window"
            def predict(self, features):
                return [.25] * len(features)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_risk({"scenes": [self.scene(root)]}, root, self.options, self.bbox)
            path = root / "risk/features.ndjson"
            result = build_prediction(path, Model(), root / "prediction.geojson")
            values = [f["properties"]["fire_probability"] for f in result["features"]]
            self.assertEqual(values, [.25, None, .25, .25])
            model = Model()
            model.trained_until = "2026-11-14T00:00:00Z"
            with self.assertRaises(ValueError):
                build_prediction(path, model, root / "bad.geojson")
            model = Model()
            model.predict = lambda features: [float("nan")] * len(features)
            with self.assertRaises(ValueError):
                build_prediction(path, model, root / "bad.geojson")


if __name__ == "__main__":
    unittest.main()
