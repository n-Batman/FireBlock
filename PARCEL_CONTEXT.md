# FireBlock parcel system: agent context

Read `AGENTS.md`, `TASKS.md`, and `PROJECT_CONTEXT.md` before changing code.
This document describes the implementation as of November 14, 2026, including
individual-only rendering and the 500-parcel limit. Engine files under
`src/lib/` and API routes belong to Partner/Codex; components, pages, and copy
belong to Milo. Coordinate shared changes to `src/data/types.ts`.

## Main map data flow

1. `src/app/page.tsx` owns the chosen place, selected parcel, and viewport.
   It defaults to Downtown SLO and calls `useParcels(place, view)`.
2. `src/components/RiskMap.tsx` reports camera bounds after movement settles
   (400 ms). It renders the returned parcel units and uses `useParcelDisplay`
   from `src/lib/ParcelAreas.tsx`, which now passes all units through as
   individuals without running the retained grouping implementation.
3. `src/lib/useParcels.ts` calls `lookupParcelsInView` in `parcelApi.ts`.
   Requests flow through the browser-session cache in `parcelCache.ts` to
   `GET /api/parcels`, implemented in `src/app/api/parcels/route.ts`.
4. `src/lib/parcels.ts` queries the SLO County ArcGIS parcel layer, validates
   geometry, and strips provider properties down to parcel ID, source, and time.
5. `src/lib/parcelUnits.ts` converts GeoJSON into `ParcelUnit` objects with
   geometry, acreage, label center, and an initially null score.
6. The hook adds point membership and scores, then filters units to the viewport.
   The map and parcel list receive these units; visual grouping does not change
   their underlying geometry or individual scores.

## Boundary service and limits

The default layer is
`https://gis.slocounty.ca.gov/arcgis/rest/services/PLN/PLN_WEB_SERVICES/MapServer/0`.
Server overrides are `PARCEL_LAYER_URL`, `PARCEL_ID_FIELD` (default `apn`), and
`PARCEL_OBJECT_ID_FIELD` (default `OBJECTID`). Only HTTPS ArcGIS layer URLs and
simple field names are accepted.

- Queries accept either `bbox=west,south,east,north` or `lat`/`lon` with an
  optional radius in metres. Maximum search area is 25 km2; maximum radius is 2 km.
- FireBlock requests 501 records, returns the first 500, and sets
  `metadata.truncated` when an extra record or provider transfer-limit flag exists.
  The 500 limit is an application cap, not a verified county-service maximum.
  `MAX_PARCELS` in `parcelDisplayConfig.ts` is shared by the service, cache,
  projection and truncation notice.
- Results are ordered by object ID, not distance. There is no pagination loop.
  `lookupParcels` also supports a 300 m point neighborhood and, when truncated,
  an exact-point lookup to recover the parcel at the chosen location. The main
  viewport hook uses `lookupParcelsInView` instead.
- Provider reads have a 15-second timeout and an 8 MiB response limit. Geometry
  must be closed Polygon/MultiPolygon rings with finite coordinates, with at
  most 200,000 vertices per feature. GIS boundaries are not surveyed boundaries.
- The main hook rejects chosen points outside its SLO coverage check. A viewport
  over 25 km2 returns `too-wide` without requesting boundaries.

Raising the cap requires coordinated changes: `parcels.ts` caps responses,
`parcelCache.ts` rejects cacheable payloads over 500 features, and
`parcelRisk.ts` caps cloud-grid projection at 500 parcels. Revisit cache budgets,
UI notices, and tests too; changing only the provider request is insufficient.

## Geometry and label centers

GeoJSON uses `[longitude, latitude]`; Leaflet parcel rings and centers use
`[latitude, longitude]`. `toParcelUnits` and `toGeoJSON` in `parcelUnits.ts`
perform the conversion and preserve holes and disconnected parts. Turf area
supplies acreage, excluding holes.

`centerOf` chooses the part with the largest bounding-box area, calls
`labelPoint` on its outer ring, then tries offsets around holes if necessary.
`src/lib/geo.ts` searches and refines a grid in three rounds, keeping labels
inside concave shapes when a suitable candidate is found.

A module-local, 512-entry LRU Map caches centers by parcel ID plus the nested
part/ring vertex counts. Returned centers are copies, so callers cannot mutate
the cached value. This key does **not** compare coordinate values: changed
coordinates with the same ID and ring lengths can reuse an old center until
eviction or module reload. It has no TTL or persistent-storage writes.

## Loading, retention, and scoring

`useParcels.ts` starts requests only once a place and viewport exist. There is
no fixed zoom cutoff. Replies are matched to both place ID and viewport key;
stale requests are aborted. The last successful response for the same place
stays available during loading, errors, and too-wide views. A different place
cannot reuse that retained response. Retention is one response, not an
ever-growing collection of parcels from every previous viewport.

The hook deliberately uses two memos:

- `scoredUnits` computes `atPoint` and scores from display geometry, place,
  scans, cells, and the evidence-version score cache. It does not depend on view.
- `units` applies only the viewport bounding-box filter to those scored units.
  Panning with unchanged display/evidence reuses the same parcel objects.

`src/lib/parcelScore.ts` applies this priority:

1. The newest valid saved scan whose GPS point lies inside the parcel wins.
   Its score is `round(100 * risks / (risks + clears))`.
2. Otherwise, intersect the parcel with scored risk cells. The score is their
   intersection-area-weighted mean, rounded to an integer, only when scored
   cells cover at least 60% of the parcel.
3. Otherwise the score is null. Unknown coverage is never a zero-risk score.

The hook loads `/data/risk_map.geojson` once on mount through `loadRiskCells`.
A missing/unreadable file means no cells. `useParcelScans.ts` watches the local
scan store (`fireblock.parcelScans.v1`); `parcelScanStore.ts` retains the last
200 appended scans. These are observations and relative estimates, not calibrated
ignition probabilities or a certification that land is safe.

## Screen area and merged outlines

**Combining is disabled in the active map.** `useParcelDisplay` returns the
original parcel array as `individuals` and an empty `areas` array. It does not
subscribe to camera events, instantiate an outline cache, or call
`parcelDisplay`, `parcelScreenFraction`, clipping, union, or grouping score math.
Every loaded, viewport-filtered parcel keeps its own boundary, score and click
target regardless of screen size. The API identifies this as
`X-FireBlock-Parcel-Display: individual-parcels` and no longer reports an active
screen threshold.

The following describes **retained, unused grouping code** for future reference;
these helpers are exercised only by their legacy unit tests:

`src/lib/parcelDisplay.ts` measures actual visible geometry in Web Mercator
screen space. A parcel at or above 5% of viewport area stays individual; a
selected parcel also stays individual. The threshold lives in
`parcelDisplayConfig.ts`.

For area calculation, project vertices and compute a bounding box. A wholly
outside parcel has zero visible area. A contained parcel uses shoelace outer
area minus hole areas directly. Only bounds crossing the viewport edge invoke
`polyclip-ts` `intersection()`. Divide the resulting area by viewport area.
Invalid camera/geometry paths retain original boundaries rather than hiding them.

Small parcels are bucketed by their centers into screen-sized neighborhoods.
Buckets containing at least two parcels use polygon `union()` of their real
outlines, preserving holes and disconnected pieces. Singletons stay individual.
Group scores are acreage-weighted known scores, requiring at least 60% known
member acreage. This group coverage is distinct from cell coverage within a parcel.

The retained `ParcelOutlineCache` supports up to 128 entries and an
approximately 8 MiB serialized-string budget. Sorted member IDs and complete
coordinates form the key. Unchanged groups reuse the same `parts` reference
across pans, zoom returns, and score refreshes, avoiding repeated union and
Leaflet position updates. Membership or coordinate changes rebuild the outline;
panning can change bucket membership. Scores are recomputed independently.
Move-end, zoom-end, and resize events refresh grouping. Clicking a group fits
its member geometry; zooming in restores individual parcel boundaries.

## Other caches

| Cache | Scope and bounds | Important behavior |
|---|---|---|
| `ParcelSessionCache` in `parcelCache.ts` | Browser session; 16 entries, 8 MiB total payload, 2 MiB per entry, 5-minute TTL | Reuses exact queries; complete containing responses can serve smaller areas after geometry filtering. Truncated responses cannot establish smaller-area coverage. |
| In-flight boundary requests | Same session; four requests, 32 subscribers per request, 20-second timeout | Identical requests share work; each subscriber can cancel independently. |
| `ParcelScoreCache` in `parcelScoreCache.ts` | Per hook/evidence version; 512 entries, 1 MiB geometry-key budget, 128 KiB per entry | Keyed by parcel ID with exact geometry comparison; returns cloned scores. New scans/cells create a fresh cache; timer/page exit/unmount clear it. |

Boundary caching stores public geometry and whitelisted metadata only, not
addresses, photos, or scan GPS data. It is memory-only and cleared on page exit.
Always preserve the native fetch receiver (`fetcher.call(globalThis, ...)`):
binding native fetch to a cache object previously caused `Illegal invocation`
before any HTTP request. Automatic nearby preloading is disabled; its helper
still exists but is not called by the main hook.

## Cloud grid overlay and archive: a separate scoring path

Do not assume the main hook's static risk cells are the cloud overlay's grid.
`src/lib/ParcelOverlay.tsx` loads viewport `/api/risk-grid` data on mount,
after movement (250 ms debounce), and every 60 seconds. It also accepts a local
grid file. The cloud endpoint composes published regional runs; see
`docs/risk-catalog.md` for discovery and overlap handling.

`projectGridToParcels` in `parcelRisk.ts` validates up to 10,000 non-overlapping
rectangular WGS84 cells and projects them onto at most 500 parcels. It returns
coverage, observed mean, peak score, model/time provenance, and a nullable
published score with the same default 60% coverage requirement.

When `RiskMap` supplies `parcelMask`, the overlay is in managed-parcel mode:
it skips its own parcel projection/rendering because the main UI already owns
those parcels. Its cloud grid does **not** update `useParcels` scores. The grid
can be displayed outside parcel masks; hidden grids skip that clipping work.

`POST /api/parcel-display` archives a fresh county lookup plus its configured
cloud-grid projection to B2. It does not archive an imported local grid. Writes
require same-origin requests, licensed caching enabled through
`PARCEL_CLOUD_CACHE_ALLOWED=true`, and a `CLOUD_WRITE_TOKEN` bearer token outside
localhost. B2 credentials stay server-side. See `docs/cloud-retention.md`.

## Verification and maintenance

Focused regression command from the repository root:

```powershell
npm test -- src/lib/parcels.test.ts src/lib/parcelApi.test.ts src/lib/parcelUnits.test.ts src/lib/geo.test.ts src/lib/useParcels.test.tsx src/lib/parcelCache.test.ts src/lib/parcelScore.test.ts src/lib/parcelScoreCache.test.ts src/lib/parcelDisplay.test.ts src/lib/ParcelAreas.test.tsx src/lib/ParcelOverlay.test.tsx src/lib/parcelRisk.test.ts
npx tsc --noEmit
```

If Node is absent from PATH, the local runtime is currently
`build/tooling/node-v24.11.1-win-arm64/node.exe`; invoke
`node_modules/vitest/vitest.mjs` or `node_modules/typescript/bin/tsc` with it.

Keep coverage honesty, coordinate order, cancellation, cache bounds, and reference
reuse covered when modifying this system. Some historical docs/comments still
mention a zoom-17 cutoff or preloading; current executable behavior described
above takes precedence. Further references: `docs/parcel-boundaries.md`,
`docs/parcel-risk-display.md`, `docs/parcel-detail-levels.md`, and
`docs/parcel-preloading.md`.
