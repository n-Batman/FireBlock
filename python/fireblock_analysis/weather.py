"""Spatially bounded, timestamped weather snapshots for reproducible risk runs."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def timestamp(value):
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("Weather timestamps must include a timezone")
    return stamp.astimezone(timezone.utc)


def weather_features(path, lon, lat, dx, dy, as_of, max_age_hours=6):
    pressure = np.full(lon.shape, np.nan)
    records = np.full(lon.shape, None, dtype=object)
    selected = np.full(lon.shape, -np.inf)
    if path is None:
        return pressure, records
    path = Path(path)
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("Weather snapshot exceeds 8 MiB")
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    if snapshot.get("schema") != "fireblock.weather.v1" or not isinstance(snapshot.get("records"), list) or len(snapshot["records"]) > 10000:
        raise ValueError("Expected fireblock.weather.v1 with at most 10000 records")
    for record in snapshot["records"]:
        bbox = record.get("bbox")
        if (not isinstance(bbox, list) or len(bbox) != 4 or
                any(type(v) not in (int, float) or not math.isfinite(v) for v in bbox) or
                not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90)):
            raise ValueError("Weather records require a valid bbox")
        if not isinstance(record.get("source"), str) or not record["source"].strip():
            raise ValueError("Weather records require a source")
        issued, start, end = (timestamp(record[k]) for k in ("issued_at", "valid_from", "valid_to"))
        if start >= end:
            raise ValueError("Weather validity interval is empty")
        # Never use a later forecast to reconstruct an earlier run.
        if issued > as_of or not start <= as_of < end or (as_of - issued).total_seconds() > max_age_hours * 3600:
            continue
        values = [record.get(k) for k in ("wind_mph", "humidity_pct", "temperature_c")]
        if any(v is None for v in values):
            continue
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
            raise ValueError("Weather measurements must be finite numbers or null")
        wind, humidity, temperature = values
        if not (0 <= wind <= 250 and 0 <= humidity <= 100 and -100 <= temperature <= 70):
            raise ValueError("Weather measurement outside supported physical range")
        # Conservative: use a forecast only where its declared box covers the whole cell.
        w, s, e, n = bbox
        mask = ((lon - dx/2 >= w - 1e-12) & (lon + dx/2 <= e + 1e-12) &
                (lat - dy/2 >= s - 1e-12) & (lat + dy/2 <= n + 1e-12) &
                (issued.timestamp() > selected))
        value = (.5 * np.clip(wind / 30, 0, 1) +
                 .3 * np.clip((60 - humidity) / 50, 0, 1) +
                 .2 * np.clip((temperature - 15) / 25, 0, 1))
        pressure[mask] = value
        selected[mask] = issued.timestamp()
        for index in zip(*np.where(mask)):
            records[index] = record
    return pressure, records
