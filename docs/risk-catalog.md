# Publishing risk coverage

Completed analysis runs remain separate in Backblaze. The website composes a
display grid from all completed publications covering the current map bounds.
It no longer selects only `risk/latest.json` or a single SLO snapshot.

## Automatic publication

The Python pipeline uploads artifacts, verifies them and uploads its completed
manifest. It then writes a checksum-pinned pointer to
`risk/catalog/<run_id>.json`. Independent runs use different keys, so concurrent
publishers cannot overwrite one another's coverage. The legacy latest pointer
is still written for older consumers. Risk runs publish by default;
`storage.publish_frontend=false` explicitly keeps a run out of the live catalog.
Raw imagery alone is not shown: it must first complete analysis successfully.

`GET /api/risk-grid?bbox=west,south,east,north` lists the catalog and selects
intersecting publications before downloading their verified grids. Without
`bbox`, it composes all coverage within the response limits. The map requests
visible coverage after a pan/zoom (250 ms debounce) and every 60 seconds.
Requests are canceled when superseded. File imports pause automatic loading;
the backend-grid button resumes it. Refreshing never moves the map camera.

Newer scored cells take priority over older cells. Older scored data fills gaps
in newer unknown cells; unknown is never averaged as zero. Intersections are
subtracted into rectangular fragments, retaining the source score, model,
timestamp and run ID. Original cloud grids are unchanged. Parcel scoring uses
the same mosaic, with per-parcel model/time lists when observations are mixed.

## Existing runs and deployments

`python scripts/register_risk_runs.py` registers completed historical runs and
exports verified fallback grids plus `src/data/real-runs/catalog.json`. It does
not download satellite archives or duplicate existing identical snapshots.
Madonna Ranch, downtown SLO and Silver River were registered on 2026-11-14.

For automatic updates on the hosted website, configure these **server-side**
deployment variables and deploy this code:

- `B2_APPLICATION_KEY_ID`
- `B2_APPLICATION_KEY`
- `B2_BUCKET_NAME`

The read-only website key needs file read/list permissions for `risk/`.
Never use `NEXT_PUBLIC_` for credentials. A deployment without cloud credentials
uses the bundled multi-run snapshot; it needs a new export and deployment to
receive later data. Partial cloud configuration and invalid publications produce
an error rather than silently showing stale fallback data. Old manifest/pointer
environment pins remain supported by the legacy single-grid helper but do not
limit the website catalog.

## Resource limits

Catalog listings are paginated with a 500-publication limit. At most four cloud
loads run simultaneously. Verified immutable versions are cached in process
memory (32 MiB serialized-size budget, at most 500 entries); tokens and grids
are not written to a local data cache. Listings are fresh on every request.
Responses allow at most 10,000 non-overlapping cells; source candidates and
intersection work are also bounded. Large deployments should partition/archive
historical catalogs before reaching these limits. A bad selected publication
fails the request rather than producing an incomplete score silently.
