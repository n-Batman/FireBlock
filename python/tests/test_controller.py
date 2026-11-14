import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fireblock_analysis.bridge import Backend
from fireblock_analysis.controller import ParserController
from fireblock_analysis.pipeline import run


CSV = b"latitude,longitude,acq_date,acq_time,confidence,frp\n38,-122,2024-01-01,1200,n,5\n"


class Storage:
    def __init__(self):
        self.downloads, self.uploads = [], []
        self.objects = [{"fileName": "raw/batch/firms/fires.csv", "fileId": "csv-v1"},
                        {"fileName": "raw/batch/copernicus/p/quicklook.image", "fileId": "preview"},
                        {"fileName": "tests/smoke/random.png", "fileId": "png"}]
        self.data = {"csv-v1": CSV}

    def list_objects(self, prefix, max_files=10000):
        return [obj for obj in self.objects if obj["fileName"].startswith(prefix)]

    def download_version(self, identity, path):
        self.downloads.append(identity)
        Path(path).write_bytes(self.data[identity])

    def upload(self, path, key):
        self.uploads.append(key)
        return {"key": key, "file_id": "uploaded-v1"}

    def add_manifest(self, status="complete", checksum=None):
        manifest = {"schema_version": 1, "kind": "fireblock.raw", "status": status,
                    "prefix": "raw/batch/", "files": [{"path": "firms/fires.csv",
                    "key": "raw/batch/firms/fires.csv", "file_id": "csv-v1", "bytes": len(CSV),
                    "sha1": checksum or hashlib.sha1(CSV).hexdigest()}]}
        self.data["manifest-v1"] = json.dumps(manifest).encode()
        self.objects.append({"fileName": "raw/batch/manifest.json", "fileId": "manifest-v1"})


class CloudControllerTests(unittest.TestCase):
    def test_discovery_pins_versions_and_ignores_previews(self):
        storage = Storage()
        storage.objects.append({"fileName": "raw/batch/copernicus/p/product.zip", "fileId": "zip-v1"})
        job = ParserController(storage).discover({"storage": {}, "source": {"prefix": "raw/"}})
        self.assertEqual(job["scenes"][0]["archive"], {"file_id": "zip-v1"})
        self.assertEqual(job["firms"][0]["input"], {"file_id": "csv-v1"})
        self.assertEqual(job["discovery"]["ignored"], 1)
        self.assertEqual(storage.downloads, [])

    def test_manifest_round_trip_uses_snapshot_and_publishes_last(self):
        storage = Storage()
        storage.add_manifest()
        # This loose file is an incomplete newer publication, and must be ignored.
        storage.objects.append({"fileName": "raw/incomplete/firms/new.csv", "fileId": "not-ready"})
        with tempfile.TemporaryDirectory() as tmp:
            config = {"storage": {}, "output_root": tmp, "source": {"prefix": "raw/"}}
            manifest_path = ParserController(storage).run(config)
            result = json.loads(manifest_path.read_text())
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["firms"][0]["accepted"], 1)
            self.assertEqual(storage.downloads, ["manifest-v1", "csv-v1"])
            self.assertTrue(storage.uploads[-1].endswith("/manifest.json"))
            self.assertEqual(result["inputs"][0]["file_id"], "csv-v1")

    def test_manifest_id_and_integrity_failure(self):
        storage = Storage()
        storage.add_manifest(checksum="0" * 40)
        with tempfile.TemporaryDirectory() as tmp:
            config = {"storage": {}, "output_root": tmp, "source": {"manifest_file_id": "manifest-v1"}}
            with self.assertRaisesRegex(ValueError, "does not match"):
                ParserController(storage).run(config)
            self.assertEqual(storage.uploads, [])

    def test_incomplete_manifest_and_random_images_are_rejected(self):
        storage = Storage()
        storage.add_manifest(status="uploading")
        with self.assertRaisesRegex(ValueError, "completed"):
            ParserController(storage).discover({"storage": {}, "source": {"manifest_file_id": "manifest-v1"}})
        with self.assertRaisesRegex(ValueError, "No supported"):
            ParserController(storage).discover({"storage": {}, "source": {"prefix": "tests/"}})

    def test_limit_and_source_validation(self):
        storage = Storage()
        storage.objects.append({"fileName": "raw/firms/second.csv", "fileId": "csv-v2"})
        with self.assertRaisesRegex(ValueError, "max_inputs"):
            ParserController(storage).discover({"storage": {}, "source": {"prefix": "raw/"}, "max_inputs": 1})
        for source in ({}, {"prefix": ""}, {"prefix": "raw/", "manifest_file_id": "id"}):
            with self.assertRaises(ValueError):
                ParserController.validate({"storage": {}, "source": source})

    def test_adapter_version_download_does_not_pass_bucket_option(self):
        backend = Backend({"bucket": "FireBlock"})
        with patch.object(backend, "execute", return_value='{"downloaded":"out"}') as call:
            backend.download_version("version", "out")
            args = call.call_args.args[0]
            self.assertEqual(args[1:4], ["download-version", "version", "out"])
            self.assertNotIn("--bucket", args)

    def test_discovery_limits_listing_before_loading_manifests(self):
        storage = Storage()
        storage.add_manifest()
        with patch.object(storage, "list_objects", wraps=storage.list_objects) as listing:
            with self.assertRaisesRegex(ValueError, "max_discovery_entries"):
                ParserController(storage).discover({"storage": {}, "source": {"prefix": "raw/"},
                                                   "max_discovery_entries": 1})
            listing.assert_called_once_with("raw/", max_files=1)
        self.assertEqual(storage.downloads, [])

    def test_manifest_limits_are_cumulative_and_stop_further_downloads(self):
        storage = Storage()
        storage.add_manifest()
        original = json.loads(storage.data["manifest-v1"])
        for i in range(2, 5):
            identity = f"manifest-v{i}"
            manifest = {**original, "prefix": f"raw/batch{i}/", "files": [
                {**original["files"][0], "key": f"raw/batch{i}/firms/fires.csv", "file_id": f"csv-v{i}"}]}
            storage.data[identity] = json.dumps(manifest).encode()
        controller = ParserController(storage)
        # The listing itself is bounded separately; inject just the identities
        # to exercise the aggregate inventory budget across multiple manifests.
        storage.objects = [{"fileName": f"raw/batch{i}/manifest.json", "fileId": f"manifest-v{i}"}
                           for i in range(1, 5)]
        # Each manifest has two records, so the third manifest must not be read.
        for i in range(1, 5):
            manifest = json.loads(storage.data[f"manifest-v{i}"])
            extra = {**manifest["files"][0], "path": "firms/extra.csv", "file_id": f"extra-{i}",
                     "key": manifest["prefix"] + "firms/extra.csv"}
            manifest["files"].append(extra)
            storage.data[f"manifest-v{i}"] = json.dumps(manifest).encode()
        config = {"storage": {}, "source": {"prefix": "raw/"}, "max_discovery_entries": 4}
        with self.assertRaisesRegex(ValueError, "max_discovery_entries"):
            controller.discover(config)
        self.assertEqual(storage.downloads, ["manifest-v1", "manifest-v2"])

    def test_manifest_byte_budget_and_configuration_validation(self):
        storage = Storage()
        storage.add_manifest()
        config = {"storage": {}, "source": {"manifest_file_id": "manifest-v1"},
                  "max_discovery_bytes": len(storage.data["manifest-v1"]) - 1}
        with self.assertRaisesRegex(ValueError, "max_discovery_bytes"):
            ParserController(storage).discover(config)
        for key in ("max_discovery_entries", "max_discovery_bytes"):
            for value in (0, True, "10"):
                with self.assertRaisesRegex(ValueError, key):
                    ParserController.validate({"storage": {}, "source": {"prefix": "raw/"}, key: value})

    def test_input_limit_stops_discovery_before_the_next_manifest(self):
        storage = Storage()
        storage.add_manifest()
        manifest = json.loads(storage.data["manifest-v1"])
        manifest["files"].append({**manifest["files"][0], "path": "firms/second.csv",
                                  "key": "raw/batch/firms/second.csv", "file_id": "csv-v2"})
        storage.data["manifest-v1"] = json.dumps(manifest).encode()
        storage.objects.append({"fileName": "raw/next/manifest.json", "fileId": "must-not-download"})
        with self.assertRaisesRegex(ValueError, "max_inputs"):
            ParserController(storage).discover({"storage": {}, "source": {"prefix": "raw/"}, "max_inputs": 1})
        self.assertEqual(storage.downloads, ["manifest-v1"])

    def test_adapter_passes_limit_to_native_listing(self):
        backend = Backend({})
        with patch.object(backend, "execute", return_value="[]") as call:
            backend.list_objects("raw/", max_files=12)
            self.assertEqual(call.call_args.args[0][1:5], ["list", "raw/", "--max-files", "12"])

    def test_zip_version_download_retains_zip_suffix_for_gdal(self):
        storage = Storage()
        storage.data["zip-v1"] = b"placeholder"
        with tempfile.TemporaryDirectory() as tmp:
            config = {"storage": {"upload_results": False}, "output_root": tmp,
                      "scenes": [{"id": "scene", "archive": {"file_id": "zip-v1"}}]}
            def inspect(path):
                self.assertEqual(path.suffix, ".zip")
                raise ValueError("stop before raster processing")
            with patch("fireblock_analysis.sentinel.safe_inputs", side_effect=inspect):
                with self.assertRaisesRegex(ValueError, "stop before"):
                    run(config, storage)


if __name__ == "__main__":
    unittest.main()
