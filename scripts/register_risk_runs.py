"""Register existing completed cloud runs and export website fallback grids.

Safe to repeat; never downloads satellite archives. New runs self-register.
"""
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from fireblock_analysis.bridge import Backend
from fireblock_analysis.pipeline import write_json


def main():
    backend = Backend({"env_file": str(ROOT / ".env"), "executable": str(ROOT / "build/native/fireblock.exe")})
    existing = backend.list_objects("risk/")
    snapshots = ROOT / "src/data/real-runs"
    publications = []
    with tempfile.TemporaryDirectory(prefix="fireblock-catalog-") as tmp:
        temporary = Path(tmp)
        for item in existing:
            if not item["fileName"].endswith("/manifest.json"):
                continue
            manifest_path = temporary / "manifest.json"
            manifest_path.unlink(missing_ok=True)
            backend.download_version(item["fileId"], manifest_path)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
            if manifest.get("status") != "complete" or not manifest.get("risk"):
                continue
            run_id = manifest["run_id"]
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", run_id):
                raise ValueError("Invalid cloud run ID")
            artifact = next(a for a in manifest["artifacts"] if a["path"] == "risk/risk_map.geojson")
            grid_path = temporary / "grid.geojson"
            grid_path.unlink(missing_ok=True)
            backend.download_version(artifact["storage"]["file_id"], grid_path)
            if grid_path.stat().st_size != artifact["bytes"] or hashlib.sha256(grid_path.read_bytes()).hexdigest() != artifact["sha256"]:
                raise ValueError("Cloud grid checksum mismatch")
            pointer = {"kind":"fireblock.risk-pointer", "schema_version":1,
                       "manifest_file_id":item["fileId"], "manifest_sha256":hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                       "manifest_bytes":manifest_path.stat().st_size,"bbox":manifest["risk"]["bbox"],
                       "run_id":run_id,"as_of":manifest["risk"]["as_of"],"model_id":manifest["risk"]["model_id"]}
            pointer_path = temporary / "pointer.json"
            write_json(pointer_path, pointer)
            key = f"risk/catalog/{run_id}.json"
            if not any(obj["fileName"] == key for obj in existing):
                if backend.upload(pointer_path, key).get("verified") is not True:
                    raise ValueError("Catalog registration did not verify")
            target = None
            for candidate in snapshots.glob("*/risk_map.geojson"):
                if hashlib.sha256(candidate.read_bytes()).hexdigest() == artifact["sha256"]:
                    target = candidate
                    break
            if target is None:
                target = snapshots / ("cloud-" + run_id) / "risk_map.geojson"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(grid_path.read_bytes())
            publications.append({"id":run_id,"path":target.relative_to(snapshots).as_posix(),"sha256":artifact["sha256"],"bbox":pointer["bbox"]})
    write_json(snapshots / "catalog.json", {"schema_version":1,"publications":publications})
    print(f"Registered and verified {len(publications)} cloud risk runs; website fallback catalog exported")


if __name__ == "__main__":
    main()
