# Python satellite analysis and C++ connector

This is a small, replaceable first version. Python performs scientific parsing;
the existing C++ executables retain collection, Backblaze authentication, and file
transfers. A JSON job describes inputs and a versioned JSON manifest describes
outputs. The original C++ metadata parser remains available.

For automatic discovery and the direct raw-controller handoff, use
[the connected parser controller](parser-controller.md). It accepts a B2 prefix
or a completed raw manifest file ID, downloads immutable versions through C++,
and feeds the same scientific workers described here.

## Setup and run

Use Python 3.11+ with NumPy and a Rasterio/GDAL installation that supports your
Python version and platform, including JPEG2000 for original Sentinel-2 JP2 bands.
From the repository directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .\python
.\build.cmd
Copy-Item config\analysis.example.json config\analysis.local.json
# Edit the B2 object keys in analysis.local.json to match files in your bucket.
.\.venv\Scripts\python.exe python\worker_entry.py run config\analysis.local.json --validate
.\.venv\Scripts\python.exe python\worker_entry.py run config\analysis.local.json
```

Put `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, and `B2_BUCKET_NAME` in the
existing Git-ignored `.env`. The Python worker does not read or copy their values;
it calls the C++ CLI with the credential file path. Set `storage.bucket` to
override the default. Keys need list/read access to inputs and write access to
results. There are no new API credentials for parsing stored files.

`storage.executable` points to `fireblock.exe`; `storage.ingest_executable` points
to `fireblock_ingest.exe`. All configuration paths are relative to the process's
working directory, not the config file. Keep jobs and backend executable paths in
trusted application configuration. `--validate` checks structure without network,
keys, or Rasterio; it does not open imagery or check object availability.

The C++ launcher can start the same worker:

```powershell
.\build\native\fireblock_analyze.exe --python .venv\Scripts\python.exe run config\analysis.local.json
```

Link `fireblock_analysis_worker` and include `fireblock/analysis_worker.hpp` to
call `runAnalysisWorker(pythonPath, entryPoint, {L"run", L"job.json"})` directly
from your backend. The synchronous launcher passes arguments without a shell,
supports Unicode paths, creates no extra console, inherits the service environment,
and returns the worker exit status. It does not hold the backend's B2 token.
Use `--worker PATH/worker_entry.py` when relocating the installed application;
the CMake default points at this checkout's entry point. Run the Python CLI directly
for printed diagnostics; the launcher reports failures by exit code.

## Input formats

Each scene in [the SAFE example](../config/analysis.example.json) references a B2
object containing the C++ scraper's full **Sentinel-2 Level-2A** `product.zip`.
The worker downloads it locally, opens it in-place with GDAL `/vsizip/`, selects
B04/B08 at 10 m and B11/SCL at 20 m, and reads `MTD_MSIL2A.xml` for reflectance
calibration. Archives must contain exactly one granule; ambiguous multi-granule
archives are rejected. Preview images and catalogue JSON cannot produce NDVI.

[The band example](../config/analysis.bands.example.json) instead references four
individual georeferenced GeoTIFF/JP2 objects. B04/B08 must be 10 m and B11/SCL 20 m,
in north-up projected grids whose units are metres. CRS and alignment may differ;
Rasterio aligns them to the output reference grid. Set nodata in the input rasters.
Every spectral band requires an explicit calibration:

```json
"calibration": {
  "B04": {"scale": 0.0001, "offset": -0.1},
  "B08": {"scale": 0.0001, "offset": -0.1},
  "B11": {"scale": 0.0001, "offset": -0.1}
}
```

Those numbers are an example **only**. For raw DN, use the actual product's
`scale=1/BOA_QUANTIFICATION_VALUE` and
`offset=BOA_ADD_OFFSET/BOA_QUANTIFICATION_VALUE`. Already calibrated reflectance
uses scale 1 and offset 0, as in the band example. SAFE metadata supplies these
automatically; modern/unknown baselines with missing offsets are rejected.
Zero raw DN, declared nodata, negative calibrated reflectance, nonfinite values,
and near-zero index denominators are excluded. Raster masks are also respected by
GDAL. Do not apply the offset twice to a harmonized or reflectance product.

An input can use `{"local": "path/to/file"}` instead of `{"key": "B2/object"}`
for development. Set `storage.upload_results=false` for a fully local run. The
production examples download directly from B2 through the C++ controller.

## Indicators and imagery coverage

* **NDVI = (B08 - B04) / (B08 + B04)** on the B04 **10 m** grid.
* **NDMI = (B08 - B11) / (B08 + B11)** on the B11 **20 m** grid. NIR is averaged
  onto that grid; upsampling SWIR never implies 10 m NDMI detail.
* Each index reports count, mean, min, max, and population standard deviation.
* Coverage includes classified, cloud (SCL 8/9/10), cloud shadow (3), snow (11),
  vegetation (4), usable-class, and valid-index fractions. The cloud fraction
  among classified pixels is also reported separately.

SCL is aligned by nearest neighbor. Default usable classes are vegetation (4) and
bare soil (5); water (6) is excluded by default. `valid_scl_classes` can select
2/4/5/6/7 if the application needs other classes. Cloud, shadow, snow, saturated,
and missing pixels are excluded. SCL masking remains effectively **20 m**, even
on a 10 m NDVI raster. There is no cloud-edge dilation in this prototype.

Fractions use all pixels in each output grid, including out-of-scene/nodata
pixels. Index validity additionally requires both bands and a usable SCL class.
With no bbox, the reference scene extent is assessed. Optional `bbox` is
`[west,south,east,north]` in WGS84; processing uses its transformed, outward-rounded
rectangle, not an exact polygon. The requested rectangle is retained even outside
scene coverage. A wholly missing/cloudy result has null statistics and is unusable.
An index is usable when its valid fraction is at least `min_valid_fraction`
(default 0.6) and it has at least one valid pixel; a scene requires both indices.
This threshold is an application setting, not a scientific guarantee.

GeoTIFF outputs retain CRS/geotransform, use float32 with nodata -9999, and have
256-pixel tiles and DEFLATE compression. Processing uses bounded windows instead
of loading a full Sentinel tile into memory. Summary statistics span the selected
usable land classes; they are not vegetation-only averages unless you set `[4]`.

## NASA FIRMS

Input is the original FIRMS CSV in B2. Outputs are GeoJSON Features, one per line,
with WGS84 coordinates, normalized UTC acquisition time, FRP in MW, brightness
fields in Kelvin, confidence, and preserved raw attributes. VIIRS confidence
categories and numeric 0–100 confidence retain separate representations.
Invalid data rows are counted and skipped; missing/duplicate headers or malformed
CSV fail the file. Empty valid CSVs are supported. Exact duplicate records are
removed within each file; overlapping source files/sensors are not merged.

Optional bbox filters apply to FIRMS points too. The summary records accepted,
rejected, duplicate and out-of-area counts, confidence counts, acquisition range,
and FRP sum **over detections**. Detections are thermal anomalies, not distinct
fires, burned area, fire perimeters, or proof of ignition. FRP sums from overlapping
satellite passes are not instantaneous regional fire power. No cross-provider
spatial/temporal joins or fire-risk model are implemented.

## Connect collection to storage and analysis

Set the existing `FIRMS_MAP_KEY` and, for product downloads, `CDSE_USERNAME` and
`CDSE_PASSWORD` in the environment as described in [ingestion.md](ingestion.md).
Use a dedicated **empty** output directory in the ingestion config; select
`SENTINEL-2`, `S2MSI2A`, and `products: true` for analytical imagery.

```powershell
.\.venv\Scripts\python.exe python\worker_entry.py ingest config\ingest.local.json --storage-config config\analysis.local.json --job-out config\analysis.generated.json
.\.venv\Scripts\python.exe python\worker_entry.py run config\analysis.generated.json
```

The first command invokes the existing C++ scraper, uploads its raw files under
`raw/<unique-batch>/`, and creates a job with B2 object references for Sentinel-2
L2A product ZIPs and FIRMS CSVs. Metadata and previews are retained in B2 even
though the raster worker does not analyze them. The second command consumes B2
inputs, rather than using the scraper's local copies. Multi-granule products need
individual band jobs. The storage layer's current single-file limit is 5 GB;
larger objects need multipart support outside this prototype.

Each analysis run writes a unique local directory and uploads:

```text
analysis/<run-id>/<scene-id>/ndvi.tif
analysis/<run-id>/<scene-id>/ndmi.tif
analysis/<run-id>/<scene-id>/summary.json
analysis/<run-id>/<firms-id>/detections.ndjson
analysis/<run-id>/<firms-id>/summary.json
analysis/<run-id>/manifest.json
```

The manifest includes schema/parser version, input SHA-256 values, per-source
summaries, output SHA-256 values and uploaded file IDs. It is uploaded **last**,
after all parsing and artifact uploads succeed. Consume a run only after its
completed manifest appears. Failures leave a failed local manifest and may leave
uploaded artifacts; there is no automatic remote rollback or run-level resume.
HTTP 5xx storage requests have bounded [retries](storage-retries.md), with upload
receipt checks before replay. Local downloaded inputs are retained for inspection/reprocessing.
Workers should run against independent output directories and stable input objects.

## Verification

```powershell
Push-Location python
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
```

Tests cover formulas, zero/nodata handling, SAFE offsets, ambiguous ZIP rejection,
FIRMS schemas/timestamps/confidence, bbox filtering, duplicate rows, subprocess
arguments, collection staging, and a mocked B2 download/analyze/upload round trip
with manifest ordering and failure handling. A Rasterio integration test uses
synthetic 10 m/20 m GeoTIFFs to check calibration, cloud masks, resolutions, valid
coverage, and an entirely cloudy scene; it skips explicitly if Rasterio is absent.

With the connected parser controller, all 16 Python tests now pass, including the
synthetic Rasterio integration test, and all 12 C++ CTest checks pass. The complete
C++ build succeeds. Live B2 listing through the C++ controller was verified;
the bucket currently contains only the storage smoke-test PNG. Processing a real
Sentinel dataset from B2 still requires uploading an analytical dataset.

## Primary references

* [Copernicus Sentinel-2 L2A bands and scene classes](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html)
* [Sentinel-2 products and reflectance offsets](https://sentiwiki.copernicus.eu/web/s2-products)
* [NASA FIRMS CSV API examples and fields](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html)
* [Rasterio reprojection and resampling](https://rasterio.readthedocs.io/en/stable/topics/reproject.html)
