# Server-side SLO parcel snapshot

Imported from the user's `Downloads/Parcels.geojson` on November 15, 2026.
The source contained 17,469 features and 17,468 unique APNs. Two pieces of
APN 004-709-033 were unioned into one multipart parcel. This is a SLO-area
export, not a complete county database. Coverage bounds and source/download
checksums are recorded in `manifest.json`.

Only APNs and original polygon coordinates are retained. Owner links, legal
descriptions, notes and other source attributes were removed. The 1.86 MB
gzip is a server asset, outside `public/`; browsers receive only requested
parcels through `/api/parcels`. Keep provider attribution/usage permissions
with the source export when distributing updates.

The backend verifies the compressed checksum and constructs one in-memory
spatial index per process. Warm point and viewport queries reuse that index.
Point queries respect polygon holes and multipart parcels. Envelope queries
use exact polygon intersections after bucket/bounds filtering. Acreage filters
use precomputed spherical polygon area. Existing 25 km2 query, 500-result and
`truncated` behavior remains. Returned geometry is full resolution.

The county provider URL remains the identifier namespace so existing cloud scan
history stays associated with the same APNs. `metadata.dataSource` and the
`X-FireBlock-Parcel-Source` response header identify `bundled-geojson`; the note
states that boundaries came from this snapshot. Empty results outside its
coverage do not establish absence of parcels.

Local-first is the default and needs no ArcGIS or B2 credentials. The county
service is still queried if there are no local matches, a request crosses the
export bounds, or the bundled asset cannot load. Local and remote APNs are
deduplicated. When the county fails but local matches exist, those matches are
returned with `truncated: true` and an incomplete-coverage note. If no local
matches exist, a county failure remains an error rather than a false empty result.
Requests already hitting the 500-result local limit do not need another query.
`PARCEL_DATA_SOURCE=arcgis` forces live lookup; `bundled` explicitly disables the
fallback for offline use. A custom `PARCEL_LAYER_URL` uses the live adapter only.

To replace the export:

```powershell
npx tsx scripts/import_parcels.ts C:\path\to\Parcels.geojson
npm test -- src/lib/bundledParcels.test.ts src/lib/parcels.test.ts
npm run build
```

The importer accepts uppercase `APN`, lowercase `apn`, or normalized `parcelId`.
Input polygons must already use WGS84 longitude/latitude. It does not infer
identifiers or transform projected coordinates. Deploy the gzip and manifest
together; Next.js traces the asset into all four parcel-consuming API routes.
