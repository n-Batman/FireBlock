"""Versioned, explainable relative susceptibility map; never an ignition probability."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from .risk_model import MathematicalRiskModel, evaluate_model

MODEL_ID = MathematicalRiskModel.model_id
FEATURE_SCHEMA = "fireblock.risk-features.v1"


def utc(value):
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("Map timestamps must include a timezone")
    return stamp.astimezone(timezone.utc)


def validate_risk(options, bbox):
    if not isinstance(options, dict):
        raise ValueError("risk must be an object")
    if type(options.get("enabled", False)) is not bool:
        raise ValueError("risk.enabled must be boolean")
    if not options.get("enabled", False):
        return
    if (not isinstance(bbox, list) or len(bbox) != 4 or
            not all(type(v) in (int, float) and math.isfinite(v) for v in bbox) or
            not (-180 <= bbox[0] < bbox[2] <= 180 and -80 <= bbox[1] < bbox[3] <= 80)):
        raise ValueError("Risk maps require bbox [west,south,east,north] within latitudes -80..80")
    utc(options["as_of"])
    for key, default, low, high in (("cell_km", .2, .1, 50), ("hotspot_radius_km", 10, .1, 100),
            ("hotspot_half_life_hours", 24, 1, 168), ("hotspot_max_age_hours", 72, 1, 720),
            ("scene_max_age_days", 30, 1, 365), ("min_valid_fraction", .6, .01, 1)):
        value = options.get(key, default)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"Invalid risk.{key}")
    for key, default, low, high in (("max_cells", 10000, 1, 50000), ("samples_per_cell", 8, 4, 32)):
        value = options.get(key, default)
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f"Invalid risk.{key}")
    for key, default in (("dryness_weight", .7), ("hotspot_weight", .3)):
        value = options.get(key, default)
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError(f"Invalid risk.{key}")
    if options.get("dryness_weight", .7) + options.get("hotspot_weight", .3) <= 0:
        raise ValueError("Risk weights must have a positive sum")
    grid(bbox, options)


def grid(bbox, options):
    west, south, east, north = bbox
    km = options.get("cell_km", .2)
    rows = max(1, math.ceil((north - south) * 111.195 / km))
    cols = max(1, math.ceil((east - west) * 111.195 * math.cos(math.radians((north + south) / 2)) / km))
    if rows * cols > options.get("max_cells", 10000):
        raise ValueError("Risk grid exceeds max_cells; narrow bbox or increase cell_km")
    return rows, cols


def raster_cells(path, bbox, rows, cols, samples):
    """Sample area-averaged index pixels, retaining explicit no-data coverage."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window

    means = np.full((rows, cols), np.nan)
    fractions = np.zeros((rows, cols))
    with rasterio.open(path) as src:
        if src.count != 1 or not src.crs:
            raise ValueError("Risk input must be a georeferenced single-band index raster")
        with WarpedVRT(src, crs="EPSG:4326", transform=from_bounds(*bbox, cols * samples, rows * samples),
                width=cols * samples, height=rows * samples, nodata=float("nan"), dtype="float32",
                resampling=Resampling.average) as vrt:
            for first in range(0, rows, 16):
                count = min(16, rows - first)
                for left in range(0, cols, 128):
                    width = min(128, cols - left)
                    window = Window(left * samples, first * samples, width * samples, count * samples)
                    values = vrt.read(1, window=window, masked=True)
                    data = values.filled(np.nan).reshape(count, samples, width, samples)
                    valid = np.isfinite(data) & (data >= -1.00001) & (data <= 1.00001)
                    counts = valid.sum(axis=(1, 3))
                    total = np.where(valid, data, 0).sum(axis=(1, 3))
                    np.divide(total, counts, out=means[first:first + count, left:left + width], where=counts > 0)
                    fractions[first:first + count, left:left + width] = counts / (samples * samples)
    return means, fractions


def distance_km(lon, lat, point_lon, point_lat):
    a, b = np.radians(lat), math.radians(point_lat)
    dlat, dlon = a - b, np.radians(lon - point_lon)
    h = np.sin(dlat / 2) ** 2 + np.cos(a) * math.cos(b) * np.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def score_features(ndvi, ndmi, pressure, options):
    vegetation = np.clip((ndvi - .2) / .6, 0, 1)
    dryness = np.clip((.4 - ndmi) / .8, 0, 1)
    score = evaluate_model(MathematicalRiskModel(), {"ndvi": ndvi, "ndmi": ndmi, "hotspot_pressure": pressure}, options)
    return score, vegetation, dryness


def write_map(path, collection, summary):
    # Keep the grid in its own cacheable file instead of embedding it in HTML.
    # A file picker also supports local viewing when file:// blocks fetch.
    import hashlib
    path = Path(path)
    data = json.dumps(collection, allow_nan=False)
    (path.parent / "risk_map.geojson").write_text(data, encoding="utf-8")
    data_url = "risk_map.geojson?v=" + hashlib.sha256(data.encode("utf-8")).hexdigest()[:16]
    metadata = json.dumps(summary, allow_nan=False).replace("<", "\\u003c")
    template = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FireBlock · Fire risk map</title><style>
body{margin:0;background:#111a20;color:#edf2ed;font:15px system-ui}header{padding:22px 28px;border-bottom:1px solid #38423f}
h1{margin:0 0 8px;font-size:27px}main{display:grid;grid-template-columns:1fr 310px;gap:16px;padding:20px}svg{width:100%;height:72vh;background:#25312e;touch-action:none;border-radius:12px}aside{padding:10px}button{padding:8px 15px;margin:5px;background:#e9eee5;border:0;border-radius:6px;cursor:pointer}.legend{height:14px;background:linear-gradient(90deg,#f7e8a4,#e89239,#ab2635);margin:12px 0}.note{color:#b7c6bd;line-height:1.5}#detail{white-space:pre-wrap;font:12px ui-monospace;max-height:38vh;overflow:auto}label{display:block;margin:12px 0}@media(max-width:750px){main{grid-template-columns:1fr}svg{height:55vh}}</style>
<header><h1>FireBlock / Fire risk</h1><div id="subtitle"></div></header><main><section>
<svg id="map" role="img" aria-label="Relative fire susceptibility grid and recent satellite thermal detections"><defs><pattern id="unknown" width=".25" height=".25" patternUnits="objectBoundingBox" viewBox="0 0 8 8"><rect width="8" height="8" fill="#53605b"/><path d="M0 8L8 0" stroke="#78857d"/></pattern></defs><g id="cells"></g><g id="points"></g></svg>
<button id="plus">Zoom +</button><button id="minus">Zoom −</button><button id="reset">Reset</button><a href="risk_map.geojson" download><button>Download GeoJSON</button></a><p id="localLoad" hidden><label>Choose this map's GeoJSON file to view it offline: <input id="gridFile" type="file" accept=".geojson,.json"></label></p></section>
<aside><strong>Relative susceptibility · 0–100</strong><div class="legend"></div><div>Lower ← → Higher</div><p class="note">Hatched cells: unknown / insufficient fresh imagery. No hotspot detection does not establish safety.</p>
<label><input id="showHeat" type="checkbox" checked> Recent thermal detections</label><label><input id="showCells" type="checkbox" checked> Relative-risk grid</label><div id="coverage"></div><p class="note">Experimental index from vegetation, moisture and recent thermal activity. Not a calibrated fire probability or an operational forecast.</p><pre id="detail">Hover over a cell or detection for its inputs.</pre></aside></main><script>
const meta=__META__,svg=document.getElementById('map'),ns='http://www.w3.org/2000/svg';
const [w,s,e,n]=meta.bbox,cos=Math.cos((n+s)/2*Math.PI/180),width=(e-w)*cos,height=n-s;
let box=[0,0,width,height];function view(){svg.setAttribute('viewBox',box.join(' '))}view();
document.getElementById('subtitle').textContent=(meta.data_label?meta.data_label+' · ':'')+'As of '+meta.as_of+' · '+meta.model_id;
document.getElementById('coverage').textContent=meta.known_cells+' of '+meta.total_cells+' cells have sufficient fresh imagery.';
function xy(p){return [(p[0]-w)*cos,n-p[1]]}function add(type,group,feature){const el=document.createElementNS(ns,type),p=feature.properties;
if(type==='polygon'){el.setAttribute('points',feature.geometry.coordinates[0].map(xy).map(q=>q.join(',')).join(' '));el.setAttribute('fill',p.risk_score===null?'url(#unknown)':`hsl(${45-p.risk_score*.45} 75% ${75-p.risk_score*.38}%)`);el.setAttribute('stroke','#17201c');el.setAttribute('stroke-width',width/1800)}
else{const q=xy(feature.geometry.coordinates);el.setAttribute('cx',q[0]);el.setAttribute('cy',q[1]);el.setAttribute('r',width/250);el.setAttribute('fill','#ffeff0');el.setAttribute('stroke','#d53f53');el.setAttribute('stroke-width',width/1000)}
el.addEventListener('mouseenter',()=>document.getElementById('detail').textContent=JSON.stringify(p,null,2));group.appendChild(el)}
function draw(data){
if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>150000)throw new Error('Invalid map data');
const first=data.features.find(f=>f.properties?.layer==='relative_risk');
if(!first||first.properties.model_id!==meta.model_id||first.properties.as_of!==meta.as_of)throw new Error('Choose the GeoJSON matching this map');
document.getElementById('cells').replaceChildren();document.getElementById('points').replaceChildren();
for(const f of data.features)add(f.geometry.type==='Point'?'circle':'polygon',document.getElementById(f.geometry.type==='Point'?'points':'cells'),f);
document.getElementById('detail').textContent='Hover over a cell or detection for its inputs.';
}
function loadError(){document.getElementById('detail').textContent='Map data could not be loaded. Retry or choose the matching GeoJSON file below the map.';document.getElementById('localLoad').hidden=false;}
document.getElementById('detail').textContent='Loading map data…';
fetch(__DATA_URL__).then(response=>{if(!response.ok)throw new Error('Map data unavailable');return response.json();}).then(draw).catch(loadError);
document.getElementById('gridFile').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>25*1024*1024)throw new Error('File too large');draw(JSON.parse(await file.text()));}catch{loadError();}};
function zoom(f){box=[box[0]+box[2]*(1-f)/2,box[1]+box[3]*(1-f)/2,box[2]*f,box[3]*f];view()}
document.getElementById('plus').onclick=()=>zoom(.7);document.getElementById('minus').onclick=()=>zoom(1.4);document.getElementById('reset').onclick=()=>{box=[0,0,width,height];view()};
document.getElementById('showHeat').onchange=e=>document.getElementById('points').style.display=e.target.checked?'':'none';document.getElementById('showCells').onchange=e=>document.getElementById('cells').style.display=e.target.checked?'':'none';
let drag=null;svg.onpointerdown=e=>{drag=[e.clientX,e.clientY,...box];svg.setPointerCapture(e.pointerId)};svg.onpointerup=()=>drag=null;
svg.onpointermove=e=>{if(!drag)return;const scale=Math.min(svg.clientWidth/drag[4],svg.clientHeight/drag[5]);box=[drag[2]-(e.clientX-drag[0])/scale,drag[3]-(e.clientY-drag[1])/scale,drag[4],drag[5]];view()};
svg.onwheel=e=>{e.preventDefault();zoom(e.deltaY>0?1.2:.8)};
</script></html>'''
    path.write_text(template.replace("__DATA_URL__", json.dumps(data_url)).replace("__META__", metadata), encoding="utf-8")


def build_risk(manifest, root, options, bbox, model=None):
    validate_risk(options, bbox)
    as_of = utc(options["as_of"])
    model = model or MathematicalRiskModel()
    rows, cols = grid(bbox, options)
    root = Path(root)
    destination = root / "risk"
    destination.mkdir(exist_ok=False)
    ndvi, ndmi = np.full((rows, cols), np.nan), np.full((rows, cols), np.nan)
    coverage = np.zeros((rows, cols))
    scene_ids = np.full((rows, cols), None, dtype=object)
    scene_times = np.full((rows, cols), None, dtype=object)
    scene_diagnostics = []
    scenes = []
    for scene in manifest.get("scenes", []):
        try:
            stamp = utc(scene["acquired_at"])
            age = (as_of - stamp).total_seconds() / 86400
            if age < 0 or age > options.get("scene_max_age_days", 30):
                raise ValueError("stale_or_future")
            scenes.append((stamp, scene))
        except (KeyError, ValueError, TypeError, AttributeError):
            scene_diagnostics.append({"id": scene["id"], "status": "excluded_missing_stale_or_future_time"})
    for stamp, scene in sorted(scenes, key=lambda v: (v[0], v[1]["id"]), reverse=True):
        values, fractions = [], []
        for name in ("ndvi", "ndmi"):
            # Paths are generated by the current analysis worker, not remote keys.
            path = root / scene["id"] / scene["indices"][name]["raster"]
            if path.resolve().parent != (root / scene["id"]).resolve():
                raise ValueError("Index raster is outside scene directory")
            value, fraction = raster_cells(path, bbox, rows, cols, options.get("samples_per_cell", 8))
            values.append(value)
            fractions.append(fraction)
        valid_fraction = np.minimum(*fractions)
        valid = np.isfinite(values[0]) & np.isfinite(values[1]) & (valid_fraction >= options.get("min_valid_fraction", .6)) & ~np.isfinite(ndvi)
        ndvi[valid], ndmi[valid] = values[0][valid], values[1][valid]
        coverage[valid], scene_ids[valid], scene_times[valid] = valid_fraction[valid], scene["id"], stamp.isoformat().replace("+00:00", "Z")
        scene_diagnostics.append({"id": scene["id"], "status": "considered", "selected_cells": int(valid.sum())})
    west, south, east, north = bbox
    dx, dy = (east - west) / cols, (north - south) / rows
    lon, lat = np.meshgrid(west + (np.arange(cols) + .5) * dx, north - (np.arange(rows) + .5) * dy)
    pressure = np.zeros((rows, cols))
    detections, seen = [], set()
    ignored = {"future": 0, "stale": 0, "low_confidence": 0, "duplicates": 0}
    for source in manifest.get("firms", []):
        with open(root / source["id"] / "detections.ndjson", encoding="utf-8") as stream:
            for line in stream:
                feature = json.loads(line)
                p = feature["properties"]
                x, y = feature["geometry"]["coordinates"]
                age = (as_of - utc(p["acquired_at"])).total_seconds() / 3600
                if age < 0:
                    ignored["future"] += 1
                    continue
                if age > options.get("hotspot_max_age_hours", 72):
                    ignored["stale"] += 1
                    continue
                confidence = p.get("confidence", {})
                if confidence.get("kind") == "viirs_category" and confidence.get("value") == "low":
                    ignored["low_confidence"] += 1
                    continue
                if confidence.get("kind") == "numeric_0_100" and confidence.get("value", 0) < 30:
                    ignored["low_confidence"] += 1
                    continue
                attrs = p.get("attributes", {})
                identity = (x, y, p["acquired_at"], attrs.get("satellite"), attrs.get("instrument"))
                if identity in seen:
                    ignored["duplicates"] += 1
                    continue
                seen.add(identity)
                if len(seen) > 100000:
                    raise ValueError("More than 100000 recent detections; narrow the input region/date window")
                radius = options.get("hotspot_radius_km", 10)
                # Compute only a bounding rectangle near the detection, not the entire map.
                lat_extent = radius / 110.5
                lon_extent = min(180, radius / (110.5 * max(.01, math.cos(math.radians(y)))))
                c0, c1 = max(0, math.floor((x - lon_extent - west) / dx)), min(cols, math.ceil((x + lon_extent - west) / dx))
                r0, r1 = max(0, math.floor((north - y - lat_extent) / dy)), min(rows, math.ceil((north - y + lat_extent) / dy))
                c0, c1 = min(cols, c0), max(0, c1)
                r0, r1 = min(rows, r0), max(0, r1)
                cells = np.s_[r0:r1, c0:c1]
                distance = distance_km(lon[cells], lat[cells], x, y)
                effect = np.exp(-distance / radius) * 2 ** (-age / options.get("hotspot_half_life_hours", 24))
                effect[distance > radius] = 0
                pressure[cells] = np.maximum(pressure[cells], effect)
                detections.append({"type": "Feature", "geometry": feature["geometry"], "properties": {
                    "layer": "thermal_detection", "acquired_at": p["acquired_at"], "age_hours": age,
                    "frp_mw": p.get("frp_mw"), "confidence": confidence, "source_id": source["id"]}})
    score = evaluate_model(model, {"ndvi":ndvi,"ndmi":ndmi,"hotspot_pressure":pressure}, options)
    vegetation, dryness = np.clip((ndvi-.2)/.6,0,1), np.clip((.4-ndmi)/.8,0,1)
    features = []
    with open(destination / "features.ndjson", "w", encoding="utf-8") as out:
        for r in range(rows):
            for c in range(cols):
                known = bool(np.isfinite(score[r, c]))
                x, top = west + c * dx, north - r * dy
                props = {"layer": "relative_risk", "cell_id": f"r{r}c{c}", "feature_schema": FEATURE_SCHEMA,
                    "model_id": model.model_id, "as_of": options["as_of"], "risk_score": float(score[r, c]) if known else None,
                    "status": "estimated" if known else "unknown_insufficient_fresh_imagery",
                    "ndvi": float(ndvi[r, c]) if known else None, "ndmi": float(ndmi[r, c]) if known else None,
                    "vegetation_proxy": float(vegetation[r, c]) if known else None,
                    "dryness_proxy": float(dryness[r, c]) if known else None,
                    "hotspot_pressure": float(pressure[r, c]), "sampled_valid_fraction": float(coverage[r, c]),
                    "scene_id": scene_ids[r, c], "scene_acquired_at": scene_times[r, c]}
                feature = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[x, top], [x + dx, top],
                    [x + dx, top - dy], [x, top - dy], [x, top]]]}, "properties": props}
                out.write(json.dumps(feature, allow_nan=False) + "\n")
                features.append(feature)
    summary = {"model_id": model.model_id, "model_kind": "mathematical" if isinstance(model, MathematicalRiskModel) else "custom", "feature_schema": FEATURE_SCHEMA, "as_of": options["as_of"], "bbox": bbox,
        "rows": rows, "columns": cols, "total_cells": rows * cols, "known_cells": int(np.isfinite(score).sum()),
        "recent_detections": len(detections), "ignored_detections": ignored, "scenes": scene_diagnostics,
        "parameters": options, "prediction_available": False, "data_label": options.get("data_label", "Parsed satellite observations"),
        "interpretation": "Experimental relative susceptibility index, not ignition probability or operational fire danger",
        "formula": "100 * vegetation_proxy * (dryness_weight * dryness_proxy + hotspot_weight * hotspot_pressure) / sum(weights)" if isinstance(model, MathematicalRiskModel) else "Defined by supplied model; see model_id",
        "feature_transforms": {"vegetation_proxy": "clip((NDVI-0.2)/0.6,0,1)",
            "dryness_proxy": "clip((0.4-NDMI)/0.8,0,1)",
            "hotspot_pressure": "max(exp(-distance_km/radius_km) * 2^(-age_hours/half_life_hours)) within radius"},
        "limitations": ["No weather, wind, terrain, dead-fuel measurements or exposure model",
            "Missing detections do not establish absence of fire", "Coverage is sampled; cell sizes are approximate kilometres",
            "NDVI and NDMI are spectral proxies; no local validation or calibrated probability"]}
    collection = {"type": "FeatureCollection", "bbox": bbox, "features": features + detections}
    (destination / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False), encoding="utf-8")
    write_map(destination / "risk_map.html", collection, summary)
    # A georeferenced risk raster for GIS users. Unknown cells stay nodata.
    import rasterio
    from rasterio.transform import from_bounds
    with rasterio.open(destination / "risk_score.tif", "w", driver="GTiff", width=cols, height=rows,
            count=1, dtype="float32", crs="EPSG:4326", transform=from_bounds(*bbox, cols, rows),
            nodata=-9999, compress="deflate") as raster:
        raster.write(np.where(np.isfinite(score), score, -9999).astype("float32"), 1)
        raster.update_tags(model_id=model.model_id, as_of=options["as_of"], score_units="relative_index_0_100")
    return summary
