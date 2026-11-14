# Parser controller connected to Backblaze

`python/fireblock_analysis/controller.py` supplies `ParserController`. It connects
the existing Python scientific workers to the existing C++ storage controller:

```text
C++ scraper -> RawDataController -> Backblaze raw dataset
                                      |
                        ParserController discovers inputs
                                      |
                        C++ Controller downloads exact versions
                                      |
                        Python Sentinel-2 / FIRMS workers
                                      |
                        C++ Controller uploads results
                                      |
                        Backblaze analysis completion manifest
```

The existing `fireblock_analyze` C++ launcher now accepts `cloud` jobs. The storage
adapter invokes `fireblock list`, `download-version`, and `upload`; credentials
remain in the existing `.env`/environment. No second Backblaze SDK or API key is
needed. `download-version` exposes the C++ controller's existing checksum-verified
version download method.

## Run automatically against stored raw data

After building C++ and installing the Python dependencies as described in
[analysis.md](analysis.md), run from the repository root:

```powershell
.\build\native\fireblock_analyze.exe --python .venv\Scripts\python.exe cloud config\parser.cloud.example.json
```

The [example configuration](../config/parser.cloud.example.json) scans `raw/` in
the bucket configured by `.env` (or `storage.bucket`). It chooses completed raw
dataset manifests when present, resolves their inventory, downloads the exact
file versions, verifies inventory size/SHA-1, runs the scientific workers, and
publishes outputs under `analysis/<run-id>/`. The output manifest is uploaded last.

Inspect discovery without running analysis or uploading results:

```powershell
.\.venv\Scripts\python.exe python\worker_entry.py cloud config\parser.cloud.example.json --discover-only --job-out build\discovered-job.json
```

This lists B2 objects and may download raw manifests, but not the data files.
`--validate` checks configuration locally without accessing B2. The resolved job
can also be executed later with the existing `run` command. File IDs pin the
selected input versions even when newer versions with the same name appear.

## Connect directly to a raw-controller publication

`fireblock_pipeline scrape` and `publish` return `manifest_file_id`. Replace the
source in the cloud job with that ID to consume exactly that completed batch:

```json
"source": {"manifest_file_id": "FILE_ID_RETURNED_BY_RAW_CONTROLLER"}
```

This is the direct handoff between the raw-data and parser controllers. The raw
manifest contract is documented in [raw-pipeline.md](raw-pipeline.md). Failed or
incomplete manifests, duplicate inventory entries, and checksum mismatches fail
before analysis outputs are published.

If a prefix contains completed manifest objects, loose objects are ignored so a
partially uploaded new batch is not mixed into completed data. If there are no
manifests, discovery supports loose `copernicus/<product>/product.zip`, standard
`S2*_MSIL2A_*.zip` archives, and CSVs under a `firms/` path component. Loose-object
mode pins the versions returned by listing but does not provide dataset-level
atomic publication. Use manifest IDs for production batch handoffs.

`max_inputs` limits the number of selected archives/CSVs (default 1000); exceeding
it fails instead of silently processing part of the selection. Use a narrower
prefix or explicit manifest to select a smaller dataset.

## Python backend use

```python
from fireblock_analysis.controller import ParserController

controller = ParserController.from_config(config)
resolved_job = controller.discover(config)  # optional inspection
manifest_path = controller.run(config)     # discover -> download -> parse -> upload
```

A service can also inject `ParserController(existing_backend)` to reuse its
storage adapter. Scientific formulas, masks, calibration, outputs and credentials
are unchanged from [analysis.md](analysis.md). Explicit band jobs remain supported
by the original `run` command; cloud discovery does not guess calibration for
loose band files.

The random PNG uploaded by the storage smoke test is intentionally ignored.
NDVI/NDMI require Sentinel-2 spectral bands, so ordinary PNG/JPEGs and quicklook
images are not analytical inputs. An empty or unsupported selection reports an
error instead of producing fabricated indices.

## Tests

The Python suite includes discovery, manifest-to-worker integration, checksum
failure, incomplete-batch rejection, version pinning, PNG/preview exclusion,
input limits, result-manifest ordering, and the C++ adapter argument contract:

Validation completed with all 16 Python tests and all 12 C++ tests passing. The
live bucket listing was also checked through the C++ storage executable; at that
time it contained only the smoke-test PNG, which is not a spectral dataset.

```powershell
Push-Location python
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
```
