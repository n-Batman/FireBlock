# Santa Margarita real risk result

Confirmed added 50-box collection centered near 35.3899, -120.6177.
This is Santa Margarita, north of SLO, rather than Santa Maria.

The cloud parser analyzed one distinct Sentinel-2 L2A archive acquired
2026-11-11 and four distinct FIRMS CSV contents from the completed collection.
The nominal 200 m grid has 1,440 cells, all scored. Two thermal detections were
older than the 72-hour cutoff and excluded from the current relative-risk score.

The result and its checksum-pinned frontend catalog entry are verified in
Backblaze. Temporary parsing inputs and rasters were removed after verification.
This small GeoJSON is the deployment fallback for sites without B2 credentials;
`catalog.json` selects it by location. `provenance.json` records immutable cloud
identities and checksums. Scores are experimental relative susceptibility,
not ignition probabilities or fire predictions.
