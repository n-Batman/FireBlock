# Mathematical cloud risk pipeline

The current pipeline now connects immutable B2 raw inputs → ParserController →
calibrated/quality-masked Sentinel-2 NDVI/NDMI and normalized FIRMS detections →
mathematical scores on nominal 200 m cells → verified cloud outputs → frontend.

## Formula

```text
V = clamp((NDVI − 0.2) / 0.6, 0, 1)
D = clamp((0.4 − NDMI) / 0.8, 0, 1)
H = max(exp(−distance/radius) × 2^(−age/half_life))
R = 100 × V × (0.7 × D + 0.3 × H)
```

V is a vegetation proxy, D is a dryness proxy, and H is recent hotspot pressure
within the configured radius/time window. Configurable weights are normalized
by their sum. Maximal dry vegetation scores 70 without hotspots and 100 with
maximal hotspot pressure. These are transparent design choices requiring local
validation, not calibrated ignition probabilities or assurances of safety.

Only sufficiently covered scenes acquired at or before the issue time are used.
Stale/future imagery is excluded. Cells missing either index remain unknown even
if a replacement model emits a score. Features and manifests preserve timestamps,
source versions, model ID, inputs, formula and parameters. Duplicate observations
are not added together to inflate H. FIRMS-only input cannot manufacture missing
vegetation/moisture evidence.

This is a provisional spectral/hotspot susceptibility model. It does not implement
the planned complete weather/fuel/slope/hazard/history score: weather, terrain,
dead-fuel and exposure inputs must be added before those factors can be modeled.

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
