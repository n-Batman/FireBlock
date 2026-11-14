import json
import tempfile
import unittest
from pathlib import Path
from fireblock_analysis.pipeline import run


class Storage:
    def __init__(self, verified=True, fail_manifest=False):
        self.verified, self.fail_manifest = verified, fail_manifest
        self.uploads = []
    def download(self, key, target):
        Path(target).write_text("latitude,longitude,acq_date,acq_time\n38,-122,2026-11-14,1200\n")
    def upload(self, source, key):
        if self.fail_manifest and key.endswith("manifest.json"):
            raise RuntimeError("manifest not stored")
        self.uploads.append(key)
        return {"key": key, "file_id": "v1", "verified": self.verified}


class RetentionTests(unittest.TestCase):
    def test_verified_run_keeps_only_small_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = run({"output_root": tmp, "storage": {}, "firms": [{"id": "fire", "input": {"key": "raw.csv"}}]}, Storage())
            self.assertEqual(json.loads(path.read_text())["status"], "complete")
            self.assertTrue((path.parent / "cloud-receipt.json").exists())
            self.assertFalse(list((path.parent / "inputs").iterdir()))
            self.assertFalse((path.parent / "fire/detections.ndjson").exists())

    def test_unverified_or_failed_upload_preserves_files(self):
        for verified, fail in ((False, False), (True, True)):
            with tempfile.TemporaryDirectory() as tmp:
                config = {"output_root": tmp, "storage": {}, "firms": [{"id": "fire", "input": {"key": "raw.csv"}}]}
                if fail:
                    with self.assertRaises(RuntimeError): run(config, Storage(verified, fail))
                    folder = next(Path(tmp).iterdir())
                else:
                    folder = run(config, Storage(verified, fail)).parent
                self.assertTrue((folder / "fire/detections.ndjson").exists())
                self.assertTrue(list((folder / "inputs").iterdir()))

    def test_local_source_archived_but_never_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = Path(tmp) / "original.csv"
            Storage().download("", original)
            backend = Storage()
            result = run({"output_root": str(Path(tmp)/"runs"), "storage": {},
                "firms": [{"id": "fire", "input": {"local": str(original)}}]}, backend)
            self.assertTrue(original.exists())
            self.assertTrue(any("/raw-inputs/" in key for key in backend.uploads))
            self.assertTrue(result.exists())


if __name__ == "__main__": unittest.main()
