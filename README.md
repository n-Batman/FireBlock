# FireBlock

A C++17 Backblaze B2 controller and Windows command-line application for images,
videos, documents, JSON, archives, and arbitrary binary data. Uploads and downloads
stream from disk. The reusable library is in `include/fireblock/controller.hpp`.

## Put your API key here

In PowerShell, from this folder:

```powershell
Copy-Item .env.example .env
notepad .env
```

Fill in **both** `B2_APPLICATION_KEY_ID` (Backblaze's `keyID`) and
`B2_APPLICATION_KEY` (Backblaze's `applicationKey`). Set `B2_BUCKET_NAME` to your
bucket name. `.env` is ignored by Git. Keep it on the machine that runs the
controller; never ship it inside a public app, website, or game client.

Create a key at [Backblaze B2 -> Application Keys](https://secure.backblaze.com/app_keys.htm).
For an existing bucket, restrict the key to that bucket and enable `listFiles`,
`readFiles`, `writeFiles`, and `deleteFiles`. Add `shareFiles` for sharing links.
Listing buckets requires `listBuckets`; changing/creating buckets requires
`writeBuckets`, and deleting buckets requires `deleteBuckets`. These are separate
capabilities: use an appropriately authorized administration key for bucket setup,
then a restricted storage key for everyday use. A restricted key with a bucket name
in its authorization response can use file commands without listing all buckets.
Keys restricted to a file prefix must use that prefix in upload/list commands.

Environment variables override `.env`. The default `.env` is read from the current
working directory. Use `--env C:\path\to\.env` when running elsewhere. You can also
provide credentials through your service's environment or secret manager.

## Build

Requires Windows 10/11, CMake 3.24+, and Visual Studio C++ Build Tools with the
**Desktop development with C++** workload and a Windows SDK. The first configure
downloads nlohmann/json 3.12.0; HTTPS and hashing use native WinHTTP and BCrypt.

```powershell
.\build.cmd
.\build\native\fireblock.exe help
```

`build.cmd` selects the native ARM64 or x64 compiler, builds Release, and runs tests.
It uses NMake to avoid Visual Studio MSBuild file tracking permission issues. You
can also use `cmake -S . -B build/vs -A x64`, followed by
`cmake --build build/vs --config Release` on an x64 development machine.
An installed nlohmann_json 3.12+ CMake package is used before downloading; for an
offline build, set `CMAKE_PREFIX_PATH` to its installation or supply a local source
directory with `-DFETCHCONTENT_SOURCE_DIR_JSON=C:/path/to/json` when configuring.

If CMake reports that no C++ compiler is found, modify Visual Studio Build Tools in
Visual Studio Installer and install **Desktop development with C++**, including the
MSVC compiler and Windows SDK, then configure into a fresh build folder.

## Set up image and data storage

The controller creates private buckets with Backblaze server-side AES-256 encryption.
Use an account-unique bucket name (Backblaze bucket names are globally unique).
Creating buckets is optional if you already have one.

```powershell
$fb = '.\build\native\fireblock.exe'
& $fb create-bucket your-unique-fireblock-bucket
# Set B2_BUCKET_NAME=your-unique-fireblock-bucket in .env after creation.
& $fb account
& $fb buckets
& $fb upload 'C:\Pictures\photo.png' 'images/photo.png'
& $fb upload 'C:\Data\settings.json' 'data/settings.json'
& $fb upload 'C:\Data\backup.zip' 'data/backup.zip'
& $fb list
& $fb list 'images/'
& $fb download 'images/photo.png' '.\downloaded-photo.png'
& $fb share 'images/photo.png' --seconds 3600
```

`images/` and `data/` are object name prefixes; no folder creation is necessary.
The default `b2/x-auto` content type lets B2 detect types from the object extension
(including image types); unknown extensions become `application/octet-stream`.
Override it with `--type image/webp`, `--type application/json`, or another MIME type.
Use `--bucket another-bucket` on file commands to override the default bucket.
Downloads require an existing parent directory and refuse to overwrite local files.
Failed downloads remove their `.part` file. Uploads are SHA-1 checked by B2.

For image display in a website, use a temporary sharing URL for a private bucket,
or explicitly create a public bucket with `create-bucket NAME --public` and use
`url REMOTE`. Public visibility exposes every file in that bucket. Browser scripts
that fetch cross-origin content may also need bucket CORS configuration through
the Backblaze console; this controller does not configure CORS.

Sharing URLs are bearer credentials: anyone holding one can download until expiry.
B2 sharing tokens are **prefix scoped**: a URL generated for `images/photo.png`
also authorizes names beginning with `images/photo.png`. Prefer unique object names
and avoid using one object's name as another object's prefix. Expiry is 1–604800
seconds. This is the behavior of
[B2 download authorization](https://www.backblaze.com/apidocs/b2-get-download-authorization).

## Inspect, hide, and delete

```powershell
& $fb versions 'images/'
& $fb info 'FILE_ID_FROM_LIST'
& $fb hide 'images/photo.png'
& $fb delete 'images/photo.png' 'EXACT_FILE_ID' --yes
& $fb visibility public --yes
& $fb visibility private --yes
& $fb delete-bucket --yes
```

Each upload to the same name creates another version. `hide` adds a hide marker and
keeps data. `delete` permanently removes **one specified version**; an older version
may become visible. Use `versions` to see old versions and hide markers. Bucket
deletion succeeds only when the bucket is empty, including all versions and hide
markers. Object Lock/retention and key restrictions remain enforced by Backblaze.

## Embed in C++

Link the `fireblock` CMake target and include its public header:

```cpp
#include <fireblock/controller.hpp>
fireblock::loadEnv(".env");
fireblock::Controller storage(
    fireblock::environment("B2_APPLICATION_KEY_ID"),
    fireblock::environment("B2_APPLICATION_KEY"));
auto uploaded = storage.upload("your-bucket", "photo.png", "images/photo.png");
auto images = storage.files("your-bucket", "images/");
storage.download("your-bucket", "images/photo.png", "downloaded.png");
storage.deleteVersion("images/photo.png", uploaded.at("fileId"));
```

Use one controller per thread. Account tokens remain in memory and are refreshed
once when metadata API calls report expired authentication. Uploads are not
automatically retried because an ambiguous response can mean the upload succeeded.
Retry a failed upload explicitly after checking versions. Downloads can be retried
by rerunning the command. Requests have connect and I/O timeouts; TLS certificate
validation stays enabled and HTTP redirects are refused.

## Scope and validation

Single-file uploads up to 5 GB are supported. Multipart uploads, recursive sync,
lifecycle policies, CORS editing, and a graphical interface are not implemented.
File listing follows pagination and collects results in memory; transfers stream
in 64 KiB chunks. Downloads rely on HTTPS and WinHTTP transfer error detection;
the controller does not independently compare the downloaded SHA-1.

Tests use an injected transport to verify the current
[B2 v4 authorization response](https://www.backblaze.com/apidocs/b2-authorize-account),
pagination, upload headers and SHA-1, scoped sharing URLs, exact-version deletion,
token refresh, and preservation of existing files after download failures. Tests
do not require keys and do not modify a live Backblaze account.

## Satellite and fire data

For scraper → raw Backblaze archive → future parser input, use
`fireblock_pipeline`. It stores complete raw batches and restores checksum-verified
snapshots by immutable file version IDs, without requiring a parser. See
[the raw pipeline guide](docs/raw-pipeline.md).

The `fireblock_ingest` executable downloads Copernicus satellite previews, optional
full imagery products and product metadata, plus NASA FIRMS fire-detection CSVs.
See [the ingestion guide](docs/ingestion.md) for credentials, configuration and
usage, and [the example configuration](config/ingest.example.json) for area and
date filters. It saves files locally for use with the storage controller.

## Parsing and storage pipeline

`fireblock_parse` normalizes FIRMS detections and Copernicus product metadata into
GeoJSON features in NDJSON files, tracks each run in a manifest and optionally
uploads results and imagery assets through the existing Backblaze controller.
Use `--ingest CONFIG.json` to download data first. See [the parsing guide](docs/parsing.md)
and [configuration example](config/parsing.example.json) for setup and controls.

## Python imagery analysis

The Python worker adds 10 m NDVI, 20 m NDMI, cloud/valid-data coverage, and NASA
FIRMS detection summaries. Jobs read raw data from Backblaze through the C++
storage CLI and publish GeoTIFF/NDJSON/JSON artifacts with a completion manifest.
`fireblock_analyze` launches the Python worker from C++, and the ingestion bridge
can run the existing scraper and stage its outputs in B2. See
[the analysis guide](docs/analysis.md) and [example job](config/analysis.example.json).
