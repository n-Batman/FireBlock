# Displaying grid risk on property plots

The backend still calculates and stores its regular risk grid. A derived display
layer intersects those cells with county parcel polygons and colors each complete
property outline using the known-area-weighted mean. No backend cell is changed,
resampled or replaced by a parcel score. This is a spatial summary of the existing
model, not a new prediction model or an assessment of property safety.

## Use it

On the main map, open **Property boundaries**, then find parcels using a point,
map click or the visible area. Under **Property risk display**, choose the backend
export `risk_map.geojson` with **Backend grid file**. Alternatively configure a
completed cloud analysis in server-side `.env.local`:

```text
B2_RISK_MANIFEST_FILE_ID=immutable-analysis-manifest-file-id
```

Restart Next.js and click **Load configured backend grid**. `/api/risk-grid`
reads the completed manifest and exact grid version directly from Backblaze,
verifying checksums without writing a local cache.
Without configuration it reports an unavailable source rather than creating demo
scores. `RISK_GRID_FILE` is no longer used. Local file import remains an explicit
development option, with data held only in browser memory.

Known properties are filled yellow-to-red on the 0–100 scale. Gray properties
have insufficient known coverage. Hover to see mean score, coverage and maximum
intersecting cell score. **Show underlying grid** displays the original cells for
comparison. **Show parcel outlines over risk** toggles the property layer.
**Save GeoJSON** exports parcel geometry with its derived statistics when available.

Loading a backend grid hides the old sample vineyard risk-block polygons so they
cannot be confused with the loaded model. The original management/habitat overlay
and side rail remain separate sample data. This feature does not reclassify
parcels as vineyard blocks or change existing sidebar scores.

## Aggregation contract

For parcel P and each non-null cell i:

```text
weight_i = area(intersection(P, cell_i))
observed_mean = sum(weight_i * score_i) / sum(weight_i)
coverage = sum(weight_i) / area(P)
displayed risk_score = observed_mean only if coverage >= 0.60, otherwise null
```

Clipping uses Turf polygon intersection, with spherical area weights in square
metres. Holes and multipolygons are respected. Edge-only contact has zero weight.
Missing cells and areas outside the grid do not count as zero risk. The mean is
over known area only, so coverage must accompany it. The peak score is the maximum
cell value touching positive property area, not a parcel-wide peak measurement.

Export fields include `risk_score`, `observed_mean`, `peak_score`, `coverage`,
`cells`, `status`, `model_id`, `as_of`, parcel attribution and
`aggregation: intersection-area-weighted-v1`. Status is `estimated`,
`insufficient_coverage` or `unknown`. No model runs/issue times can be mixed.

Inputs must use the current backend's non-overlapping rectangular WGS84 polygons,
unique cell IDs, timezone-aware issue times and null-or-0–100 scores. Thermal-point
features in the export are ignored. Overlapping grid cells are rejected to prevent
double-counting. The display supports regional files up to 25 MiB / 10,000 cells
and 200 parcels per lookup. Larger backend jobs should export a regional subset.
Aggregation runs in the browser with bbox filtering; for large regional workloads
move this same contract to a spatial database/worker before increasing limits.

The API and UI use separate parcel/grid types; `src/data/types.ts` remains unchanged.
Tests cover clipped area weights, missing coverage, valid zero scores, shared
edges, holes, invalid grids, overlap rejection and immutable backend inputs.
