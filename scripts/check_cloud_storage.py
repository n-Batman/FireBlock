"""Read-only cloud configuration audit. Never prints key values or object names."""
import json
import sys
import argparse
import tempfile
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"python"))
from fireblock_analysis.bridge import Backend

backend=Backend({})
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--round-trip",action="store_true",help="Upload, verify and delete a temporary test object")
args=parser.parse_args()
backend.call("account")
print("Backblaze authentication: verified")
for prefix in ("raw/","analysis/","risk/","parcel-displays/"):
    objects=backend.list_objects(prefix)
    print(json.dumps({"prefix":prefix,"objects":len(objects),"bytes":sum(o.get("contentLength",0) for o in objects)}))
if args.round_trip:
    with tempfile.TemporaryDirectory(prefix="fireblock-storage-probe-") as folder:
        source=Path(folder)/"probe.json"
        source.write_text(json.dumps({"kind":"fireblock.storage-probe","test":uuid.uuid4().hex}),encoding="utf-8")
        key="diagnostics/storage-probe/"+uuid.uuid4().hex+".json"
        receipt=backend.upload(source,key)
        try:
            if not receipt.get("verified"):
                raise RuntimeError("Cloud upload did not verify")
            restored=Path(folder)/"restored.json"
            backend.download_version(receipt["file_id"],restored)
            if source.read_bytes()!=restored.read_bytes():
                raise RuntimeError("Cloud round-trip byte mismatch")
        finally:
            backend.call("delete",key,receipt["file_id"],"--yes")
    print("Cloud upload/download integrity: verified; temporary probe removed")
