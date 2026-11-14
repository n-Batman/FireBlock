# Copernicus and NASA FIRMS ingestion

To send scraper output directly into raw Backblaze storage and later restore it
for a parser, use the [raw pipeline controller](raw-pipeline.md). The standalone
`fireblock_ingest` command below remains local-only.

`fireblock_ingest` uses the official APIs to collect satellite imagery, product metadata and fire detections. It is a separate executable alongside the existing Backblaze storage controller; outputs can subsequently be uploaded with that controller.

## Build (Windows, C++17)

Install Visual Studio C++ build tools and CMake 3.24+. The build downloads nlohmann/json 3.12.0; HTTPS uses Windows WinHTTP and the system certificate store.

```powershell
.\build.cmd
```

The build script selects the installed Visual Studio compiler for your machine
(including ARM64) and runs CMake and CTest in `build/native`. Alternatively, run
`cmake -S . -B build/native -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release`,
`cmake --build build/native` and `ctest --test-dir build/native --output-on-failure`
from the appropriate Visual Studio developer prompt. For offline builds, install
nlohmann/json 3.12.0 locally and set `nlohmann_json_DIR` to its CMake package, or
pass `-DFETCHCONTENT_SOURCE_DIR_JSON=<path-to-json-source>` when configuring.

## Configure and run

Copy `config/ingest.example.json` to your own configuration and edit the bounding box and dates. Coordinates are WGS84 longitude/latitude in `[west,south,east,north]` order. Dates are UTC: `start` is inclusive and `end` is exclusive. Split a region crossing the antimeridian into two runs. The output path is relative to the working directory.

```powershell
$env:FIRMS_MAP_KEY = 'your-nasa-firms-map-key'
# Only required when copernicus.products is true:
$env:CDSE_USERNAME = 'your-copernicus-login'
$env:CDSE_PASSWORD = 'your-copernicus-password'
# If your account requires it, set CDSE_TOTP to a current one-time code.

.\build\native\fireblock_ingest.exe config/ingest.example.json --validate
.\build\native\fireblock_ingest.exe config/ingest.example.json
```

The ingestion executable reads credentials from the process environment, not `.env`. Keep real credentials out of config files and source control. Copernicus authentication tokens remain in memory; HTTP errors omit response bodies and request URLs. A 401 triggers one reauthentication attempt. A fresh TOTP may be needed for later reauthentication.

## Output and behavior

* `data/copernicus/catalogue.json`: selected catalogue records, including footprints, attributes, checksums when available and acquisition metadata. The catalogue is paginated up to `max_products` (1–10000) in chronological order. Increase the limit or split date ranges to collect more. Each run rewrites the catalogue for its selection.
* `data/copernicus/<UUID>/metadata.json`: individual product records.
* `data/copernicus/<UUID>/quicklook.image`: preview images, when a quicklook is available. The file preserves the service's image encoding; inspect its signature or metadata to choose an extension. These are previews, not analytical raster bands.
* `data/copernicus/<UUID>/product.zip` (or `.nc` for Sentinel-5P): full original imagery and associated product data, enabled with `products: true`. Archives are streamed to disk and are not extracted or cropped. An intersecting product can extend beyond your bounding box. Offline products are reported and skipped; this tool does not order them.
* `data/firms/<SOURCE>_<START>_<END>.csv`: original fire-detection CSV, plus query metadata. Requests are divided into at most five days each. Empty detection results with a CSV header are valid. Error text returned with HTTP 200 is rejected.

Downloads write `.part` files and commit them only after success. Interrupted attempts restart from the beginning. Copernicus downloads with matching completion receipts and file sizes are reused; this is a size check, not checksum verification. Product catalogue sizes are not used to validate generated ZIP archives. FIRMS files refresh on every run because near-real-time detections can change. Do not run multiple processes against the same output directory simultaneously.

Transport errors, HTTP 408/429 and HTTP 5xx retry up to four attempts with exponential delays. Requests run sequentially. Provider failures leave successful downloads in place, attempt the other provider and return a nonzero exit status. There is no background scheduler; invoke the command from Windows Task Scheduler for recurring collection. Configure date windows explicitly for each invocation.

FIRMS provides detection tables through this API, not satellite image tiles. Historical source availability varies; consult the availability API and select a suitable NRT or standard-processing source. The code does not synthesize images from detections or interpret confidence/temperature fields.

## API references

* [Copernicus OData catalogue, quicklooks and authenticated product downloads](https://documentation.dataspace.copernicus.eu/APIs/OData.html)
* [NASA FIRMS area CSV API, sources and five-day request windows](https://firms.modaps.eosdis.nasa.gov/api/area/)
* [Request a FIRMS MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
* [FIRMS data availability](https://firms.modaps.eosdis.nasa.gov/api/data_availability/)
