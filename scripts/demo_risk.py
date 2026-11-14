"""Generate a synthetic demonstration; no API requests or real fire claims."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from fireblock_analysis.risk import build_risk


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="analysis/risk-demo")
    args = parser.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=False)
    bbox = [-122.75, 38.35, -122.55, 38.55]
    scene = root / "synthetic_scene"
    scene.mkdir()
    y, x = np.mgrid[0:128, 0:128] / 127
    for name, values in (("ndvi", .3 + .5 * x), ("ndmi", .4 - .8 * y)):
        values[(x < .27) & (y < .3)] = -9999
        with rasterio.open(scene / f"{name}.tif", "w", driver="GTiff", width=128, height=128,
                count=1, dtype="float32", nodata=-9999, crs="EPSG:4326",
                transform=from_bounds(*bbox, 128, 128)) as out:
            out.write(values.astype("float32"), 1)
    fires = root / "synthetic_fires"
    fires.mkdir()
    detection = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.59, 38.40]},
        "properties": {"acquired_at": "2026-11-13T10:00:00Z", "frp_mw": 20,
            "confidence": {"kind": "viirs_category", "value": "high"}, "attributes": {"instrument": "SYNTHETIC"}}}
    (fires / "detections.ndjson").write_text(json.dumps(detection) + "\n", encoding="utf-8")
    manifest = {"scenes": [{"id": scene.name, "acquired_at": "2026-11-12T12:00:00Z",
        "indices": {name: {"raster": f"{name}.tif"} for name in ("ndvi", "ndmi")}}], "firms": [{"id": fires.name}]}
    options = {"enabled": True, "as_of": "2026-11-13T12:00:00Z", "cell_km": 1.3,
        "data_label": "SYNTHETIC DEMO — no live satellite observations"}
    summary = build_risk(manifest, root, options, bbox)
    print(root / "risk/risk_map.html")
    print(f"{summary['known_cells']} / {summary['total_cells']} cells with synthetic imagery")


if __name__ == "__main__":
    main()
