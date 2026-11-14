# Parsing controller and Backblaze pipeline

`fireblock_parse` controls parsing of the ingestion system's existing on-disk
layout. It produces newline-delimited JSON (NDJSON), one GeoJSON Feature per line,
and optionally uploads the results using the existing `fireblock::Controller`.

## Build and run

From the FireBlock repository:

```powershell
.\build.cmd
.\build\native\fireblock_parse.exe config/parsing.example.json --validate
.\build\native\fireblock_parse.exe config/parsing.example.json
```

The example processes existing `data/` files and writes to `parsed/`. Each run
gets its own directory and manifest. Paths are relative to the current working
directory, including when configuration files live elsewhere. Input and output
must be in separate directory trees. Validation checks configuration without
parsing files, writing outputs or accessing the network.

To download fresh data before parsing it:

```powershell
.\build\native\fireblock_parse.exe config/parsing.example.json --ingest config/ingest.example.json
```

The ingestion configuration's `output` must match the parsing `input_root`.
Ingestion failures stop the pipeline. FIRMS/Copernicus credentials use the
environment variables described in [the ingestion guide](ingestion.md).

## Control parsing

Edit [the example configuration](../config/parsing.example.json):

| Setting | Behavior |
| --- | --- |
| `input_root` | Root containing `firms/` and `copernicus/` ingestion folders |
| `output_root` | Parent directory for new run directories |
| `firms.enabled` | Parse all `firms/**/*.csv` files |
| `firms.columns` | Map logical `latitude`, `longitude`, `date`, `time` to input column names |
| `firms.invalid_rows` | `fail` aborts that file; `skip` drops invalid data rows and records counts |
| `copernicus.enabled` | Parse `copernicus/**/metadata.json` files |
| `storage.enabled` | Upload completed artifacts and manifest to B2 |
| `storage.bucket` | Existing bucket name; empty uses `B2_BUCKET_NAME` from environment or `.env` |
| `storage.prefix` | Object prefix before a unique run ID, such as `parsed` |
| `storage.upload_assets` | Also upload recognized Copernicus preview and imagery binaries |

FIRMS CSV parsing supports quoted fields, commas inside fields, doubled quotes,
multiline fields, LF/CRLF line endings and a UTF-8 BOM. A record is limited to
1 MiB. Required column names must occur once; other columns are preserved as
strings inside `properties.attributes`. Numeric confidence codes and VIIRS
confidence labels retain their original meanings and representations.

Coordinates become GeoJSON `[longitude, latitude]`; non-finite values and values
outside WGS84 bounds are rejected. Acquisition dates and HHMM times become UTC
`properties.acquired_at`. Leading zeros in times may be omitted by the input.
Calendar dates, hours and minutes are checked. Missing columns, duplicate
headers, malformed quoting and oversized records always fail the entire file,
even in `skip` mode, because safely locating the next record may be impossible.
An empty detection table with a valid header produces an empty NDJSON file.
Skip mode records total rejected rows and at most 100 diagnostic record numbers.

Example output line:

```json
{"type":"Feature","geometry":{"type":"Point","coordinates":[-122.0,38.0]},"properties":{"provider":"NASA FIRMS","acquired_at":"2024-02-29T00:05:00Z","source_file":"firms/fires.csv","source_record":2,"attributes":{"latitude":"38","longitude":"-122","acq_date":"2024-02-29","acq_time":"5"}}}
```

Copernicus records preserve the original metadata under `properties.metadata`
and expose `properties.product_id`. A supplied Polygon/MultiPolygon GeoFootprint
becomes the feature geometry; missing footprints become `null`. This is metadata
normalization, not full GeoJSON topology validation or raster processing.
Metadata files are limited to 32 MiB. The aggregate `catalogue.json` is ignored to
avoid parsing each product twice. The controller does not extract ZIPs, decode
satellite bands, resample pixels or parse NetCDF scientific arrays. Imagery remains
binary and is referenced in the manifest as an asset.

## Connect Backblaze

Use the existing B2 credentials in `.env` or the process environment:

```text
B2_APPLICATION_KEY_ID=your-key-id
B2_APPLICATION_KEY=your-application-key
B2_BUCKET_NAME=your-existing-bucket
```

Set `storage.enabled` to `true`; supply `storage.bucket` or leave it empty to use
`B2_BUCKET_NAME`. Then run:

```powershell
.\build\native\fireblock_parse.exe config/parsing.example.json --env .env
```

No buckets are created or made public. Uploads reuse the storage controller's
authentication, streaming transfer and SHA-1 handling. They require appropriate
permissions for the existing bucket; see [storage setup](../README.md).
Single files above the storage layer's 5 GB limit require external multipart
support and fail normally. The parsing controller uploads local results to B2;
to parse data already archived in B2, use
[`fireblock_pipeline pull`](raw-pipeline.md) to restore a verified raw snapshot
and set `input_root` to the restored directory. This handoff also supports a
future parser implementation without coupling it to the storage API.

Output objects use these keys:

```text
<prefix>/<run-id>/firms/<source>.ndjson
<prefix>/<run-id>/copernicus/<product-id>/metadata.ndjson
<prefix>/<run-id>/assets/copernicus/<product-id>/<binary-file>  (optional)
<prefix>/<run-id>/manifest.json
```

The manifest includes schema version, run ID, input and output SHA-1 values,
accepted/rejected record counts, diagnostics, asset references and uploaded B2
file IDs. It is uploaded last, after artifact/asset uploads succeed. Published
manifests have status `complete`. No B2 authorization tokens are copied into it.

All parsing must succeed before any upload starts. File failures are recorded in
the local manifest; successful local outputs are retained and the command exits
nonzero. Completed parsed files use an atomic `.part` commit. Input checksums
before/after parsing detect changes during parsing; run ingestion and parsing
sequentially against a given input tree. Symlink inputs are ignored and resolved
file paths must remain inside the input root.

An upload failure preserves prior uploaded objects and a failed local manifest.
HTTP 5xx uploads receive up to four attempts with receipt verification; see
[storage retries](storage-retries.md). Ambiguous transport failures still stop;
check B2 before restarting those. A new invocation creates
a new run ID and reprocesses the input tree; automatic resume, deduplication and
cleanup of partial remote batches are not implemented. Do not consume objects
from a run without its completed manifest. No database or background service is
required.

## C++ use and tests

Include `fireblock/parsing.hpp` and link `fireblock_parsing`. Configure a
`fireblock::Controller` with your credential provider and pass it to
`ParsingController::run(config, &storage)`. For local-only parsing, disable storage
and call `run(config)`. `parseFirms`, `parseCopernicus` and `readCsvRecord` can also
be used independently. The configuration maps date/time columns; new provider
formats can be added behind this controller without changing the B2 layer.

CTest includes `csv`, `parsing`, `parsing_help` and `parsing_config`. The parsing tests
cover CSV edge cases, bad schemas, timestamp normalization, configurable columns,
empty detection tables, atomic failure behavior, metadata preservation and a
mocked end-to-end B2 upload path (including manifest ordering and upload failure).
They do not require credentials or write to a real bucket.

The CSV tokenizer has no JSON dependency. In a Visual Studio developer prompt it
can also be verified independently while the main build's dependency is unavailable:

```powershell
cl /nologo /EHsc /std:c++17 /W4 /I include src\csv.cpp tests\csv_tests.cpp /Fo:build\ /Fe:build\fireblock_csv_tests.exe
.\build\fireblock_csv_tests.exe
```
