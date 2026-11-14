# Downtown San Luis Obispo satellite analysis

Real Sentinel-2 L2A imagery acquired November 11, 2026, with FIRMS snapshots for
November 11-13. Published November 14 from 50 completed nominal 1 km collection
boxes. The analysis covers their enclosing rectangle on a nominal 200 m grid.

- 1,476 cells: 1,466 scored, 10 unknown.
- Mean known-cell score: 14.38/100; peak: 31.78/100.
- No FIRMS detections in the supplied snapshots.
- Two full Sentinel-2 products were verified against the archived inventories.
- 200 FIRMS snapshots reduced to two distinct CSV contents; duplicates do not
  inflate the thermal signal.

`provenance.json` pins source versions, the verified cloud manifest and checksums.
`risk_map.html` loads sibling `risk_map.geojson`; direct file viewing uses its
GeoJSON file picker. The public website version is `/results/slo-town/index.html`.
The active cloud pointer and website snapshot now select this run; the earlier
Silver River result remains available at `/results/silver-river/index.html`.

The model is an experimental spectral/hotspot susceptibility index, not a fire
probability or a safety assessment. Weather, wind, terrain, dead fuel and building
vulnerability are not modeled. Missing detections do not establish absence of fire.
Unknown cells remain unknown. This snapshot excludes credentials, local paths,
raw archives, scan photos and personal parcel information.
