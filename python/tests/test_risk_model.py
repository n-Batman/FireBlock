import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from fireblock_analysis.risk_model import MathematicalRiskModel, evaluate_model
from fireblock_analysis.pipeline import run


class ModelTests(unittest.TestCase):
    def test_math_limits_and_weights(self):
        features={"ndvi":np.array([.8,.8,.8,.2,np.nan]),"ndmi":np.array([.4,-.4,-.4,-.4,.2]),"hotspot_pressure":np.array([0.,0.,1.,1.,0.])}
        result=evaluate_model(MathematicalRiskModel(),features,{})
        np.testing.assert_allclose(result[:4],[0,70,100,0])
        self.assertTrue(np.isnan(result[4]))

    def test_future_model_interface_rejects_bad_output_and_preserves_unknown(self):
        class Model:
            model_id="test-only-future-model"
            feature_schema="fireblock.risk-features.v1"
            def score(self,features,parameters): return np.array([65.,99.])
        features={"ndvi":np.array([.8,np.nan]),"ndmi":np.array([.1,.1]),"hotspot_pressure":np.array([0.,0.])}
        result=evaluate_model(Model(),features,{})
        self.assertEqual(result[0],65);self.assertTrue(np.isnan(result[1]))
        model=Model();model.score=lambda f,p:np.array([101.,99.])
        with self.assertRaises(ValueError):evaluate_model(model,features,{})
        model.score=lambda f,p:np.array([10.])
        with self.assertRaises(ValueError):evaluate_model(model,features,{})

    def test_cloud_publish_pointer_references_completed_manifest(self):
        class Storage:
            def __init__(self,fail=False,fail_catalog=False):self.objects={};self.keys=[];self.fail=fail;self.fail_catalog=fail_catalog
            def download_version(self,identity,path):
                Path(path).write_text("latitude,longitude,acq_date,acq_time\n0.005,0.005,2026-11-14,1000\n")
            def upload(self,path,key):
                if self.fail_catalog and key.startswith("risk/catalog/"):raise RuntimeError("Catalog unavailable")
                if self.fail and key.endswith("manifest.json"):raise RuntimeError("Cloud unavailable")
                identity="id-"+str(len(self.keys));self.objects[identity]=Path(path).read_bytes();self.keys.append(key)
                return {"key":key,"file_id":identity,"verified":True}
        with tempfile.TemporaryDirectory() as tmp:
            config={"output_root":tmp,"storage":{"publish_frontend":True,"frontend_pointer_key":"risk/latest.json"},
                "bbox":[0,0,.01,.01],"risk":{"enabled":True,"as_of":"2026-11-14T12:00:00Z"},
                "firms":[{"id":"fires","input":{"file_id":"raw-id"}}]}
            storage=Storage();path=run(config,storage)
            self.assertEqual(storage.keys[-2],"risk/latest.json")
            self.assertTrue(storage.keys[-1].startswith("risk/catalog/"))
            pointer=json.loads(list(storage.objects.values())[-1]);manifest=json.loads(storage.objects[pointer["manifest_file_id"]])
            self.assertEqual(pointer["kind"],"fireblock.risk-pointer")
            self.assertEqual(manifest["status"],"complete")
            self.assertEqual(manifest["risk"]["model_kind"],"mathematical")
            self.assertEqual(manifest["risk"]["known_cells"],0)
            storage=Storage(True)
            with self.assertRaises(RuntimeError):run(config,storage)
            self.assertNotIn("risk/latest.json",storage.keys)
            storage=Storage(fail_catalog=True)
            with self.assertRaises(RuntimeError):run(config,storage)
            self.assertFalse(any(key.startswith("risk/catalog/") for key in storage.keys))
            # Failed registration retains outputs, so publishing can be retried.
            self.assertEqual(len(list(Path(tmp).glob("*/risk/risk_map.geojson"))),2)


if __name__=="__main__":unittest.main()
