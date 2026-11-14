"""Confirmed West Foothill run: reuse SLO coverage and publish only new cells."""
import hashlib
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"python"))
from fireblock_analysis.bridge import Backend
from fireblock_analysis.controller import ParserController
from fireblock_analysis.pipeline import run, write_json
from fireblock_analysis.risk import grid


def main():
    os.chdir(ROOT)
    folder=ROOT/"analysis/madonna-west-foothill-20261114"
    folder.mkdir(exist_ok=True)
    if (folder/"status.json").exists():
        existing=json.loads((folder/"status.json").read_text())
        if existing.get("status") == "complete":
            print("This dated run is already complete; see status.json",flush=True)
            return
    old_manifest=next((ROOT/"analysis/slo-town-50box-real/results").glob("*/manifest.json"))
    old_grid=old_manifest.parent/"risk/risk_map.geojson"
    manifest=json.loads(old_manifest.read_text())
    expected=next(a["sha256"] for a in manifest["artifacts"] if a["path"]=="risk/risk_map.geojson")
    if hashlib.sha256(old_grid.read_bytes()).hexdigest()!=expected:
        raise ValueError("Existing SLO coverage checksum changed")
    old=json.loads(old_grid.read_text())
    known=[f for f in old["features"] if f.get("properties",{}).get("risk_score") is not None]
    rectangles=[]
    for f in known:
        ring=f["geometry"]["coordinates"][0]
        rectangles.append((min(p[0] for p in ring),min(p[1] for p in ring),max(p[0] for p in ring),max(p[1] for p in ring)))
    lon,lat=-120.697601478522,35.28736784603
    dy=1.5/111.195;dx=dy/math.cos(math.radians(lat))
    bbox=[lon-dx,lat-dy,lon+dx,lat+dy]
    rows,cols=grid(bbox,{"cell_km":.2})
    sx,sy=(bbox[2]-bbox[0])/cols,(bbox[3]-bbox[1])/rows
    new=[]
    for r in range(rows):
        for c in range(cols):
            w,n=bbox[0]+c*sx,bbox[3]-r*sy;e,s=w+sx,n-sy
            if not any(w<b[2]-1e-12 and e>b[0]+1e-12 and s<b[3]-1e-12 and n>b[1]+1e-12 for b in rectangles):
                new.append((w,s,e,n))
    plan={"address":"269 W Foothill Blvd, San Luis Obispo, CA", "geocoder":"US Census Public_AR_Current",
        "center":[lon,lat],"analysis_bbox":bbox,"analysis_cell_m":200,"candidate_cells":rows*cols,
        "new_candidate_cells":len(new),"existing_slo_known_cells":len(known),"existing_grid_sha256":expected}
    write_json(folder/"overlap-plan.json",plan)
    print(json.dumps(plan),flush=True)
    if not new:
        write_json(folder/"status.json",{"status":"already_covered","plan":plan});return
    scrape_bbox=[min(b[0] for b in new),min(b[1] for b in new),max(b[2] for b in new),max(b[3] for b in new)]
    now=datetime.now(timezone.utc)
    config=json.loads((ROOT/"config/ingest.example.json").read_text())
    config.update(bbox=scrape_bbox,start=str(now.date()-timedelta(days=3)),end=str(now.date()+timedelta(days=1)))
    config["copernicus"].update(products=True,quicklooks=False,max_products=2,cloud_cover_max=50)
    config["firms"]["sources"]=["VIIRS_NOAA20_NRT","MODIS_NRT"]
    config["firms"]["enabled"] = False  # No FIRMS_MAP_KEY configured; never imply fresh hotspot coverage.
    write_json(folder/"ingest.json",config)
    print("Scraping uncovered-region envelope; existing satellite UUIDs will be reused",flush=True)
    result=subprocess.run([str(ROOT/"build/native/fireblock_pipeline.exe"),"scrape",str(folder/"ingest.json"),"--work",str(folder/"raw"),"--env",str(ROOT/".env")],capture_output=True,text=True,encoding="utf-8",timeout=1800)
    (folder/"scrape.log").write_text(result.stdout+result.stderr,encoding="utf-8")
    if result.returncode:
        raise RuntimeError("Native scrape failed; inspect scrape.log")
    publication=json.loads(result.stdout[result.stdout.rfind("\n{")+1:])
    write_json(folder/"raw-receipt.json",publication)
    print("Raw batch archived; resolving parser inputs",flush=True)
    backend=Backend({"executable":str(ROOT/"build/native/fireblock.exe"),"env_file":str(ROOT/".env")})
    job=json.loads((ROOT/"config/risk.cloud.example.json").read_text())
    job["source"]={"manifest_file_id":publication["manifest_file_id"]}
    job["bbox"]=bbox;job["output_root"]=str(folder/"results")
    job["risk"].update(as_of=now.isoformat(),exclude_grid=str(old_grid),data_label="Madonna Ranch, West Foothill: satellite-only new coverage; FIRMS unavailable (no key); existing SLO cells excluded")
    job["storage"].update(executable=str(ROOT/"build/native/fireblock.exe"),env_file=str(ROOT/".env"),output_prefix="risk/madonna-west-foothill",frontend_pointer_key="risk/madonna-west-foothill/latest.json",local_retention="keep")
    resolved=ParserController(backend).discover(job)
    write_json(folder/"risk-job.json",resolved)
    # Existing parser working ZIPs are already backed by immutable B2 versions.
    # Verify and hard-link those local bytes into this run instead of transferring
    # the same multi-gigabyte product again. Pipeline still verifies inventory.
    cache={}
    previous=json.loads((ROOT/"analysis/slo-town-50box-real/risk-job.json").read_text())
    for identity,record in previous.get("source_inventory",{}).items():
        if record["bytes"]<1000000:continue
        for candidate in (old_manifest.parent/"inputs").glob("*.zip"):
            if candidate.stat().st_size!=record["bytes"]:continue
            with candidate.open("rb") as stream:checksum=hashlib.file_digest(stream,"sha1").hexdigest()
            if checksum==record["sha1"]:cache[identity]=candidate
    class CachedBackend(Backend):
        def download_version(self,identity,target):
            if identity in cache:
                os.link(cache[identity],target);print("Reused verified local working copy of cloud satellite version",flush=True)
            else:super().download_version(identity,target)
    print("Running satellite parsers and mathematical risk model (FIRMS unavailable)",flush=True)
    path=run(resolved,CachedBackend(job["storage"]))
    completed=json.loads(path.read_text())
    data=json.loads((path.parent/"risk/risk_map.geojson").read_text())
    for f in data["features"]:
        if f.get("properties",{}).get("layer")!="relative_risk":continue
        ring=f["geometry"]["coordinates"][0];w=min(p[0] for p in ring);e=max(p[0] for p in ring);s=min(p[1] for p in ring);n=max(p[1] for p in ring)
        if any(w<b[2]-1e-12 and e>b[0]+1e-12 and s<b[3]-1e-12 and n>b[1]+1e-12 for b in rectangles):raise ValueError("Output overlaps mapped SLO cell")
    report={"status":"complete","manifest":str(path),"risk":completed["risk"],"raw_receipt":publication,"overlap_verified":True}
    # Retain the small preview pair and receipts. Remove only this run's verified
    # scene artifacts and hard-linked inputs; the original SLO cache is untouched.
    receipt=json.loads((path.parent/"cloud-receipt.json").read_text())
    if receipt["manifest"].get("verified") is not True or not all(a.get("storage",{}).get("verified") is True for a in completed["artifacts"]):
        raise ValueError("Cloud verification required before working-file cleanup")
    cleanup=[]
    for artifact in completed["artifacts"]:
        if not artifact["path"].startswith("risk/"):
            cleanup.append(path.parent/artifact["path"])
    cleanup.extend((path.parent/"inputs").iterdir())
    for candidate in cleanup:
        if candidate.is_symlink() or not candidate.resolve().is_relative_to(path.parent.resolve()):
            raise ValueError("Working-file cleanup escaped this run")
        if candidate.is_file():candidate.unlink()
    report["temporary_working_files_removed"]=True
    write_json(folder/"status.json",report)
    print(json.dumps({"status":"complete","new_scored_cells":completed["risk"]["known_cells"],"overlap_verified":True,"map":str(path.parent/"risk/risk_map.html")}),flush=True)


if __name__=="__main__":main()
