# End-to-end testing

Latest verification: 12/12 CTest checks, 22/22 Python tests, and 26/26 live
integration checks passed. The final live run took 48.25 seconds and removed all
30 test versions, including hide markers. Its machine-readable report is
[`report.json`](../build/e2e/20261114T060249Z-af311d0b7817/report.json).

From the repository root, build the current sources and run both local suites:

```powershell
.\build.cmd
Push-Location python
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
```

Run the live integration test with the existing B2 configuration:

```powershell
.\.venv\Scripts\python.exe scripts\e2e.py --live --providers
```

The script requires NumPy, Rasterio with JPEG2000 support, the built executables,
and B2 list/read/write/delete/share capabilities. It uploads small test fixtures
under a random `tests/e2e/<run-id>/` prefix. It deletes only exact file versions
and hide markers within that prefix, then verifies cleanup. It does not change
bucket access or delete buckets. Local inputs, results and `report.json` remain
under `build/e2e/<run-id>/`. A failed cleanup is reported as a test failure; the
report retains the prefix for inspection. Sharing URLs and credentials are not
printed or saved.

Coverage includes:

- C++ uploads, listing, metadata, Unicode names, sharing and hide markers.
- Byte-identical downloads by name and immutable version ID, preservation of
  existing destinations, and removal of partial downloads after failures.
- Raw publication, exclusion of root credential files, restoration of the original
  snapshot after a newer same-name object is uploaded, and C++ metadata parsing.
- Cloud discovery by prefix, direct raw-manifest handoff, C++ launcher to Python
  workers, synthetic SAFE/JPEG2000 analysis with known NDVI/NDMI and cloud masks,
  FIRMS row validation/deduplication, and completed result manifests.
- Risk-map generation from explicitly dated synthetic imagery, publication and
  download of all risk artifacts, and SHA-256 verification of published outputs.
- With `--providers`, a real one-product Copernicus catalogue/preview scrape,
  archival in B2, checksum-verified restore, and C++ parsing of real metadata.

The live provider test uses a fixed historical region/date selection, downloads
at most one preview and never downloads a full Sentinel product. Omit
`--providers` to run only the synthetic-data/B2 integration tests.

## Findings from the initial run

The parsing test's authorization fixture contained an unbalanced C++ initializer;
it was rewritten with an intermediate storage object so the full suite builds.
Live Copernicus ingestion also returned HTTP 400 because the query sent
`$expand=Assets,Attributes`. Separate `$expand=Assets&$expand=Attributes`
parameters returned HTTP 200 with the same filters. The query was corrected and
the ingestion test now checks that format. Copernicus documents repeated expansion
parameters in its [release notes](https://documentation.dataspace.copernicus.eu/APIs/ReleaseNotes.html).

The Windows sandbox denied the C++ parsing test access during temporary-path
canonicalization. The same rebuilt CTest suite passed outside the sandbox; this
environment restriction is separate from the application fixes.

One expanded live attempt failed while uploading risk artifacts after four
artifacts had been recorded. Its local manifest was marked failed, and cleanup
completed. The worker's generic backend error did not identify the underlying
provider or transport cause. A subsequent full run completed that path; the
earlier failure should still be considered when assessing storage reliability.
Uploads are deliberately not retried automatically because a failed response
can be ambiguous about whether the provider accepted the object.

## Limits

Live NASA FIRMS retrieval and authenticated full Sentinel-2 downloads were not
tested because their provider credentials were absent from the process environment.
Scientific processing was tested using synthetic, georeferenced spectral bands;
the downloaded real preview is not a substitute for analytical imagery. No
large-file, concurrent-load, or multi-gigabyte performance claim follows from
these small integration tests.

Cloud discovery currently does not populate scene acquisition timestamps. The
risk integration test supplies a known acquisition time through the resolved
explicit job; undated cloud scenes remain insufficient evidence for a dated risk
estimate. The risk output is an experimental relative index. The future prediction
interface is covered by local tests with a test model; no trained forecasting
model was exercised.
