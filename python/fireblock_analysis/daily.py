"""Restart-safe daily weather/FIRMS collection and risk analysis."""
import copy
import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .bridge import Backend
from .controller import ParserController
from .pipeline import run, validate, write_json
from .scraper_control import credentials, SOURCES
from .weather import timestamp
from .weather_collect import collect_weather, sample_points


def utc_now():
    return datetime.now(timezone.utc)


def load_job(config):
    job = json.loads(Path(config["analysis_job"]).read_text(encoding="utf-8-sig"))
    job["risk"]["as_of"] = utc_now().isoformat()
    if not job["risk"].get("enabled"):
        raise ValueError("Daily analysis requires risk.enabled=true")
    if "source" in job:
        ParserController.validate(job)
    else:
        validate(job)
    return job


def validate_daily(config):
    if not isinstance(config, dict) or not isinstance(config.get("state_dir"), str) or not config["state_dir"].strip():
        raise ValueError("Daily config requires state_dir")
    if not isinstance(config.get("analysis_job"), str) or not config["analysis_job"].strip():
        raise ValueError("Daily config requires analysis_job")
    if not isinstance(config.get("firms"), dict) or not isinstance(config.get("weather", {}), dict):
        raise ValueError("Daily firms and weather settings must be objects")
    sources = config.get("firms", {}).get("sources", [])
    if not isinstance(sources, list) or not sources or any(source not in SOURCES for source in sources) or len(set(sources)) != len(sources):
        raise ValueError("Daily FIRMS sources must be unique supported NRT sensors")
    days = config["firms"].get("days", 4)
    if type(days) is not int or not 1 <= days <= 5:
        raise ValueError("Daily firms.days must be 1..5")
    satellite = config.get("satellite", {"enabled": False})
    if not isinstance(satellite, dict) or set(satellite) != {"enabled"} or satellite["enabled"] is not False:
        raise ValueError("Satellite collection is reserved for a future adapter; leave enabled=false")
    job = load_job(config)
    sample_points(job["bbox"], config.get("weather", {}))
    return job


@contextmanager
def daily_lock(path):
    """OS-held lock releases on process exit; a leftover lock file cannot block restarts."""
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError("A daily job is already running for this state directory") from None
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def collect_satellite(job, settings, backend, destination):
    """Future collection adapter seam. Today only already-stored scene inputs are reused."""
    if settings.get("enabled", False):
        raise NotImplementedError("Satellite scraping is not connected")
    return job.get("scenes", [])


def run_daily(config, force=False, backend=None, clock=utc_now, weather_collector=collect_weather, analyzer=run):
    job = validate_daily(config)
    state_dir = Path(config["state_dir"]).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    with daily_lock(state_dir / "daily.lock"):
        state_path = state_dir / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else {}
        now = clock()
        if not force:
            if state.get("last_success_at") and now < timestamp(state["last_success_at"]) + timedelta(hours=24):
                return None
            if state.get("last_failure_at") and now < timestamp(state["last_failure_at"]) + timedelta(hours=1):
                return None
        run_dir = state_dir / "runs" / (now.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12])
        run_dir.mkdir(parents=True)
        try:
            backend = backend or Backend(job["storage"])
            if "source" in job:
                job = ParserController(backend).discover(job)
            job["scenes"] = collect_satellite(job, config.get("satellite", {"enabled": False}), backend, run_dir)
            job["risk"]["as_of"] = now.isoformat()
            # Include today's partial UTC day and three preceding days by default.
            # This overlaps successive runs so delayed NRT detections can be revised.
            days = config["firms"].get("days", 4)
            ingest = {"bbox": job["bbox"], "start": (now.date()-timedelta(days=days-1)).isoformat(),
                "end": (now.date()+timedelta(days=1)).isoformat(), "output": str(run_dir / "firms-inputs"),
                "copernicus": {"enabled": False}, "firms": {"enabled": True, "sources": config["firms"]["sources"]}}
            ingest_path = run_dir / "ingest.json"
            write_json(ingest_path, ingest)
            backend.ingest(ingest_path, environment=credentials(Path.cwd()))
            paths = sorted((run_dir / "firms-inputs" / "firms").glob("*.csv"))
            if len(paths) != len(config["firms"]["sources"]):
                raise ValueError("FIRMS collection did not produce one CSV per configured source")
            job["firms"] = [{"id": f"daily_firms_{index}", "input": {"local": str(path)}} for index, path in enumerate(paths)]
            weather_options = {**config.get("weather", {}), "max_age_hours": job["risk"].get("weather_max_age_hours", 6)}
            snapshot = weather_collector(job["bbox"], weather_options, run_dir / "weather", now)
            job["weather"] = {"local": str(snapshot)}
            write_json(run_dir / "analysis-job.json", job)
            manifest_path = Path(analyzer(job, backend))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("status") != "complete":
                raise ValueError("Daily analysis did not complete")
            write_json(state_path, {"last_success_at": clock().isoformat(), "manifest": str(manifest_path),
                "run_dir": str(run_dir)})
            return manifest_path
        except Exception as error:
            write_json(state_path, {**state, "last_failure_at": clock().isoformat(),
                "error_type": type(error).__name__, "failed_run_dir": str(run_dir)})
            raise


def watch_daily(config):
    """Poll cheaply; provider work happens only when due. Failure retry delay is one hour."""
    while True:
        try:
            manifest = run_daily(config)
            if manifest:
                print("Daily weather/FIRMS analysis completed", flush=True)
        except Exception as error:
            # HTTP exception text can include credential-bearing provider URLs.
            print(f"Daily job failed ({type(error).__name__}); schedule not advanced", flush=True)
        time.sleep(60)
