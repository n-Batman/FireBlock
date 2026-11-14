# Fire-risk maps and the future prediction interface

The existing C++ scraper and B2 storage controllers feed the Python parser, which
produces calibrated Sentinel-2 NDVI/NDMI rasters and normalized FIRMS detections.
The map generator consumes those outputs before the analysis controller uploads
artifacts and publishes its completed manifest.

The first model is an **experimental relative susceptibility index**, scaled
0–100. It is not a calibrated probability, an official fire-danger rating or a
validated operational forecast. Weather, wind, terrain, dead fuels and exposure
are not modeled. [US Forest Service risk guidance](https://www.fs.usda.gov/rm/pubs/rmrs_gtr315.pdf)
describes the broader inputs and consequences involved in wildfire risk assessment.

## Run with scraped data in Backblaze

Build the C++ controllers with `build.cmd`. Install Python dependencies into the
project environment with `.venv\Scripts\python.exe -m pip install -e python`.
The scientific workers require NumPy and Rasterio/GDAL, including JPEG2000 support
for original Sentinel-2 products.

1. Configure the scraper's area and dates. For imagery-based scoring, request
   Sentinel-2 `S2MSI2A` full products (`products: true`), not just preview images.
2. Run `fireblock_pipeline scrape` as described in [the raw pipeline guide](raw-pipeline.md).
3. Copy `config/risk.cloud.example.json` to a job file. Set its raw manifest file
   ID, bounding box and explicit UTC `risk.as_of` time. Choose dates appropriate to
   that issue time; the example time is a fixed demonstration value.
4. Run the risk job:

```powershell
.\build\native\fireblock_analyze.exe --python .venv\Scripts\python.exe risk config/risk.cloud.example.json --validate
.\build\native\fireblock_analyze.exe --python .venv\Scripts\python.exe risk config/risk.cloud.example.json
```

The same command runs directly through Python:

```powershell
.\.venv\Scripts\python.exe python/worker_entry.py risk config/risk.cloud.example.json
```

Cloud discovery pins raw file versions, verifies the source inventory and reads
scene acquisition dates from the corresponding product metadata. The existing
`.env` B2 credentials are used through the C++ backend. To use local source bands
or archives instead, add the same `risk` object to an ordinary analysis job with
`scenes` and/or `firms` inputs. Supply each scene's timezone-aware `acquired_at`.
Set `storage.upload_results: false` for local-only results.

Results go to `analysis/<run-id>/risk/`:

| File | Purpose |
| --- | --- |
| `risk_map.html` | Standalone interactive map: pan/zoom, hover values and layer toggles |
| `risk_map.geojson` | Grid polygons and a separate recent-thermal-detection layer |
| `risk_score.tif` | WGS84 GeoTIFF, 0–100 with -9999 for unknown cells |
| `features.ndjson` | Versioned per-cell observations and provenance for later models |
| `summary.json` | Parameters, formula, coverage, excluded inputs and limitations |

The parent analysis manifest includes these artifacts, hashes and B2 file IDs.
Uploads happen only after parsing and map generation finish, with the completed
manifest published last. Download the HTML and GeoJSON together to use the map's
download link locally; the map itself embeds its data and requires no tile server.
It uses a geographic grid without a basemap. Cell sizes are approximate kilometres.

## Scoring and missing data

The analysis grid defaults to `risk.cell_km: 0.2` (**200 m × 200 m nominal
cells**), independently of the scraper's **1 km × 1 km collection boxes**.
The prior runtime fallback was 1 km and the cloud example explicitly used 2 km;
both now use 200 m. The example analysis bbox is smaller to remain below its
10,000-cell limit at the finer resolution. Broader jobs should be split into
regional analysis runs. Existing grids retain their original resolution until
analysis is run again. Because the WGS84 grid fits the requested bbox, actual
cell sides can be slightly smaller than the nominal metre target.

For every cell, select the newest scene no later than `as_of`, no older than
`scene_max_age_days`, with sufficient sampled valid coverage in both indices.
Cloud/nodata pixels remain invalid. Each scene's NDVI and NDMI are resampled to
the same WGS84 grid using area averaging and configurable subcell sampling. This
is sampled coverage rather than an exact pixel-overlap measurement.

The model uses these transparent, heuristic transforms:

```text
vegetation_proxy = clip((NDVI - 0.2) / 0.6, 0, 1)
dryness_proxy    = clip((0.4 - NDMI) / 0.8, 0, 1)
hotspot_pressure = max(exp(-distance / radius) * 2^(-age / half_life))
score = 100 * vegetation_proxy * weighted_mean(dryness_proxy, hotspot_pressure)
```

Default weights are 0.7 dryness and 0.3 hotspot pressure. Coefficients are design
choices requiring local validation, not fitted scientific parameters. Hotspots
are limited by radius and age. Low VIIRS confidence and numeric confidence below
30 are excluded; confidence codes are not treated as probabilities. Duplicate
location/time/satellite/instrument detections are not added together. The maximum
signal is used, so overlapping products don't inflate a count-based score.

Cells without sufficient fresh imagery have `risk_score: null`, hatched map
styling and nodata in the raster. FIRMS-only jobs therefore show detections with
unknown susceptibility, rather than manufacturing a low-risk background. Zero
hotspot pressure means no accepted recent detection in the supplied inputs.
[NASA notes](https://firms.modaps.eosdis.nasa.gov/alerts/notes.php) that overpass
timing, clouds and canopy can prevent detection. Source bounding-box filtering
can omit hotspots just outside the requested area; collect a buffered region
when edge influences matter. Thermal anomalies are not fire perimeters.

The configuration exposes cell size, maximum cell count, subcell samples,
coverage threshold, freshness windows, hotspot radius/half-life and weights.
Defaults limit the grid to 10,000 cells; the supported maximum is 50,000. Raster
aggregation is windowed and recent detections are capped at 100,000 per map.
Do not compare scores across materially different parameter sets as if calibrated.

## Offline demonstration

```powershell
.\.venv\Scripts\python.exe scripts/demo_risk.py
```

Open `analysis/risk-demo/risk/risk_map.html`. This generates synthetic index
rasters and a synthetic detection, clearly labeled in the map header. It makes no
API requests. Use `--output NEW_DIRECTORY` for another run; existing directories
are never overwritten.

## Later fire prediction maps

`prediction.py` defines a `PredictionModel` protocol and `build_prediction` adapter.
There is deliberately no default prediction estimator. A future trained model
declares its ID, compatible feature schema, training cutoff, forecast horizon and
target event definition, then supplies probabilities for cells with known inputs:

```python
from fireblock_analysis.prediction import build_prediction
build_prediction("analysis/<run-id>/risk/features.ndjson", trained_model,
                 "analysis/<run-id>/prediction.geojson")
```

The adapter checks compatible schemas, unique cell IDs, a common issue time,
observation/training cutoffs, prediction length and finite probabilities in
`[0,1]`. Unknown input cells stay null. The output records issue time, valid-until
time, model ID, horizon and target definition. It exports GeoJSON for a later
prediction-map renderer. It does not reuse the relative-risk score as a probability.

Before making useful forecasts, add historical labels and weather/forecast
features, define the target (for example ignition within a cell and horizon),
train with spatial and temporal holdouts, evaluate calibration and errors, and
version the feature schema when inputs change. The adapter's cutoff checks are
not a substitute for an audited training and validation process.

`build_risk(manifest, parsed_run_root, options, bbox)` is also available directly
for already parsed local runs. The prediction model can be replaced without
rewriting scraping, B2 storage, parsing or feature generation.
