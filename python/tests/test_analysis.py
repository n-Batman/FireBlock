import copy
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fireblock_analysis.bridge import Backend
from fireblock_analysis.firms import parse_firms
from fireblock_analysis.pipeline import run, validate, ingest_to_cloud
from fireblock_analysis.sentinel import normalized_difference, safe_inputs

try:
    import rasterio
except ImportError:
    rasterio = None


class ParserTests(unittest.TestCase):
    def test_index_zero_negative_nodata(self):
        a = np.array([.6, 0, -.1, np.nan], dtype="float32")
        b = np.array([.2, 0, .2, .1], dtype="float32")
        value, valid = normalized_difference(a, b, np.ones(4, dtype=bool))
        self.assertAlmostEqual(float(value[0]), .5, places=6)
        self.assertEqual(valid.tolist(), [True, False, False, False])
        self.assertEqual(value[1:].tolist(), [-9999] * 3)

    def test_firms_normalization_and_bad_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "input.csv", Path(tmp) / "out.ndjson"
            header = "latitude,longitude,acq_date,acq_time,confidence,frp,bright_ti4,instrument\n"
            row = '38,-122,2024-02-29,5,n,12.5,330,VIIRS\n'
            source.write_text(header + row + row + "91,0,2024-02-29,5,h,2,300,VIIRS\n" +
                              "38,-122,2024-02-30,1200,l,2,300,VIIRS\n" +
                              "38,-122,2024-02-29,1300,80,,320,MODIS\n" +
                              "0,0,2024-02-29,5,h,2,300,VIIRS\n", encoding="utf-8")
            result = parse_firms(source, target, [-123, 37, -121, 39])
            self.assertEqual([result[k] for k in ("accepted", "rejected", "duplicates", "outside_bbox")], [2, 2, 1, 1])
            features = [json.loads(line) for line in target.read_text().splitlines()]
            self.assertEqual(features[0]["geometry"]["coordinates"], [-122, 38])
            self.assertEqual(features[0]["properties"]["acquired_at"], "2024-02-29T00:05:00Z")
            self.assertEqual(features[0]["properties"]["confidence"], {"kind": "viirs_category", "value": "nominal"})
            self.assertEqual(features[1]["properties"]["confidence"]["kind"], "numeric_0_100")
            self.assertEqual(result["frp_mw_sum_of_detections"], 12.5)

    def test_empty_firms_and_schema_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "in.csv", Path(tmp) / "out"
            source.write_text("latitude,longitude,acq_date,acq_time\n")
            self.assertEqual(parse_firms(source, target)["accepted"], 0)
            source.write_text("API error,invalid key\n")
            with self.assertRaises(ValueError):
                parse_firms(source, target)

    def test_safe_offsets_and_multigranule_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "product.zip"
            xml = '<root><BOA_QUANTIFICATION_VALUE>10000</BOA_QUANTIFICATION_VALUE><PROCESSING_BASELINE>05.00</PROCESSING_BASELINE>' + ''.join(f'<BOA_ADD_OFFSET band_id="{i}">-1000</BOA_ADD_OFFSET>' for i in (3, 7, 11)) + '</root>'
            with zipfile.ZipFile(archive, "w") as out:
                out.writestr("product.SAFE/MTD_MSIL2A.xml", xml)
                for band, resolution in (("B04", 10), ("B08", 10), ("B11", 20), ("SCL", 20)):
                    out.writestr(f"product.SAFE/GRANULE/tile/IMG_DATA/R{resolution}m/tile_{band}_{resolution}m.jp2", b"placeholder")
            bands, calibration = safe_inputs(archive)
            self.assertTrue(bands["B04"].startswith("/vsizip/"))
            self.assertEqual(calibration["B11"], {"scale": .0001, "offset": -.1})
            with zipfile.ZipFile(archive, "a") as out:
                out.writestr("product.SAFE/GRANULE/other/IMG_DATA/R10m/other_B04_10m.jp2", b"placeholder")
            with self.assertRaises(ValueError):
                safe_inputs(archive)

    def test_backend_uses_argv_and_omits_keys(self):
        backend = Backend({"executable": "backend.exe", "env_file": "secret.env", "bucket": "my-bucket"})
        with patch("fireblock_analysis.bridge.subprocess.run") as call:
            call.return_value = subprocess.CompletedProcess([], 0, '{"fileId":"v1"}', "")
            self.assertEqual(backend.upload("file with spaces", "raw/a")["file_id"], "v1")
            args, kwargs = call.call_args
            self.assertEqual(args[0][1:4], ["upload", "file with spaces", "raw/a"])
            self.assertFalse(kwargs["shell"])
            call.return_value = subprocess.CompletedProcess([], 1, "", "secret-token")
            with self.assertRaisesRegex(RuntimeError, "command failed") as failure:
                backend.upload("a", "b")
            self.assertNotIn("secret-token", str(failure.exception))

    def test_cloud_pipeline_manifest_last_and_failure(self):
        class FakeBackend:
            def __init__(self, fail=False):
                self.uploads = []
                self.fail = fail
            def download(self, key, target):
                Path(target).write_text("latitude,longitude,acq_date,acq_time\n38,-122,2024-01-01,1234\n")
            def upload(self, source, key):
                if self.fail:
                    raise RuntimeError("simulated outage")
                self.uploads.append(key)
                if key.endswith("manifest.json"):
                    assert json.loads(Path(source).read_text())["status"] == "complete"
                return {"key": key, "file_id": "v1"}
        with tempfile.TemporaryDirectory() as tmp:
            config = {"output_root": tmp, "storage": {}, "firms": [{"id": "fires", "input": {"key": "../../remote.csv"}}]}
            backend = FakeBackend()
            path = run(config, backend)
            manifest = json.loads(path.read_text())
            self.assertEqual(manifest["status"], "complete")
            self.assertTrue(backend.uploads[-1].endswith("/manifest.json"))
            self.assertEqual(len(manifest["inputs"][0]["sha256"]), 64)
            self.assertEqual(manifest["firms"][0]["accepted"], 1)
            failed_root = Path(tmp) / "failed"
            with self.assertRaises(RuntimeError):
                run({**config, "output_root": str(failed_root)}, FakeBackend(True))
            failed = list(failed_root.glob("*/manifest.json"))
            self.assertEqual(json.loads(failed[0].read_text())["status"], "failed")

    def test_config_rejects_bad_calibration_and_paths(self):
        config = {"storage": {}, "firms": [{"id": "../escape", "input": {"key": "a"}}]}
        with self.assertRaises(ValueError):
            validate(config)
        config["firms"][0]["id"] = "safe"
        config["bbox"] = [180, 0, -180, 1]
        with self.assertRaises(ValueError):
            validate(config)
        config.pop("bbox")
        validate(config)
        scene = {"id": "s", "bands": {b: {"key": b} for b in ["B04", "B08", "B11", "SCL"]}}
        with self.assertRaises(ValueError):
            validate({"storage": {}, "scenes": [scene]})

    def test_ingestion_stages_raw_and_emits_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "raw"
            config = Path(tmp) / "ingest.json"
            config.write_text(json.dumps({"output": str(root), "copernicus": {"collection": "SENTINEL-2", "product_type": "S2MSI2A"}}))
            class Fake:
                def ingest(self, config_path):
                    (root / "firms").mkdir()
                    (root / "firms" / "fires.csv").write_text("header\n")
                    (root / "copernicus" / "p").mkdir(parents=True)
                    (root / "copernicus" / "p" / "product.zip").write_bytes(b"archive")
                def upload(self, source, key):
                    return {"key": key, "file_id": "v1"}
            job = ingest_to_cloud(config, {}, Path(tmp) / "job.json", Fake())
            self.assertEqual(len(job["scenes"]), 1)
            self.assertEqual(len(job["firms"]), 1)
            validate(job)
            with self.assertRaises(ValueError):
                ingest_to_cloud(config, {}, Path(tmp) / "other.json", Fake())


@unittest.skipIf(rasterio is None, "Rasterio is not installed")
class RasterTests(unittest.TestCase):
    def test_resolution_calibration_clouds_and_empty_scene(self):
        from rasterio.transform import from_origin
        from fireblock_analysis.sentinel import analyze_scene
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bands = {}
            for band, res, size, value in (("B04", 10, 4, 3000), ("B08", 10, 4, 7000), ("B11", 20, 2, 4000), ("SCL", 20, 2, 4)):
                path = root / f"{band}.tif"
                array = np.full((size, size), value, dtype="uint16")
                if band == "SCL":
                    array = np.array([[4, 9], [5, 0]], dtype="uint16")
                with rasterio.open(path, "w", driver="GTiff", width=size, height=size, count=1, dtype="uint16", nodata=0,
                                   crs="EPSG:32610", transform=from_origin(500000, 4200000, res, res)) as out:
                    out.write(array, 1)
                bands[band] = path
            calibration = {b: {"scale": .0001, "offset": -.1} for b in ["B04", "B08", "B11"]}
            result = analyze_scene(bands, calibration, root / "out", min_valid_fraction=.6)
            self.assertFalse(result["usable"])
            for name, res, mean, count in (("ndvi", 10, .5, 8), ("ndmi", 20, 1/3, 2)):
                index = result["indices"][name]
                self.assertEqual(index["effective_resolution_m"], res)
                self.assertEqual(index["statistics"]["count"], count)
                self.assertAlmostEqual(index["statistics"]["mean"], mean, places=5)
                self.assertEqual(index["coverage"]["cloud_fraction"], .25)
                self.assertEqual(index["coverage"]["valid_fraction"], .5)
                with rasterio.open(root / "out" / f"{name}.tif") as raster:
                    self.assertEqual(raster.res, (res, res))
                    self.assertEqual(raster.nodata, -9999)
            with rasterio.open(bands["SCL"], "r+") as raster:
                raster.write(np.full((2, 2), 9, dtype="uint16"), 1)
            empty = analyze_scene(bands, calibration, root / "empty", min_valid_fraction=0)
            self.assertFalse(empty["usable"])
            self.assertIsNone(empty["indices"]["ndvi"]["statistics"]["mean"])


if __name__ == "__main__":
    unittest.main()
