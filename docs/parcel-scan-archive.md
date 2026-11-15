# Backend parcel scan archive

The backend can save scanner scores and problem findings in Backblaze B2,
grouped by land parcel, and compare follow-up scans against an explicit original
baseline. The existing frontend scanner, local scan storage, parcel map scoring
and scanner requests are unchanged. Nothing calls this API from the browser yet.

## Setup and access

Configure the existing server-side `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`
and `B2_BUCKET_NAME`, plus a strong random `CLOUD_WRITE_TOKEN`. The private B2
key needs read/list/write access to the `parcel-scans/` prefix. A website key
restricted to `risk/` cannot save these records. Keep the bucket private and
these credentials on the backend; do not use `NEXT_PUBLIC_` variables or ship
the bearer token to the browser.

Both API methods require `Authorization: Bearer <CLOUD_WRITE_TOKEN>`, including
on localhost. Missing server authentication configuration returns 503; missing
or incorrect caller credentials return 401. Responses use `private, no-store`.
This is trusted-backend access, not a user account/parcel ownership system.

## Save the first scan

`POST /api/parcel-scans` accepts a JSON observation, at most 32 KiB:

```json
{
  "location": {"lat": 35.324008, "lon": -120.717764, "accuracy_m": 5},
  "scanned_at": "2026-11-15T05:00:00Z",
  "score": 70,
  "model_id": "headline-estimate-v1",
  "findings": [
    {"label": "Dry grass", "severity": "risk", "action": "Clear the dry growth"}
  ]
}
```

This is an illustrative request, not a real observation of that location.
`score` is the scanner's measured **dry-fuel percentage**, 0 to 100, lower being
better. It is not a wildfire probability or the satellite risk-map score. Supply
the actual score and a versioned identifier for the scoring method/prompt;
estimate-based and fallback mask-share measurements need different method IDs.
Do not submit uncertain or missing scanner output as a measured zero.

The time must include a timezone; clocks more than five minutes ahead of the
server are rejected. Optional GPS accuracy must be 0 to 100 metres. Findings
are optional, up to 20, with `risk` or `clear` severity, labels up to 120
characters and actions up to 500. Unknown fields, client-supplied parcel IDs,
images, masks and raw model responses are rejected. No photos are stored.

The server queries the configured county parcel service at the exact GPS point,
then verifies containment in its Polygon/MultiPolygon, including holes. It uses
the returned APN and provider source to group the record. Missing parcels return
422, multiple matches return 409, and truncated/provider failures fail the save.
GPS and county geometry establish a GIS assignment, not surveyed ownership or
proof that the scanner was physically at the claimed coordinates.

A verified upload returns 201 with `{scan, receipt}`. The scan includes its
server-generated `scan_id`, `recorded_at`, canonical `scanned_at`, parcel APN,
provider/match timestamp, score, method, findings and `baseline_id: null`.
The receipt includes the immutable B2 file ID, key, byte count and SHA-256.

## Save the second scan

Submit another observation with `baseline_id` equal to the first response's
`scan.scan_id`. No automatic pairing by parcel is performed: separate places
on the same property can have independent baselines.

```json
{
  "location": {"lat": 35.324008, "lon": -120.717764, "accuracy_m": 5},
  "scanned_at": "2026-11-15T06:00:00Z",
  "score": 30,
  "model_id": "headline-estimate-v1",
  "baseline_id": "COPY_THE_FIRST_SCAN_ID_HERE",
  "findings": []
}
```

The baseline must exist under the same parcel/provider, be an original scan
rather than another follow-up, and use the same method version. The new capture
must be later and within 25 metres of the baseline GPS point. An incompatible
comparison returns 409; a missing baseline for this parcel returns 404. To start
an independent survey, omit `baseline_id` instead.

The response adds:

```json
{
  "comparison": {
    "baseline_score": 70,
    "improvement_points": 40,
    "outcome": "improved",
    "distance_m": 0
  }
}
```

`improvement_points = baseline.score - followup.score`, in percentage points.
Positive means improved, zero unchanged, negative worsened. No division by the
baseline is used, so zero baselines work. The first score is preserved. More
follow-ups can reference the original baseline. Similar GPS points do not
guarantee matching camera views or prove that a score change was caused by work;
lighting, framing and measurement uncertainty still matter.

## Read scans grouped by parcel

`GET /api/parcel-scans?parcel_id=123-456-789&limit=50` returns:

```json
{
  "parcel": {"id": "123-456-789", "source": "configured county layer URL"},
  "scans": [],
  "next_cursor": null
}
```

Use the APN from the save response. `limit` is 1 to 100, default 50. Pass the
returned cursor back as URL-encoded `cursor` to read the next page. Cursors are
scoped to one parcel/provider and cannot read another prefix. Results are
ordered by server receipt time, then random ID for ties; `scanned_at` preserves
the original capture time for backfilled data. An empty page is not a zero score.

## Cloud layout and consistency

Records live at:

```text
parcel-scans/v1/<SHA256([provider URL, APN])>/<receipt-time-ms>-<UUID>.json
```

Each record is one verified JSON object. Separate random IDs preserve concurrent
scans without updating a shared parcel index or latest-score file. Data remains
private, outside `risk/catalog/` and website fallback snapshots. Parcel polygon
geometry is used transiently for matching and is not archived; the parcel
boundary caching opt-in is not needed for these scan observations.

Reads follow listed immutable B2 file IDs and verify download sizes/checksums.
Each scan object is capped at 64 KiB before download, history pages at 100,
and concurrent record reads at four. There is no 500-record lifetime limit;
pagination keeps per-request work bounded. A changed parcel-layer configuration
selects a different provider namespace; existing records are not reassigned.

Each POST creates a new observation; it is not an idempotent retry API. After an
ambiguous transport/upload failure, inspect history before submitting the same
capture again. There is no cross-page transaction snapshot, automatic deletion,
whole-parcel score aggregation or mutation of past scan records.

Tests cover baseline/follow-up outcomes, zero scores, time/method/location
compatibility, wrong parcels, holes, multipart geometry, malformed input,
concurrent saves, bounded pagination/downloads, private access and cloud failures.
