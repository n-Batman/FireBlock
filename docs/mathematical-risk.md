# Mathematical cloud risk pipeline

The pipeline connects versioned satellite, FIRMS and optional weather inputs to
backend mathematical scores on nominal 200 m cells, verified cloud outputs and
the frontend. Weather math runs once per generated grid, never per parcel render.

## Formula (fireblock-relative-risk-v2)

```text
V = clamp((NDVI - 0.2) / 0.6, 0, 1)
D = clamp((0.4 - NDMI) / 0.8, 0, 1)
H = max(exp(-distance/radius) * 2^(-age/half_life))
B = (dryness_weight * D + hotspot_weight * H) / (dryness_weight + hotspot_weight)
W = 0.5 * clamp(wind_mph/30, 0, 1)
  + 0.3 * clamp((60-humidity_pct)/50, 0, 1)
  + 0.2 * clamp((temperature_c-15)/25, 0, 1)
R = 100 * V * ((1-weather_weight) * B + weather_weight * W)
```

Defaults: dryness_weight=0.7, hotspot_weight=0.3, weather_weight=0.3.
For fully vegetated, maximally dry fuel with no nearby hotspots, the old
satellite-only score is 70. With weather, W=0 gives 49 and W=1 gives 79.
These weights and normalization endpoints are provisional design choices,
not calibrated ignition probabilities, official FWI or assurances of safety.
Precipitation history, terrain, dead-fuel measurements and exposure are not modeled.

Without valid weather the score remains `100 * V * B`, with
`weather_status: unavailable`, `weather_pressure: null` and `weather: null`.
Missing weather is never treated as calm/humid weather. Setting weather_weight=0
disables its influence. Cells missing fresh NDVI or NDMI remain unknown regardless
of weather. Satellite freshness, coverage and hotspot deduplication are unchanged.

## Weather inputs

Add a top-level asset to the job, just like satellite/FIRMS assets:
`"weather": {"file_id": "ACTUAL_IMMUTABLE_WEATHER_SNAPSHOT_ID"}`.
A `key` or `local` path is also accepted instead of `file_id`. The pipeline hashes
and records that input and uploads local inputs before publishing. Prefer pinned
file IDs for reproducible cloud runs. Without this asset, runs retain baseline scores;
this change does not automatically fetch live weather or rewrite published grids.

The snapshot contract is `fireblock.weather.v1`, up to 10,000 records / 8 MiB.
This illustrative record is not a real forecast:

```json
{
  "schema": "fireblock.weather.v1",
  "records": [{
    "source": "Provider name and forecast identifier",
    "bbox": [-120.67, 35.275, -120.655, 35.285],
    "issued_at": "2026-11-13T11:00:00Z",
    "valid_from": "2026-11-13T12:00:00Z",
    "valid_to": "2026-11-13T13:00:00Z",
    "wind_mph": 15,
    "humidity_pct": 30,
    "temperature_c": 28
  }]
}
```

Use the provider's actual spatial coverage, issue time and validity interval;
never assign a point forecast to an arbitrary regional box. All timestamps need
timezones. A record must cover the entire risk cell and satisfy
`issued_at <= risk.as_of`, `valid_from <= risk.as_of < valid_to`, and the issue-age
limit `risk.weather_max_age_hours` (default 6, configurable 0.1 to 24).
The newest eligible issue wins; equal-time overlaps keep the first record.
Any missing measurement makes that record unavailable. Invalid numeric values,
physical ranges, timestamps or boxes fail the run instead of being invented.
Each output cell carries the chosen raw record for source/time/unit provenance.

The [daily backend collector](daily-collection.md) normalizes NWS hourly forecasts
to this contract. Other collectors can supply the same timestamped contract;
the browser's point-weather response is not silently reused as regional weather.
Records can include a closed convex `coverage_polygon`; the entire cell must
then be contained in that footprint as well as the bbox.
The additive weather fields preserve the `fireblock.risk-features.v1` contract
for existing custom models; the mathematical model ID advances to v2.
Custom models receive weather_pressure arrays (NaN means unavailable) and can
choose whether to use them. Existing published v1 maps change only after regeneration.

## Run and publish

In `config/risk.cloud.example.json`, replace the raw manifest placeholder ID and
set the bbox and timezone-aware `risk.as_of` for your actual data. Existing `.env`
B2 credentials are used through the C++ backend. Then run:

```powershell
.\.venv\Scripts\python.exe python/worker_entry.py risk config/risk.cloud.example.json --validate
.\.venv\Scripts\python.exe python/worker_entry.py risk config/risk.cloud.example.json
```

The C++ launcher supports the same `risk` command. With
`storage.publish_frontend: true`, the pipeline uploads all outputs and a complete
analysis manifest, verifies their receipts, then publishes `risk/latest.json`.
That pointer pins the manifest ID, SHA-256, byte count, issue time, model and bbox.
Parsing or manifest-upload failure cannot publish a new pointer. An ambiguous
pointer-upload failure may still reach B2, but its target is already complete.
Verified cleanup still applies, leaving small local receipts instead of imagery.

The frontend automatically requests `/api/risk-grid` on map mount. The server
prefers an explicitly pinned `B2_RISK_MANIFEST_FILE_ID`; otherwise it resolves
`B2_RISK_POINTER_KEY` (default `risk/latest.json`), verifies the manifest and grid,
then returns the unchanged grid for property-boundary aggregation. No disk grid
cache or manual manifest-ID edit is needed in the pointer flow. Use the panel's
load button to refresh an already open map. A pending automatic response does
not override a manually imported file.

Use separate pointer keys per region/deployment. A pointer is the last completed
publisher, not necessarily the newest observation time. Coordinate concurrent
writers; this is not a distributed scheduler or compare-and-swap publication.
The example does not reference live raw data until its placeholder is replaced.

## Add an AI model later

`risk_model.py` defines `RiskModel` and the default `MathematicalRiskModel`.
A trusted replacement declares `model_id` and compatible `feature_schema`, accepts
aligned NumPy arrays (`ndvi`, `ndmi`, `hotspot_pressure`) and parameters, and
returns a same-shape array of 0–100 scores. The evaluator checks shape, schema and
finite bounds and masks unknown input cells. It does not dynamically import code
from a configuration string.

```python
from fireblock_analysis.controller import ParserController
controller = ParserController.from_config(job)
controller.run(job, risk_model=validated_ai_model)
```

Model training, calibration, holdout evaluation and leakage prevention remain
the model implementer's responsibility. The separate `PredictionModel` interface
supports probability forecasts with explicit horizons and target events; these
relative risk scores do not automatically become probabilities.

Tests cover baseline calculations, invalid replacement outputs, missing evidence,
cloud-version inputs, manifest-before-pointer ordering, failed publication and
frontend resolution of the immutable published grid.
