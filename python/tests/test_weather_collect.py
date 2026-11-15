import copy
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from fireblock_analysis.weather import polygon_coverage, timestamp
from fireblock_analysis.weather_collect import BASE, collect_weather, nws_url, sample_points, wind_mph


class WeatherCollectionTests(unittest.TestCase):
    def setUp(self):
        self.now = timestamp("2026-11-14T12:30:00Z")
        self.bbox = [0, 0, .03, .01]
        self.url = BASE + "/gridpoints/LOX/1,2/forecast/hourly"
        self.forecast = {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [.03, 0], [.03, .01], [0, .01], [0, 0]]]},
            "properties": {"updateTime": "2026-11-14T12:00:00Z", "periods": [{
                "startTime": "2026-11-14T12:00:00Z", "endTime": "2026-11-14T13:00:00Z",
                "temperature": 86, "temperatureUnit": "F", "windSpeed": "10 to 20 mph",
                "relativeHumidity": {"value": 25}}]}}

    def test_normalizes_current_hour_units_and_deduplicates_forecast_requests(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return self.forecast if url == self.url else {"properties": {"forecastHourly": self.url}}
        with tempfile.TemporaryDirectory() as tmp:
            path = collect_weather(self.bbox, {}, Path(tmp) / "weather", self.now, fetch=fetch)
            record = json.loads(path.read_text())["records"][0]
            self.assertEqual(record["wind_mph"], 20)
            self.assertEqual(record["temperature_c"], 30)
            self.assertEqual(record["humidity_pct"], 25)
            self.assertEqual(record["coverage_polygon"], self.forecast["geometry"]["coordinates"][0])
            self.assertEqual(calls.count(self.url), 1)
            self.assertEqual(len(calls), 3)  # Two location samples, one shared forecast.

    def test_stale_missing_and_future_weather_fail_collection(self):
        for mode in ("stale", "future", "missing", "expired"):
            forecast = copy.deepcopy(self.forecast)
            if mode == "stale":
                forecast["properties"]["updateTime"] = "2026-11-14T01:00:00Z"
            elif mode == "future":
                forecast["properties"]["updateTime"] = "2026-11-14T13:00:00Z"
            elif mode == "missing":
                forecast["properties"]["periods"][0]["relativeHumidity"]["value"] = None
            else:
                forecast["properties"]["periods"][0]["endTime"] = "2026-11-14T12:00:00Z"
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
                collect_weather(self.bbox, {}, Path(tmp) / "weather", self.now,
                    fetch=lambda url: forecast if url == self.url else {"properties": {"forecastHourly": self.url}})

    def test_provider_urls_cannot_leave_nws_or_add_queries(self):
        for url in ("http://api.weather.gov/points/1,2", "https://evil.test/points/1,2",
                self.url + "?token=private", "https://api.weather.gov@evil.test/points/1,2"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                nws_url(url)
        self.assertEqual(nws_url(self.url), self.url)

    def test_sample_limits_fail_before_network(self):
        with self.assertRaises(ValueError):
            sample_points([-122, 35, -120, 37], {"max_points": 1})
        self.assertEqual(len(sample_points([0, 0, .001, .001], {})), 1)

    def test_rotated_forecasts_do_not_score_cells_only_inside_their_bbox(self):
        diamond = [[1, 0], [2, 1], [1, 2], [0, 1], [1, 0]]
        for ring in (diamond, diamond[::-1]):
            mask = polygon_coverage(ring, np.array([1., .2]), np.array([1., .2]), .2, .2)
            np.testing.assert_array_equal(mask, [True, False])
        with self.assertRaises(ValueError):
            polygon_coverage([[0, 0], [2, 0], [.5, .5], [0, 2], [0, 0]], np.array([1]), np.array([1]), .2, .2)

    def test_wind_range_and_quantitative_units(self):
        self.assertEqual(wind_mph("5 to 20 mph"), 20)
        self.assertAlmostEqual(wind_mph({"value": 16.09344, "unitCode": "wmoUnit:km_h-1"}), 10)
        self.assertAlmostEqual(wind_mph({"value": 10, "unitCode": "wmoUnit:m_s-1"}), 22.369362921)
        self.assertIsNone(wind_mph("unknown"))
        self.assertIsNone(wind_mph({"value": 10, "unitCode": "unknown"}))


if __name__ == "__main__":
    unittest.main()
