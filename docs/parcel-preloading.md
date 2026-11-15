# Nearby parcel preloading and session caches

Automatic nearby preloading is disabled following a reported loading regression.
Only the chosen point and visible area trigger lookups. The existing bounded
request cache still reuses completed results and shares identical pending requests.
No background envelope requests are scheduled after visible parcels load.

The sidebar and parcel overlay share a browser-session request cache:

- At most 16 responses and 8 MiB of serialized JSON; individual cached responses
  are limited to 2 MiB. These are payload budgets, not total JavaScript heap size.
- Entries expire after five minutes, including while the page is idle. Oldest
  entries are evicted to satisfy the count and byte limits.
- At most four underlying requests and 32 subscribers per request. Requests time
  out after 20 seconds. Errors are not cached.
- Concurrent identical requests share a transport, with independent cancellation.
  The transport is aborted when its last subscriber leaves. Timers and abort
  listeners are removed on settlement, cancellation and session cleanup.
- A complete cached envelope can answer contained point/area searches. Results
  are filtered for actual rectangle/point intersection, including polygon holes
  and multipart parcels. Truncated results never establish smaller-area coverage.
- Each consumer gets an independent decoded response, preventing one view from
  modifying the cache or another view's result. Cancelled/cleared requests cannot
  repopulate the cache when a late response arrives.

The cache retains public parcel geometry, identifiers, source attribution and
fetch timestamps. Unknown provider fields are dropped. It has no localStorage,
sessionStorage, IndexedDB, disk, telemetry or shared server cache. The pagehide
event clears cached boundaries and cancels in-flight work. API responses use
`Cache-Control: private, no-store`; requests also disable the HTTP cache. Precise
query coordinates exist transiently in memory/network requests, not in an added
persistent viewing-history store.

Parcel scores have a separate per-hook memo capped at 256 entries and 1 MiB of
serialized geometry. The memo stores geometry and computed scores, without raw
scans, photos, addresses or scan GPS coordinates. It is replaced when either the
risk-cell array or saved-scan array changes, and is cleared every five minutes,
on pagehide and on unmount. It does not rerun the satellite risk model. The app's
existing scan-storage feature is independent; this cache does not add scan writes.

Verification: 71 targeted tests passed across the cache, score memo, parcel API,
parcel hook, overlay and scoring. Coverage includes byte/count/TTL limits, holes and point
queries, truncated results, independent subscribers, cancellation, hung requests,
late responses, page exit, private-field stripping, no persistent storage writes,
no speculative requests after loading and updated scores after new scan evidence.
Type checks passed for the changed files. No whole-frontend verification was run.

The score memo now holds up to 512 entries for a full 500-parcel response. A
smaller entry cap would evict the start of a full response before its next pass.
The regression check requires just 500 calculations across two full passes.
The byte limit remains unchanged, so especially large geometries can still evict.

The auxiliary boundary overlay skips automatic point requests and projections
when the main map owns the parcel shapes. Grid clipping runs only while its
layer is visible and enabled, and uses that main parcel mask without duplicate
geometry. This avoids performing polygon subtraction for an unchecked layer.
