"""Parser controller connecting the Python workers to the C++ storage controller."""
import copy
import hashlib
import json
import re
import tempfile
from pathlib import Path, PurePosixPath

from .bridge import Backend
from .pipeline import run, validate


class ParserController:
    def __init__(self, storage):
        """Accept a Backend (C++ storage CLI adapter), or an injected test backend."""
        self.storage = storage

    @classmethod
    def from_config(cls, config):
        return cls(Backend(config["storage"]))

    @staticmethod
    def validate(config):
        source = config.get("source", {})
        if not isinstance(source, dict) or set(source) not in ({"prefix"}, {"manifest_file_id"}):
            raise ValueError("Cloud parser source must select prefix OR manifest_file_id")
        value = next(iter(source.values()))
        if not isinstance(value, str) or not value or any(c in value for c in "\r\n\0"):
            raise ValueError("Cloud source must be a nonempty prefix or file ID")
        limit = config.get("max_inputs", 1000)
        if type(limit) is not int or not 1 <= limit <= 100000:
            raise ValueError("max_inputs must be 1..100000")
        # Reuse scientific/storage option validation without accessing B2.
        probe = copy.deepcopy(config)
        probe["scenes"] = []
        probe["firms"] = [{"id": "validation", "input": {"file_id": "placeholder"}}]
        validate(probe)

    def _manifest(self, file_id):
        with tempfile.TemporaryDirectory(prefix="fireblock-discovery-") as folder:
            path = Path(folder) / "manifest.json"
            self.storage.download_version(file_id, path)
            if path.stat().st_size > 32 * 1024 * 1024:
                raise ValueError("Raw manifest exceeds 32 MB")
            manifest = json.loads(path.read_text(encoding="utf-8-sig"))
        if (not isinstance(manifest, dict) or manifest.get("kind") != "fireblock.raw"
                or manifest.get("schema_version") != 1 or manifest.get("status") != "complete"):
            raise ValueError("Parser requires a completed fireblock.raw manifest")
        prefix, entries = manifest.get("prefix"), manifest.get("files")
        if not isinstance(prefix, str) or not prefix.endswith("/") or not isinstance(entries, list) or not 1 <= len(entries) <= 100000:
            raise ValueError("Invalid raw manifest inventory")
        ids, paths = set(), set()
        for entry in entries:
            path, key, identity = entry.get("path"), entry.get("key"), entry.get("file_id")
            if (not isinstance(path, str) or PurePosixPath(path).is_absolute() or ".." in PurePosixPath(path).parts
                    or not path.startswith(("copernicus/", "firms/")) or key != prefix + path
                    or not isinstance(identity, str) or not identity or identity in ids or path in paths
                    or type(entry.get("bytes")) is not int or not 0 <= entry["bytes"] <= 5000000000
                    or not isinstance(entry.get("sha1"), str) or not re.fullmatch(r"[0-9a-f]{40}", entry["sha1"])):
                raise ValueError("Invalid or duplicate raw manifest entry")
            ids.add(identity)
            paths.add(path)
        return entries

    def discover(self, config):
        """Resolve B2 sources into an ordinary worker job pinned to file versions."""
        self.validate(config)
        job = copy.deepcopy(config)
        job.pop("source")
        job["scenes"], job["firms"], job["source_inventory"] = [], [], {}
        discovery = {"source": config["source"], "manifest_file_ids": [], "selected": 0, "ignored": 0}
        source = config["source"]
        if "manifest_file_id" in source:
            manifests = [source["manifest_file_id"]]
            objects = []
        else:
            objects = self.storage.list_objects(source["prefix"])
            # Completed raw batches take precedence over loose objects. This avoids
            # parsing a partially published batch alongside completed batches.
            manifests = [obj["fileId"] for obj in objects if obj["fileName"].endswith("/manifest.json")]
        entries = []
        if manifests:
            for identity in manifests:
                entries.extend(self._manifest(identity))
                discovery["manifest_file_ids"].append(identity)
        else:
            entries = [{"path": obj["fileName"], "key": obj["fileName"], "file_id": obj["fileId"]} for obj in objects]
        selected = set()
        by_key = {entry["key"]: entry for entry in entries}
        for entry in entries:
            name, identity = entry["path"], entry["file_id"]
            if identity in selected:
                continue
            parts = PurePosixPath(name).parts
            filename = PurePosixPath(name).name
            is_scene = (("copernicus" in parts and filename == "product.zip")
                        or bool(re.search(r"S2[ABC]_MSIL2A_.*\.zip$", filename, re.IGNORECASE)))
            is_firms = "firms" in parts and filename.lower().endswith(".csv")
            if not (is_scene or is_firms):
                discovery["ignored"] += 1
                continue
            selected.add(identity)
            if len(selected) > config.get("max_inputs", 1000):
                raise ValueError("Cloud dataset exceeds max_inputs; select a narrower prefix or batch")
            name_id = ("scene_" if is_scene else "firms_") + hashlib.sha256(identity.encode()).hexdigest()[:24]
            item = {"id": name_id, "archive" if is_scene else "input": {"file_id": identity}}
            if is_scene and config.get("risk", {}).get("enabled", False):
                metadata = by_key.get(entry["key"].rsplit("/", 1)[0] + "/metadata.json")
                if metadata:
                    if metadata.get("bytes", 0) > 32 * 1024 * 1024:
                        raise ValueError("Scene acquisition metadata exceeds 32 MB")
                    with tempfile.TemporaryDirectory(prefix="fireblock-scene-time-") as folder:
                        path = Path(folder) / "metadata.json"
                        self.storage.download_version(metadata["file_id"], path)
                        if path.stat().st_size > 32 * 1024 * 1024:
                            raise ValueError("Scene acquisition metadata exceeds 32 MB")
                        if "sha1" in metadata and (path.stat().st_size != metadata["bytes"] or
                                hashlib.sha1(path.read_bytes()).hexdigest() != metadata["sha1"]):
                            raise ValueError("Scene acquisition metadata does not match raw manifest")
                        product = json.loads(path.read_text(encoding="utf-8-sig"))
                        item["acquired_at"] = product.get("ContentDate", {}).get("Start")
                    discovery.setdefault("scene_time_sources", []).append({"file_id": metadata["file_id"], "key": metadata["key"]})
            job["scenes" if is_scene else "firms"].append(item)
            if "sha1" in entry:
                job["source_inventory"][identity] = {"key": entry["key"], "bytes": entry["bytes"], "sha1": entry["sha1"]}
        discovery["selected"] = len(selected)
        if not selected:
            raise ValueError("No supported Sentinel-2 L2A product archives or FIRMS CSVs found; ordinary PNG/JPEG images do not contain analytical bands")
        job["discovery"] = discovery
        validate(job)
        return job

    def run(self, config):
        return run(self.discover(config), self.storage)
