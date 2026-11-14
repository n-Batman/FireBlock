"""Single-area scraper jobs, independent of the desktop UI."""
import copy
import json
import math
import os
import subprocess
import threading
import uuid
from datetime import date
from pathlib import Path
from queue import Queue

SOURCES = ("VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT")
SECRETS = ("FIRMS_MAP_KEY", "CDSE_USERNAME", "CDSE_PASSWORD", "CDSE_TOTP",
           "B2_APPLICATION_KEY_ID", "B2_APPLICATION_KEY")


def config_for(settings, output):
    box = [float(settings[k]) for k in ("west", "south", "east", "north")]
    if not all(math.isfinite(v) for v in box) or not (-180 <= box[0] < box[2] <= 180 and -90 <= box[1] < box[3] <= 90):
        raise ValueError("Area must have west < east, south < north, with valid longitude/latitude.")
    start, end = date.fromisoformat(settings["start"]), date.fromisoformat(settings["end"])
    if start >= end:
        raise ValueError("End date must be after start date (end is exclusive).")
    if not settings["copernicus"] and not settings["firms"]:
        raise ValueError("Select at least one data provider.")
    limit, cloud = int(settings["max_products"]), float(settings["cloud_cover"])
    if str(limit) != str(settings["max_products"]) or not 1 <= limit <= 10000 or not math.isfinite(cloud) or not 0 <= cloud <= 100:
        raise ValueError("Products must be 1–10000 and cloud cover 0–100.")
    sources = settings.get("sources", [])
    if settings["firms"] and (not sources or len(set(sources)) != len(sources) or any(v not in SOURCES for v in sources)):
        raise ValueError("Select at least one valid FIRMS sensor.")
    return {"bbox": box, "start": start.isoformat(), "end": end.isoformat(), "output": str(output),
        "copernicus": {"enabled": bool(settings["copernicus"]), "collection": "SENTINEL-2",
            "product_type": "S2MSI2A", "cloud_cover_max": cloud, "max_products": limit,
            "quicklooks": bool(settings["quicklooks"]), "products": bool(settings["products"])},
        "firms": {"enabled": bool(settings["firms"]), "sources": sources}}


def credentials(root):
    env = os.environ.copy()
    path = root / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if key in (*SECRETS, "B2_BUCKET_NAME") and not env.get(key):
                env[key] = value
    return env


class ScraperControl:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.events = Queue()
        self.thread = None
        self.process = None
        self.lock = threading.Lock()
        self.cancel = threading.Event()

    @property
    def active(self):
        return self.thread is not None and self.thread.is_alive()

    def start(self, settings):
        if self.active:
            raise ValueError("A scrape is already running. Stop it before changing areas.")
        settings = copy.deepcopy(settings)
        job = self.root / "raw-work" / ("ui-" + uuid.uuid4().hex)
        config = config_for(settings, job / "data")
        native = self.root / "build/native"
        executable = native / ("fireblock_pipeline.exe" if settings["archive"] else "fireblock_ingest.exe")
        if not executable.is_file() or not (native / "fireblock_ingest.exe").is_file():
            raise ValueError("Build the C++ controllers first with build.cmd.")
        env = credentials(self.root)
        needed = []
        if settings["firms"]:
            needed.append("FIRMS_MAP_KEY")
        if settings["copernicus"] and settings["products"]:
            needed += ["CDSE_USERNAME", "CDSE_PASSWORD"]
        if settings["archive"]:
            needed += ["B2_APPLICATION_KEY_ID", "B2_APPLICATION_KEY"]
            if not settings["bucket"].strip() and not env.get("B2_BUCKET_NAME"):
                raise ValueError("Enter a B2 bucket or set B2_BUCKET_NAME in .env.")
        if any(not env.get(key) for key in needed):
            raise ValueError("Missing credentials in environment/.env: " + ", ".join(k for k in needed if not env.get(k)))
        job.mkdir(parents=True)
        path = job / "ingest.json"
        path.write_text(json.dumps(config, indent=2), encoding="utf-8")
        args = [str(executable)]
        if settings["archive"]:
            args += ["scrape", str(path), "--work", str(job / "raw"), "--prefix", "raw"]
            if settings["bucket"].strip():
                args += ["--bucket", settings["bucket"].strip()]
        else:
            args += [str(path)]
        self.cancel.clear()
        self.events.put(("state", "Starting"))
        self.thread = threading.Thread(target=self._run, args=(args, env, job), daemon=True)
        self.thread.start()
        return job

    def _run(self, args, env, job):
        values = [env[k] for k in SECRETS if env.get(k)]
        def clean(text):
            for value in sorted(values, key=len, reverse=True):
                text = text.replace(value, "[redacted]")
            return text
        try:
            with self.lock:
                if self.cancel.is_set():
                    self.events.put(("state", "Stopped"))
                    return
                self.process = subprocess.Popen(args, cwd=self.root, env=env, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                process = self.process
            self.events.put(("state", "Running"))
            with open(job / "progress.log", "w", encoding="utf-8") as log:
                for line in process.stdout:
                    line = clean(line.rstrip())
                    log.write(line + "\n")
                    log.flush()
                    self.events.put(("log", line))
            process.stdout.close()
            code = process.wait()
            self.events.put(("state", "Stopped" if self.cancel.is_set() else "Complete" if code == 0 else f"Failed (exit {code})"))
        except Exception:
            self.events.put(("state", "Failed to run backend; check the executable and output folder."))
        finally:
            with self.lock:
                self.process = None

    def stop(self):
        if not self.active:
            return
        self.cancel.set()
        self.events.put(("state", "Stopping"))
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
