import hashlib
import json
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .bridge import Backend
from .firms import parse_firms


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate(config):
    if not isinstance(config, dict) or not isinstance(config.get("storage"), dict):
        raise ValueError("Job requires a storage configuration")
    bbox = config.get("bbox")
    if bbox is not None and (not isinstance(bbox, list) or len(bbox) != 4
            or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in bbox)
            or not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90)):
        raise ValueError("bbox must be [west,south,east,north], without antimeridian crossing")
    minimum = config.get("min_valid_fraction", 0.6)
    if not isinstance(minimum, (int, float)) or not math.isfinite(minimum) or not 0 <= minimum <= 1:
        raise ValueError("min_valid_fraction must be 0..1")
    classes = config.get("valid_scl_classes", [4, 5])
    if not isinstance(classes, list) or not classes or any(type(c) is not int or c not in {2, 4, 5, 6, 7} for c in classes):
        raise ValueError("valid_scl_classes must select from 2,4,5,6,7")
    all_ids = set()
    for category in ("scenes", "firms"):
        jobs = config.get(category, [])
        if not isinstance(jobs, list):
            raise ValueError(f"{category} must be an array")
        for item in jobs:
            name = item.get("id", "")
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", name) or name in all_ids:
                raise ValueError("Every input needs a unique safe id using letters, digits, underscores or hyphens")
            all_ids.add(name)
            if category == "firms":
                assets = [item.get("input")]
            elif "archive" in item:
                if "bands" in item:
                    raise ValueError("Use archive OR explicit bands for a scene")
                assets = [item["archive"]]
            else:
                bands, calibration = item.get("bands", {}), item.get("calibration", {})
                if set(bands) != {"B04", "B08", "B11", "SCL"}:
                    raise ValueError("Scene needs SAFE archive or B04/B08/B11/SCL assets")
                for band in ("B04", "B08", "B11"):
                    value = calibration.get(band, {})
                    if not all(type(value.get(k)) in (float, int) and math.isfinite(value[k]) for k in ("scale", "offset")) or value["scale"] <= 0:
                        raise ValueError("Explicit bands require per-band scale and offset; do not guess DN calibration")
                assets = bands.values()
            for asset in assets:
                if not isinstance(asset, dict) or len(asset) != 1 or not (set(asset) <= {"key", "local", "file_id"}) or not isinstance(next(iter(asset.values())), str) or not next(iter(asset.values())):
                    raise ValueError("Each asset must contain one nonempty key, file_id, or local path")
    if not all_ids:
        raise ValueError("Job contains no scenes or FIRMS inputs")
    if "risk" in config:
        from .risk import validate_risk
        validate_risk(config["risk"], bbox)
    if "weather" in config:
        asset = config["weather"]
        if not isinstance(asset, dict) or len(asset) != 1 or not (set(asset) <= {"key", "local", "file_id"}) or not isinstance(next(iter(asset.values())), str) or not next(iter(asset.values())):
            raise ValueError("weather must contain one nonempty key, file_id, or local path")
    if config["storage"].get("local_retention", "manifest_only") not in ("manifest_only", "keep"):
        raise ValueError("storage.local_retention must be manifest_only or keep")
    if config["storage"].get("publish_frontend", False):
        if not config.get("risk", {}).get("enabled") or not config["storage"].get("upload_results", True):
            raise ValueError("Frontend publication requires risk generation and cloud uploads")
        pointer = config["storage"].get("frontend_pointer_key", "risk/latest.json")
        if not isinstance(pointer, str) or not pointer or any(c in pointer for c in "\r\n\0\\") or pointer.startswith("/") or ".." in pointer.split("/"):
            raise ValueError("Invalid frontend pointer key")
    prefix = config["storage"].get("output_prefix", "analysis")
    if not isinstance(prefix, str) or not prefix.strip("/") or "\r" in prefix or "\n" in prefix:
        raise ValueError("storage.output_prefix must be a nonempty object prefix")


def run(config, backend=None, risk_model=None):
    validate(config)
    backend = backend or Backend(config["storage"])
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
    root = Path(config.get("output_root", "analysis")) / run_id
    root.mkdir(parents=True, exist_ok=False)
    cache = root / "inputs"
    cache.mkdir()
    manifest = {"schema_version": 1, "parser_version": "0.1.0", "run_id": run_id, "status": "running",
                "inputs": [], "scenes": [], "firms": [], "artifacts": []}
    if "discovery" in config:
        manifest["discovery"] = config["discovery"]
    prefix = config["storage"].get("output_prefix", "analysis").strip("/") + "/" + run_id

    def materialize(asset, suffix_hint=None):
        if "local" in asset:
            path = Path(asset["local"])
            if not path.is_file():
                raise ValueError("Local asset does not exist")
        else:
            # Remote names never become filesystem paths (no traversal or collisions).
            suffix = suffix_hint or Path(asset.get("key", "input.bin")).suffix.lower()
            if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
                suffix = ".bin"
            path = cache / (uuid.uuid4().hex + suffix)
            if "file_id" in asset:
                backend.download_version(asset["file_id"], path)
            else:
                backend.download(asset["key"], path)
        expected = config.get("source_inventory", {}).get(asset.get("file_id"))
        if expected:
            with open(path, "rb") as stream:
                checksum = hashlib.file_digest(stream, "sha1").hexdigest()
            if path.stat().st_size != expected["bytes"] or checksum != expected["sha1"]:
                raise ValueError("Downloaded file does not match the raw dataset manifest")
        record = {**asset, "sha256": digest(path), "bytes": path.stat().st_size}
        if "local" in asset and config["storage"].get("upload_results", True):
            record["storage"] = backend.upload(path, prefix + "/raw-inputs/" + uuid.uuid4().hex + path.suffix)
        manifest["inputs"].append(record)
        return path

    try:
        for scene in config.get("scenes", []):
            from .sentinel import analyze_scene, safe_inputs
            if "archive" in scene:
                bands, calibration = safe_inputs(materialize(scene["archive"], ".zip"))
            else:
                bands = {b: materialize(asset) for b, asset in scene["bands"].items()}
                calibration = scene["calibration"]
            destination = root / scene["id"]
            summary = analyze_scene(bands, calibration, destination, config.get("bbox"),
                                    config.get("min_valid_fraction", 0.6), config.get("valid_scl_classes", [4, 5]))
            summary["id"] = scene["id"]
            summary["acquired_at"] = scene.get("acquired_at")
            write_json(destination / "summary.json", summary)
            manifest["scenes"].append(summary)
        for source in config.get("firms", []):
            path = materialize(source["input"])
            destination = root / source["id"]
            destination.mkdir()
            summary = parse_firms(path, destination / "detections.ndjson", config.get("bbox"))
            summary["id"] = source["id"]
            write_json(destination / "summary.json", summary)
            manifest["firms"].append(summary)
        if config.get("risk", {}).get("enabled", False):
            from .risk import build_risk
            if "weather" in config:
                manifest["weather_snapshot"] = str(materialize(config["weather"], ".json"))
            manifest["risk"] = build_risk(manifest, root, config["risk"], config["bbox"], model=risk_model)
        # Publish only after ALL parsing/map generation succeeds; manifest is the commit marker.
        artifacts = sorted(p for p in root.rglob("*") if p.is_file() and cache not in p.parents and p.name != "manifest.json")
        for path in artifacts:
            relative = path.relative_to(root).as_posix()
            artifact = {"path": relative, "sha256": digest(path), "bytes": path.stat().st_size}
            if config["storage"].get("upload_results", True):
                artifact["storage"] = backend.upload(path, prefix + "/" + relative)
            manifest["artifacts"].append(artifact)
        manifest["status"] = "complete"
        manifest["manifest_key"] = prefix + "/manifest.json" if config["storage"].get("upload_results", True) else None
        write_json(root / "manifest.json", manifest)
        if config["storage"].get("upload_results", True):
            receipt = backend.upload(root / "manifest.json", manifest["manifest_key"])
            # Never discard a dataset based solely on an attempted upload. Older
            # adapters without checksum verification retain their working files.
            verified = receipt.get("verified") is True and all(a.get("storage", {}).get("verified") is True for a in manifest["artifacts"]) and all(
                item.get("storage", {}).get("verified") is True for item in manifest["inputs"] if "local" in item)
            if config["storage"].get("publish_frontend", bool(manifest.get("risk"))):
                if not verified:
                    raise ValueError("Do not publish unverified analysis to the frontend")
                pointer_path = root / "frontend-pointer.json"
                write_json(pointer_path, {"kind":"fireblock.risk-pointer", "schema_version":1,
                    "manifest_file_id":receipt["file_id"], "manifest_sha256":digest(root/"manifest.json"),
                    "manifest_bytes":(root/"manifest.json").stat().st_size,
                    "model_id":manifest["risk"]["model_id"], "as_of":manifest["risk"]["as_of"],
                    "bbox":config["bbox"], "run_id":run_id})
                publication = backend.upload(pointer_path, config["storage"].get("frontend_pointer_key", "risk/latest.json"))
                if publication.get("verified") is not True:
                    raise ValueError("Frontend pointer upload did not verify")
                # Each run gets its own immutable catalog entry. Independent
                # writers never overwrite a shared catalog or lose other areas.
                catalog = backend.upload(pointer_path, "risk/catalog/" + run_id + ".json")
                if catalog.get("verified") is not True:
                    raise ValueError("Risk catalog publication did not verify")
            if verified:
                write_json(root / "cloud-receipt.json", {"manifest": receipt, "local_artifacts_removed": False})
            if verified and config["storage"].get("local_retention", "manifest_only") == "manifest_only":
                cleanup_complete = True
                # Only files created in this unique run are removed. Local source
                # paths outside it are never touched; failed runs are retained.
                for artifact in artifacts:
                    if not artifact.is_symlink() and artifact.resolve().is_relative_to(root.resolve()):
                        try:
                            artifact.unlink()
                        except OSError:
                            cleanup_complete = False  # Cloud run remains complete.
                for downloaded in cache.iterdir():
                    if downloaded.is_file() and not downloaded.is_symlink():
                        try:
                            downloaded.unlink()
                        except OSError:
                            cleanup_complete = False
                write_json(root / "cloud-receipt.json", {"manifest": receipt, "local_artifacts_removed": cleanup_complete})
        return root / "manifest.json"
    except Exception:
        manifest["status"] = "failed"
        manifest["error"] = "Processing or storage failed; no completed remote manifest is guaranteed"
        write_json(root / "manifest.json", manifest)
        raise


def ingest_to_cloud(ingest_path, storage, output_path, backend=None):
    """Run the C++ scraper, archive its outputs to B2, emit a runnable analysis job."""
    backend = backend or Backend(storage)
    config = json.loads(Path(ingest_path).read_text(encoding="utf-8-sig"))
    input_root = Path(config["output"]).resolve()
    if not input_root.is_dir():
        input_root.mkdir(parents=True)
    # Dedicated empty output prevents stale products from entering a new run.
    if any(input_root.iterdir()):
        raise ValueError("Ingestion output must be an empty dedicated directory for this batch")
    backend.ingest(ingest_path)
    batch = uuid.uuid4().hex
    prefix = storage.get("raw_prefix", "raw").strip("/") + "/" + batch
    job = {"storage": storage, "output_root": "analysis", "bbox": config.get("bbox"), "scenes": [], "firms": [], "raw_objects": []}
    uploaded_paths = []
    for path in sorted(input_root.rglob("*")):
        if not path.is_file() or path.is_symlink() or path.suffix == ".part":
            continue
        if not path.resolve().is_relative_to(input_root):
            continue
        relative = path.relative_to(input_root).as_posix()
        key = prefix + "/" + relative
        job["raw_objects"].append({**backend.upload(path, key), "sha256": digest(path)})
        uploaded_paths.append(path)
        identity = "source_" + hashlib.sha256(relative.encode()).hexdigest()[:16]
        if relative.startswith("firms/") and path.suffix == ".csv":
            job["firms"].append({"id": identity, "input": {"key": key}})
        if relative.startswith("copernicus/") and path.name == "product.zip" and config.get("copernicus", {}).get("collection") == "SENTINEL-2" and config["copernicus"].get("product_type") == "S2MSI2A":
            job["scenes"].append({"id": identity, "archive": {"key": key}})
    # Raw metadata/products stay in B2, including data the current parser cannot analyze.
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    write_json(output_path, job)
    receipt = backend.upload(output_path, prefix + "/analysis-job.json")
    if receipt.get("verified") is True and all(obj.get("verified") is True for obj in job["raw_objects"]) and storage.get("local_retention", "manifest_only") == "manifest_only":
        for path in uploaded_paths:
            if not path.is_symlink() and path.resolve().is_relative_to(input_root):
                path.unlink()
    return job
