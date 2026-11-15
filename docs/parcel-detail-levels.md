# Parcel detail by screen coverage

Current behavior: combining is disabled. All loaded, viewport-filtered parcels
render individually, regardless of size or zoom. `useParcelDisplay` is a
pass-through with no camera subscriptions, screen-area calculations, clipping,
union work or outline cache. `parcelDisplay.ts` remains for reference and legacy
unit tests but has no active rendering caller. The API reports
`X-FireBlock-Parcel-Display: individual-parcels` without a screen threshold.

Small parcels are now skipped using fixed acreage tiers: all sizes at zoom 17+,
0.25 acre at 16, 1 at 15, 4 at 14, 16 at 13, and 64 below 13. Viewport requests
send `min_acres`; the county's square-foot area field filters before geometry is
downloaded. Retained parcels use their existing acreage for immediate filtering
on zoom-out. Point/radius searches are unaffected. Bounds are memoized per scored
response; panning needs only numeric comparisons, not new polygon area or union
calculations. Filtered cache entries are reused only for identical query keys.

The following grouping description is historical and inactive:

Individual parcel visibility has no fixed zoom cutoff. A parcel remains an
individual boundary when its actual visible shape occupies at least 5% of the
map viewport area. The calculation uses Web Mercator (screen) coordinates,
clips against the viewport, and subtracts holes. A selected parcel always keeps
its original boundary. Invalid camera or grouping geometry retains the original
parcels rather than hiding them.

Parcels below 5% are grouped with other small parcels in screen-sized
neighborhoods. Each displayed shape is the polygon union of the member outlines,
not a bounding box. It preserves holes, roads/gaps and disconnected parts as
multipart polygons. A lone small parcel stays individual. Group scores use the
acreage-weighted mean of known member scores and require 60% known acreage;
unknown scores are never treated as zero. The source polygons, per-parcel scores
and backend risk grid remain unchanged.

Grouping recomputes on pan, zoom and viewport resize. Zooming back in restores
the exact source parcel units once they reach 5%. Clicking a group fits its
member geometry. The map permits zoom through level 24, enlarging level-19
imagery beyond its native resolution, so small city lots can reach the screen
threshold. There is no guarantee of additional imagery detail at those levels.

Current loading behavior: parcel queries use the visible geographic bounds at
any zoom. FireBlock limits remain 25 square kilometres and 500 returned parcels per request, with
truncation reported in the UI. Previously loaded geometry stays visible while
its replacement loads or when zooming out beyond the query-area limit. A new
location cannot reuse another location's retained parcels; stale requests are
aborted. Wide views show only already loaded properties until the camera returns
to a queryable area. Synthetic rectangular risk-overview tiles no longer replace
property polygons. Existing session cache and score-cache bounds still apply.

Regression checks cover the 5% boundary, visible-area clipping, holes,
aspect-ratio changes, nonrectangular unions, multipart gaps, selected parcels,
score weighting, real Leaflet zoom/resize events and data retention through
zoom-out/zoom-in.

Browser requests preserve the native `fetch` global receiver. Calling a stored
native fetch function as a cache-instance method can throw `Illegal invocation`
before any HTTP request, which previously appeared as an unreachable parcel
service despite a healthy `/api/parcels` endpoint. Receiver-sensitive cache and
hook tests exercise this path; generic fetch mocks alone do not reproduce it.
