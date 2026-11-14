"""Normalize NASA FIRMS CSV without interpreting detections as fire perimeters."""
import csv
import json
import math
from datetime import datetime, timezone


def number(value, optional=False):
    if optional and (value is None or str(value).strip() == ""):
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Non-finite number")
    return result


def parse_firms(source, destination, bbox=None):
    """Write NDJSON Features. Preserve confidence units and original attributes."""
    summary = {"accepted": 0, "rejected": 0, "outside_bbox": 0, "duplicates": 0,
               "confidence_counts": {}, "frp_mw_sum_of_detections": 0.0,
               "frp_missing": 0, "first_acquired_at": None, "last_acquired_at": None,
               "interpretation": "Thermal anomaly detections, not unique fires or burned area"}
    seen = set()
    with open(source, encoding="utf-8-sig", newline="") as stream, open(destination, "w", encoding="utf-8") as out:
        reader = csv.DictReader(stream, strict=True)
        fields = reader.fieldnames or []
        required = {"latitude", "longitude", "acq_date", "acq_time"}
        if not required.issubset(fields) or len(fields) != len(set(fields)):
            raise ValueError("FIRMS CSV needs unique headers including latitude, longitude, acq_date, acq_time")
        for row in reader:
            try:
                if None in row or any(v is None for v in row.values()):
                    raise ValueError("Wrong field count")
                lat, lon = number(row["latitude"]), number(row["longitude"])
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError("Coordinates outside WGS84")
                hhmm = row["acq_time"].strip()
                if not hhmm.isdigit() or len(hhmm) > 4:
                    raise ValueError("Invalid HHMM")
                hhmm = hhmm.zfill(4)
                stamp = datetime.strptime(row["acq_date"] + "T" + hhmm, "%Y-%m-%dT%H%M").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
                frp = number(row.get("frp"), optional=True)
                if frp is not None and frp < 0:
                    raise ValueError("Negative FRP")
                brightness = {k: number(row.get(k), optional=True) for k in ("brightness", "bright_t31", "bright_ti4", "bright_ti5") if k in row}
                confidence = row.get("confidence", "").strip()
                if confidence:
                    labels = {"l": "low", "n": "nominal", "h": "high", "low": "low", "nominal": "nominal", "high": "high"}
                    if confidence.lower() in labels:
                        normalized = {"kind": "viirs_category", "value": labels[confidence.lower()]}
                    else:
                        numeric = number(confidence)
                        if not 0 <= numeric <= 100:
                            raise ValueError("Confidence outside 0..100")
                        normalized = {"kind": "numeric_0_100", "value": numeric}
                else:
                    normalized = {"kind": "missing", "value": None}
            except (ValueError, TypeError, OverflowError):
                summary["rejected"] += 1
                continue
            if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
                summary["outside_bbox"] += 1
                continue
            # Only exact duplicate records in THIS source file are removed.
            identity = tuple(row.items())
            if identity in seen:
                summary["duplicates"] += 1
                continue
            seen.add(identity)
            feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                       "properties": {"provider": "NASA FIRMS", "acquired_at": stamp, "frp_mw": frp,
                                      "confidence": normalized, "brightness_kelvin": brightness,
                                      "source_record": reader.line_num, "attributes": row}}
            out.write(json.dumps(feature, allow_nan=False) + "\n")
            summary["accepted"] += 1
            label = str(normalized["value"])
            summary["confidence_counts"][label] = summary["confidence_counts"].get(label, 0) + 1
            summary["frp_mw_sum_of_detections"] += frp or 0
            summary["frp_missing"] += frp is None
            summary["first_acquired_at"] = min(summary["first_acquired_at"] or stamp, stamp)
            summary["last_acquired_at"] = max(summary["last_acquired_at"] or stamp, stamp)
    return summary
