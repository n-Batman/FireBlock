# Website risk results

The November 14 real Silver River result is published as static website assets:

- `/results/silver-river/index.html`: standalone interactive result map.
- `/results/silver-river/risk_map.geojson`: 1,476-cell geographic score grid.
- `/results/silver-river/risk_preview.png`: map image.
- `/results/silver-river/summary.json`: run summary.

These are public derived results already committed in
`src/data/real-runs/silver-river-20261114`. They contain no credentials or raw
satellite archive. Source snapshot checksums are preserved in its provenance file.

The HTML loads the matching GeoJSON as a separate request using a content-hash
query string, so browser caching can reuse the grid independently of the page.
Each page is about 8 KB rather than 1.2 MB. Direct-from-disk viewing has a file
picker for browsers that block `file://` fetches. This changes the presentation
packaging, not the model's data or scores; the original cloud HTML remains immutable.

`/api/risk-grid` serves and verifies this dated snapshot when all B2 server
settings are absent. It labels the response `publication.source=published-snapshot`
and includes the source run ID and issue date. A fully configured deployment
continues using the verified cloud publication pointer. Partial or failed cloud
configuration reports an error rather than silently substituting old data.

The map enables the grid overlay and fits its extent when a result is loaded.
The standalone page remains available independently of map UI and cloud access.
The model is a relative spectral/hotspot index, not a calibrated fire probability.

At preparation time `https://fireblock.vercel.app/api/risk-grid` returned 404.
The changes must be deployed from this repository's root Next.js app before the
live URL can serve them. The live Vercel project and deployment source still
need to be confirmed through the owner's connected Vercel account.
