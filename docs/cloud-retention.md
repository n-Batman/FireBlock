# Cloud storage and local retention

Backblaze is the durable store; local run directories are working space.

| Path | Cloud behavior | Local retention |
| --- | --- | --- |
| Native `fireblock_pipeline scrape` | Raw inputs and completed manifest | Fresh scrape inventory removed only after all uploads are size/SHA-1 verified; small receipt retained |
| Native `publish` | Existing input directory uploaded | Original user directory never deleted |
| Python analysis/risk job | Outputs, locally supplied raw inputs, completed manifest | Verified successful jobs default to manifest-only; working downloads and generated artifacts removed |
| Native C++ parser with storage enabled | Parsed outputs and completed manifest | Verified generated outputs removed; original source files retained |
| Frontend `/api/risk-grid` | Reads an immutable cloud analysis and grid | Request-scoped memory only; no disk cache |
| Parcel display cloud save | Boundaries, projection, completed provenance manifest | Request-scoped memory only; no disk cache |

Python jobs can explicitly retain working results with
`storage.local_retention: "keep"`. Native parser jobs use
`storage.keep_local_files: true`. Local-only jobs keep their outputs. Unverified
uploads, upload failures and interrupted jobs keep recoverable data. Locked files
may remain even after verified uploads. Small local manifests/logs are retained;
there is no automatic age-based deletion of failed jobs or user-owned source files.
Existing old datasets are not blindly purged or retroactively marked uploaded.

The desktop scraper now defaults to B2 archiving on fresh settings. A previously
saved local-only preference remains explicit; check the archive box to use cloud
storage. Runtime dependencies, code, credentials, configuration templates and the
small synthetic demo remain local. The application never uploads `.env` files.

## Server setup

Reuse `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` in the server
environment/secret manager. After a completed risk job, set:

```text
B2_RISK_MANIFEST_FILE_ID=<immutable completed analysis manifest ID>
```

Obtain that ID from the run's `cloud-receipt.json`. Configure the frontend server
to use the ID; there is intentionally no ambiguous mutable "latest" selection.
Without a pinned ID, the server now resolves `B2_RISK_POINTER_KEY` (default
`risk/latest.json`) from the [mathematical pipeline](mathematical-risk.md).
The designated cloud grid is returned through `/api/risk-grid` only after manifest,
byte-count and checksum validation. This publishes that chosen dataset through the
application's existing map endpoint, so select a dataset appropriate to its users.

For parcel storage, confirm the provider license permits caching, then set:

```text
PARCEL_CLOUD_CACHE_ALLOWED=true
```

The local map's **Save property display to cloud** button re-fetches the parcel
query and the configured cloud grid on the server. It stores both the boundaries
and derived risk, then publishes a `fireblock.parcel-display` manifest referencing
the raw boundary source, grid file ID and analysis manifest ID. A browser-imported
local grid is not silently substituted for that cloud version.

Cloud writes require same-origin requests. The desktop-local server can perform
them directly. A non-local deployment additionally requires a bearer token matching
server-side `CLOUD_WRITE_TOKEN`; do not embed that token in browser bundles. Integrate
your user-session authorization before enabling remote browser writes. Parcel
caching is refused until licensed caching is explicitly enabled.

Cloud JSON requests are capped at 25 MiB. Uploads validate B2 byte count and SHA-1;
downloads verify B2 metadata and grid SHA-256 against the completed run manifest.
No automatic upload retry can duplicate an ambiguous write. Failed multi-object
uploads can leave incomplete cloud objects, but no intentional completed manifest.

`scripts/check_cloud_storage.py` checks credentials and counts raw/analysis/risk/
parcel objects without printing credentials or object names. The implementation
audit authenticated successfully. At audit time these production prefixes were
empty, and local demo data was about 0.7 MiB; there was no bulk production archive
to migrate. Provider-license approval and a real completed risk-run ID cannot be
inferred from an empty bucket, so neither is fabricated automatically.
