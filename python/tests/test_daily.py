import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fireblock_analysis.daily import daily_lock, run_daily, validate_daily, watch_daily
from fireblock_analysis.bridge import Backend
from fireblock_analysis.pipeline import run, write_json


class Storage:
    def __init__(self):
        self.ingests, self.uploads = [], []
        self.fail = False

    def ingest(self, path, environment=None):
        if self.fail:
            raise RuntimeError("provider unavailable")
        config = json.loads(Path(path).read_text())
        self.ingests.append(config)
        root = Path(config["output"]) / "firms"
        root.mkdir(parents=True)
        for source in config["firms"]["sources"]:
            (root / (source + ".csv")).write_text("latitude,longitude,acq_date,acq_time\n0.005,0.005,2026-11-14,1000\n")

    def upload(self, path, key):
        self.uploads.append((key, Path(path).read_bytes()))
        return {"key": key, "file_id": "version-" + str(len(self.uploads)), "verified": True}


class DailyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
        self.storage = Storage()
        self.jobs = []
        self.job = {"storage": {"upload_results": True, "publish_frontend": True, "local_retention": "keep"},
            "output_root": str(self.root / "analysis"), "bbox": [0, 0, .01, .01],
            "risk": {"enabled": True, "as_of": self.now.isoformat()},
            "firms": [{"id": "old", "input": {"file_id": "old-fires"}}]}
        self.job_path = self.root / "job.json"
        write_json(self.job_path, self.job)
        self.config = {"analysis_job": str(self.job_path), "state_dir": str(self.root / "state"),
            "firms": {"sources": ["VIIRS_NOAA20_NRT"]}, "satellite": {"enabled": False}}

    def weather(self, bbox, options, destination, as_of):
        destination.mkdir()
        path = destination / "snapshot.json"
        write_json(path, {"schema": "fireblock.weather.v1", "records": [{"bbox": bbox, "source": "test",
            "issued_at": as_of.isoformat(), "valid_from": as_of.isoformat(),
            "valid_to": (as_of+timedelta(hours=1)).isoformat(), "wind_mph": 15, "humidity_pct": 30, "temperature_c": 28}]})
        return path

    def analyze(self, job, storage):
        self.jobs.append(job)
        path = self.root / "completed.json"
        write_json(path, {"status": "complete"})
        return path

    def execute(self, **kwargs):
        return run_daily(self.config, backend=self.storage, clock=lambda: self.now,
            weather_collector=self.weather, analyzer=kwargs.pop("analyzer", self.analyze), **kwargs)

    def test_persisted_24_hour_gate_and_rolling_firms_dates(self):
        self.assertIsNotNone(self.execute())
        self.assertIsNone(self.execute())
        self.now += timedelta(hours=23, minutes=59)
        self.assertIsNone(self.execute())
        self.now += timedelta(minutes=1)
        self.assertIsNotNone(self.execute())
        self.assertEqual(len(self.storage.ingests), 2)
        self.assertEqual(self.storage.ingests[0]["start"], "2026-11-11")
        self.assertEqual(self.storage.ingests[0]["end"], "2026-11-15")
        self.assertEqual(self.storage.ingests[1]["start"], "2026-11-12")
        self.assertEqual(self.jobs[1]["risk"]["as_of"], self.now.isoformat())

    def test_force_fetches_before_due_and_new_firms_replace_old_inputs(self):
        self.execute()
        self.execute(force=True)
        self.assertEqual(len(self.jobs), 2)
        self.assertTrue(all("local" in source["input"] for source in self.jobs[-1]["firms"]))
        self.assertNotIn("old", [source["id"] for source in self.jobs[-1]["firms"]])
        self.assertIn("local", self.jobs[-1]["weather"])

    def test_failures_keep_success_unset_and_retry_after_one_hour(self):
        self.storage.fail = True
        with self.assertRaises(RuntimeError):
            self.execute()
        state = json.loads((self.root / "state/state.json").read_text())
        self.assertNotIn("last_success_at", state)
        self.assertEqual(state["error_type"], "RuntimeError")
        self.storage.fail = False
        self.now += timedelta(minutes=59)
        self.assertIsNone(self.execute())
        self.now += timedelta(minutes=1)
        self.assertIsNotNone(self.execute())
        state = json.loads((self.root / "state/state.json").read_text())
        self.assertNotIn("last_failure_at", state)

    def test_failed_analysis_does_not_advance_success(self):
        def fail(job, storage):
            raise RuntimeError("analysis unavailable")
        with self.assertRaises(RuntimeError):
            self.execute(analyzer=fail)
        self.assertNotIn("last_success_at", json.loads((self.root / "state/state.json").read_text()))

    def test_weather_failure_does_not_start_analysis_or_advance_success(self):
        def unavailable(*args):
            raise RuntimeError("weather unavailable")
        with self.assertRaises(RuntimeError):
            run_daily(self.config, backend=self.storage, clock=lambda: self.now,
                weather_collector=unavailable, analyzer=self.analyze)
        self.assertEqual(len(self.storage.ingests), 1)
        self.assertEqual(self.jobs, [])
        self.assertNotIn("last_success_at", json.loads((self.root / "state/state.json").read_text()))

    def test_cloud_discovery_is_only_called_when_due_and_keeps_existing_scenes(self):
        scenes = [{"id": "stored_scene", "archive": {"file_id": "stored-version"}}]
        write_json(self.job_path, {**self.job, "source": {"manifest_file_id": "existing-batch"}})
        with patch("fireblock_analysis.daily.ParserController.discover", return_value={**self.job, "scenes": scenes}) as discover:
            self.execute()
            self.execute()
        self.assertEqual(discover.call_count, 1)
        self.assertEqual(self.jobs[0]["scenes"], scenes)

    def test_native_firms_credentials_are_passed_in_environment_not_arguments(self):
        environment = {"FIRMS_MAP_KEY": "test-secret"}
        with patch.object(Backend, "execute") as execute:
            Backend({}).ingest("daily-ingest.json", environment=environment)
        self.assertEqual(execute.call_args.kwargs["environment"], environment)
        self.assertNotIn("test-secret", " ".join(execute.call_args.args[0]))

    def test_lock_blocks_overlap_and_releases_for_restart(self):
        root = self.root / "state"
        root.mkdir()
        with daily_lock(root / "daily.lock"):
            with self.assertRaises(RuntimeError):
                self.execute(force=True)
        self.assertIsNotNone(self.execute())

    def test_satellite_hook_reuses_stored_scenes_without_scraping(self):
        scenes = [{"id": "stored_scene", "archive": {"file_id": "stored-archive"}, "acquired_at": self.now.isoformat()}]
        write_json(self.job_path, {**self.job, "scenes": scenes})
        self.execute()
        self.assertEqual(self.jobs[0]["scenes"], scenes)
        self.assertEqual(self.storage.ingests[0]["copernicus"], {"enabled": False})
        with self.assertRaises(ValueError):
            validate_daily({**self.config, "satellite": {"enabled": True}})

    def test_actual_pipeline_archives_inputs_and_publishes_completed_grid(self):
        result = self.execute(analyzer=run)
        manifest = json.loads(result.read_text())
        self.assertEqual(manifest["status"], "complete")
        self.assertEqual(len(manifest["inputs"]), 2)
        self.assertTrue(all(item["storage"]["verified"] for item in manifest["inputs"]))
        self.assertEqual(manifest["risk"]["model_id"], "fireblock-relative-risk-v2")
        self.assertEqual(self.storage.uploads[-2][0], "risk/latest.json")
        self.assertTrue(self.storage.uploads[-1][0].startswith("risk/catalog/"))

    def test_invalid_settings_fail_before_collection(self):
        for change in ({"firms": {"sources": []}}, {"firms": {"sources": ["MODIS_NRT"], "days": 6}},
                {"weather": {"sample_km": 0}}, {"state_dir": ""}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                run_daily({**self.config, **change}, backend=self.storage)
        self.assertEqual(self.storage.ingests, [])

    def test_watch_checks_every_minute_and_does_not_log_provider_secrets(self):
        output = io.StringIO()
        with patch("fireblock_analysis.daily.run_daily", side_effect=[RuntimeError("secret-url"), Path("manifest.json")]) as execute, \
                patch("fireblock_analysis.daily.time.sleep", side_effect=[None, KeyboardInterrupt]) as sleep, redirect_stdout(output):
            with self.assertRaises(KeyboardInterrupt):
                watch_daily(self.config)
        self.assertEqual(execute.call_count, 2)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [60, 60])
        self.assertNotIn("secret-url", output.getvalue())


if __name__ == "__main__":
    unittest.main()
