"""Bounded NWS hourly collection; forecasts retain their real spatial footprints."""
import math
import os
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.parse import urlsplit

import numpy as np

from .pipeline import write_json
from .weather import polygon_coverage, timestamp, weather_features

BASE = "https://api.weather.gov"
DEFAULT_AGENT = "FireBlock/0.1 (https://github.com/n-Batman/FireBlock)"


def nws_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "api.weather.gov" or parsed.query or parsed.fragment or
            not re.fullmatch(r"/(points/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?|gridpoints/[A-Z]{3}/\d+,\d+/forecast/hourly)", parsed.path)):
        raise ValueError("Unexpected NWS endpoint")
    return url


class NWSRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        nws_url(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def fetch_nws(url):
    import json
    request = Request(nws_url(url), headers={"Accept": "application/geo+json",
        "User-Agent": os.environ.get("NWS_USER_AGENT", DEFAULT_AGENT)})
    for attempt in range(3):
        try:
            with build_opener(NWSRedirect()).open(request, timeout=20) as response:
                content = response.read(8 * 1024 * 1024 + 1)
            if len(content) > 8 * 1024 * 1024:
                raise ValueError("NWS response exceeds 8 MiB")
            data = json.loads(content)
            if not isinstance(data, dict):
                raise ValueError("Expected NWS object")
            return data
        except HTTPError as error:
            if error.code not in (408, 429) and error.code < 500:
                raise RuntimeError("NWS request failed") from None
        except (URLError, TimeoutError):
            pass
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise RuntimeError("NWS request failed after retries")


def sample_points(bbox, options):
    spacing = options.get("sample_km", 2)
    limit = options.get("max_points", 256)
    if type(spacing) not in (int, float) or not math.isfinite(spacing) or not .5 <= spacing <= 5:
        raise ValueError("weather.sample_km must be 0.5..5")
    if type(limit) is not int or not 1 <= limit <= 1024:
        raise ValueError("weather.max_points must be 1..1024")
    west, south, east, north = bbox
    cols = max(1, math.ceil((east-west) * 111.32 * math.cos(math.radians((south+north)/2)) / spacing))
    rows = max(1, math.ceil((north-south) * 111.32 / spacing))
    if rows * cols > limit:
        raise ValueError("Weather sample grid exceeds max_points; use a smaller region")
    return [(round(west+(c+.5)*(east-west)/cols, 4), round(south+(r+.5)*(north-south)/rows, 4))
        for r in range(rows) for c in range(cols)]


def wind_mph(value):
    if isinstance(value, dict):
        number = value.get("value")
        factor = {"wmoUnit:mi_h-1": 1, "wmoUnit:km_h-1": 1/1.609344, "wmoUnit:m_s-1": 2.2369362921}.get(value.get("unitCode"))
        return number * factor if type(number) in (int, float) and math.isfinite(number) and factor else None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))? mph", value or "") if isinstance(value, str) else None
    return max(float(v) for v in match.groups() if v is not None) if match else None


def collect_weather(bbox, options, destination, as_of, fetch=fetch_nws):
    """Fetch each sampled forecast grid once; save raw responses and normalized input."""
    destination.mkdir(parents=True, exist_ok=False)
    seen, records = set(), []
    points = sample_points(bbox, options)
    for index, (lon, lat) in enumerate(points):
        point = fetch(f"{BASE}/points/{lat},{lon}")
        write_json(destination / f"point-{index}.json", point)
        url = nws_url(point["properties"]["forecastHourly"])
        if url in seen:
            continue
        seen.add(url)
        forecast = fetch(url)
        write_json(destination / f"forecast-{len(seen)}.json", forecast)
        geometry = forecast["geometry"]
        if geometry["type"] != "Polygon" or len(geometry["coordinates"]) != 1:
            raise ValueError("NWS forecast requires one convex footprint")
        ring = geometry["coordinates"][0]
        polygon_coverage(ring, np.array([lon]), np.array([lat]), 0, 0)
        box = [min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring)]
        props = forecast["properties"]
        issued = props["updateTime"]
        if timestamp(issued) > as_of:
            raise ValueError("NWS issue time is later than the analysis time")
        for period in props["periods"]:
            if not timestamp(period["startTime"]) <= as_of < timestamp(period["endTime"]):
                continue
            temperature = period.get("temperature")
            if type(temperature) not in (int, float) or not math.isfinite(temperature):
                temperature = None
            elif period.get("temperatureUnit") == "F":
                temperature = (temperature-32) * 5/9
            elif period.get("temperatureUnit") != "C":
                temperature = None
            humidity = period.get("relativeHumidity") or {}
            records.append({"source": "National Weather Service", "source_url": url,
                "bbox": box, "coverage_polygon": ring, "issued_at": issued,
                "valid_from": period["startTime"], "valid_to": period["endTime"],
                "wind_mph": wind_mph(period.get("windSpeed")), "humidity_pct": humidity.get("value"),
                "temperature_c": temperature})
            break
    if not records:
        raise ValueError("NWS returned no current weather periods")
    path = destination / "snapshot.json"
    write_json(path, {"schema": "fireblock.weather.v1", "records": records})
    lon, lat = np.array(points).T
    pressure, _ = weather_features(path, lon, lat, 0, 0, as_of, options.get("max_age_hours", 6))
    if not np.isfinite(pressure).any():
        raise ValueError("NWS has no usable fresh wind/humidity/temperature measurements")
    return path
