# Nearby parcel preloading and session caches

After visible parcels load successfully, the map waits 500 ms, then requests one
envelope around the current view. That envelope extends each edge by 25% of the
view width/height. Preloading is restricted to views no larger than 4 km², so the
expanded query remains below the existing 25 km² provider limit. It does not
crawl the county. Truncated visible results, data-saving mode and 2G connections
skip preloading. Moving the view, choosing another place or unmounting the hook
cancels the pending preload and timer.

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

Parcel scores have a separate per-hook memo capped at 128 entries and 1 MiB of
serialized geometry. The memo stores geometry and computed scores, without raw
scans, photos, addresses or scan GPS coordinates. It is replaced when either the
risk-cell array or saved-scan array changes, and is cleared every five minutes,
on pagehide and on unmount. It does not rerun the satellite risk model. The app's
existing scan-storage feature is independent; this cache does not add scan writes.

Verification: 48 targeted tests passed across the cache, score memo, parcel API,
parcel hook and overlay. Coverage includes byte/count/TTL limits, holes and point
queries, truncated results, independent subscribers, cancellation, hung requests,
late responses, page exit, private-field stripping, no persistent storage writes,
preload cancellation on unmount and updated scores after new scan evidence.
Type checks passed for the changed files. No whole-frontend verification was run.
