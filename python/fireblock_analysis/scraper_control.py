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


class EventQueue(Queue):
    """Keep recent UI updates without blocking the worker when the UI is busy.

    The complete redacted log remains on disk; only old UI updates are evicted.
    """
    def __init__(self):
        super().__init__(maxsize=1024)

    def put(self, item, block=True, timeout=None):
        kind, value = item
        if isinstance(value, str):
            value = value[:8192]
        with self.not_full:
            if self._qsize() >= self.maxsize:
                self._get()
                self.unfinished_tasks -= 1
            self._put((kind, value))
            self.unfinished_tasks += 1
            self.not_empty.notify()


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


def collection_tiles(settings):
    """Seed-centered, non-overlapping WGS84 boxes in a square spiral."""
    base = [float(settings[k]) for k in ("west", "south", "east", "north")]
    if not all(math.isfinite(v) for v in base) or not (-180 <= base[0] < base[2] <= 180 and -90 <= base[1] < base[3] <= 90):
        raise ValueError("Enter a valid starting area.")
    if not settings.get("spiral", False):
        return [{"index": 1, "offset": [0, 0], "bbox": base}]
    side = float(settings["box_m"]) / 1000 if "box_m" in settings else float(settings.get("box_km", 1))
    raw_count = settings.get("box_count", 9)
    count = int(raw_count)
    if not math.isfinite(side) or not .1 <= side <= 50 or str(count) != str(raw_count) or not 1 <= count <= 1000:
        raise ValueError("Spiral box side must be 0.1–50 km; total boxes must be 1–1000.")
    lon, lat = (base[0] + base[2]) / 2, (base[1] + base[3]) / 2
    if abs(lat) > 80:
        raise ValueError("Spiral collection supports starting latitudes -80 to 80.")
    dy = side / 111.195
    dx = dy / math.cos(math.radians(lat))
    offsets = [(0, 0)]
    x = y = 0
    step = 1
    directions = ((1, 0), (0, 1), (-1, 0), (0, -1))
    direction = 0
    while len(offsets) < count:
        for _ in range(2):
            a, b = directions[direction % 4]
            for _ in range(step):
                x, y = x + a, y + b
                offsets.append((x, y))
                if len(offsets) == count:
                    break
            direction += 1
            if len(offsets) == count:
                break
        step += 1
    tiles = []
    for i, (x, y) in enumerate(offsets):
        box = [lon + (x - .5)*dx, lat + (y - .5)*dy, lon + (x + .5)*dx, lat + (y + .5)*dy]
        if box[0] < -180 or box[2] > 180 or box[1] < -85 or box[3] > 85:
            raise ValueError("Spiral crosses the antimeridian or polar boundary; choose a smaller region.")
        tiles.append({"index": i+1, "offset": [x,y], "bbox": box})
    return tiles


class ScraperControl:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.events = EventQueue()
        self.thread = None
        self.process = None
        self.lock = threading.Lock()
        self.cancel = threading.Event()

    @property
    def active(self):
        process = self.process
        return ((self.thread is not None and self.thread.is_alive()) or
                (process is not None and process.poll() is None))

    def start(self, settings):
        if self.active:
            raise ValueError("A scrape is already running. Stop it before changing areas.")
        settings = copy.deepcopy(settings)
        job = self.root / "raw-work" / ("ui-" + uuid.uuid4().hex)
        config = config_for(settings, job / "data")
        tiles = collection_tiles(settings)
        # Use a complete newer verification build if an active job locked the
        # normal executable during rebuild; never interrupt that active job.
        candidates = [self.root / "build/native", self.root / "build/dedupe"]
        name = "fireblock_pipeline.exe" if settings["archive"] else "fireblock_ingest.exe"
        available = [p for p in candidates if (p/name).is_file() and (p/"fireblock_ingest.exe").is_file()]
        native = max(available, key=lambda p:(p/name).stat().st_mtime) if available else candidates[0]
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
        commands = []
        for tile in tiles:
            tile_root = job / f"box-{tile['index']:04d}" if settings.get("spiral", False) else job
            tile_root.mkdir(exist_ok=True)
            tile_path = tile_root / "ingest.json"
            tile_config = copy.deepcopy(config)
            tile_config["bbox"], tile_config["output"] = tile["bbox"], str(tile_root / "data")
            if not settings["archive"]:
                tile_config["copernicus"]["local_cache_root"] = str(job / "shared/copernicus")
            tile_path.write_text(json.dumps(tile_config, indent=2), encoding="utf-8")
            args = [str(executable)]
            if settings["archive"]:
                args += ["scrape", str(tile_path), "--work", str(tile_root / "raw"), "--prefix", "raw"]
                if settings["bucket"].strip():
                    args += ["--bucket", settings["bucket"].strip()]
            else:
                args += [str(tile_path)]
            tile["status"] = "pending"
            commands.append(args)
        side_m = float(settings["box_m"]) if "box_m" in settings else float(settings.get("box_km", 1))*1000
        plan = {"mode": "square_spiral" if settings.get("spiral", False) else "single_area", "box_m": side_m, "tiles": tiles}
        (job / "collection-plan.json").write_text(json.dumps(plan, indent=2), encoding="utf-8")
        self.cancel.clear()
        self.events.put(("state", "Starting"))
        self.thread = threading.Thread(target=self._run, args=(commands, env, job, plan), daemon=True)
        self.thread.start()
        return job

    def _run(self, commands, env, job, plan):
        values = [env[k] for k in SECRETS if env.get(k)]
        def clean(text):
            for value in sorted(values, key=len, reverse=True):
                text = text.replace(value, "[redacted]")
            return text
        try:
            with open(job / "progress.log", "w", encoding="utf-8") as log:
                self.events.put(("progress", (0, len(commands))))
                for i, args in enumerate(commands):
                    with self.lock:
                        if self.cancel.is_set():
                            self.events.put(("state", "Stopped"))
                            return
                        self.process = subprocess.Popen(args, cwd=self.root, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                        process = self.process
                    tile = plan["tiles"][i]
                    tile["status"] = "running"
                    self.events.put(("state", f"Box {i+1}/{len(commands)} · offset {tile['offset']}"))
                    log.write(f"Box {i+1}/{len(commands)}: {tile['bbox']}\n")
                    last_error = "Backend returned a nonzero exit code; check progress.log."
                    for line in process.stdout:
                        line = clean(line.rstrip())
                        if "failed:" in line.lower() or "after 4 attempts" in line.lower():
                            last_error = line[:4096]
                        log.write(line + "\n")
                        log.flush()
                        self.events.put(("log", line))
                    process.stdout.close()
                    code = process.wait()
                    tile["status"] = "stopped" if self.cancel.is_set() else "complete" if code == 0 else "failed"
                    if code and not self.cancel.is_set():
                        message = f"Collection stopped on box {i+1}/{len(commands)} (exit {code}). {last_error}"
                        tile["error"] = message
                        (job / "error.json").write_text(json.dumps({"box": i+1, "exit_code": code,
                            "message": message}, indent=2), encoding="utf-8")
                        log.write(message + "\n")
                        log.flush()
                        self.events.put(("error", message))
                    temporary = job / "collection-plan.json.part"
                    temporary.write_text(json.dumps(plan, indent=2), encoding="utf-8")
                    temporary.replace(job / "collection-plan.json")
                    if self.cancel.is_set() or code:
                        self.events.put(("state", "Stopped" if self.cancel.is_set() else f"Failed on box {i+1} (exit {code}): {last_error}"))
                        return
                    self.events.put(("progress", (i+1, len(commands))))
                self.events.put(("state", "Complete"))
        except Exception as exc:
            self.events.put(("state", f"Failed to run backend ({type(exc).__name__}); check the executable and output folder."))
        finally:
            # A read/log/plan-write failure must not orphan the native scraper.
            # Terminate before closing its pipe, then reap it; escalate a hung
            # graceful stop to kill without touching other controller instances.
            with self.lock:
                process = self.process
            if process is not None:
                try:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)
                    else:
                        process.wait()
                finally:
                    if process.stdout is not None:
                        process.stdout.close()
                    with self.lock:
                        if process.poll() is not None:
                            self.process = None

    def stop(self):
        if not self.active:
            return
        self.cancel.set()
        self.events.put(("state", "Stopping"))
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
