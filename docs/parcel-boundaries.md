# Property-line lookup and risk-map overlay

To color complete properties from the backend risk grid, use the new
[parcel risk display](parcel-risk-display.md). The lookup and boundaries below
also remain available on their own.

The main Leaflet risk map now includes **Property boundaries** in the lower-right
corner. Enter latitude/longitude, click **Pick on map**, or zoom to a small region
and click **Find in visible area**. Returned parcel outlines appear in cyan over
the existing risk polygons. Their interiors remain transparent. Hover to see a
parcel identifier; use the checkbox to hide/show the layer or **Save GeoJSON** to
export the returned geometry and source metadata.

The map and parcels use WGS84 longitude/latitude. Leaflet projects both onto the
same basemap automatically. Parcel polygons are separate from management blocks;
looking up a parcel does not create or alter a risk score. The current risk layer
still uses the application's explicitly labeled demo data until live scores are
connected. This change does not invent a parcel-level score or calculate clipped
area-weighted statistics.

## Server API

```text
GET /api/parcels?lat=35.28&lon=-120.65
GET /api/parcels?lat=35.28&lon=-120.65&radius=300
GET /api/parcels?bbox=-120.66,35.27,-120.65,35.28
```

A zero-radius point query returns the polygon(s) intersecting the point. Radius
is in metres and searches a rectangular envelope around the point, not a circular
distance filter. Bbox is west,south,east,north. Searches are capped at 25 km²,
radius at 2 km and results at 200 features. `metadata.truncated` explicitly reports
limited results; zoom in rather than assuming that every surrounding parcel was
returned. Coordinates on a shared boundary can legitimately return multiple parcels.

Responses are GeoJSON Polygon/MultiPolygon FeatureCollections. Hole rings and
multipart parcels are preserved. Properties include only `parcelId`, `source`
and `fetchedAt`; owner names and mailing addresses are neither requested nor sent
to the frontend. Metadata includes attribution URL, query time, limits and a
planning-use note. Errors use HTTP 400 for input errors and 502 for unavailable or
invalid provider data. Requests have a 15-second provider timeout and an 8 MiB
response-size cap. No browser-supplied provider URLs or arbitrary SQL are accepted.

The default source is the public **SLO County Parcels** query layer:

https://gis.slocounty.ca.gov/arcgis/rest/services/PLN/PLN_WEB_SERVICES/MapServer/0

A live point query was verified during implementation. Coverage is San Luis
Obispo County, not a nationwide lookup. Missing results outside that service's
coverage do not mean no property exists. GIS boundaries are planning references,
not legal surveys; verify recorded documents/survey data for boundary decisions.
The county's [parcel data information](https://www.slocounty.ca.gov/departments/information-technology/services/gis-services/gis-parcel-data)
describes its ParcelQuest licensing. A public query endpoint does not establish
unrestricted bulk redistribution rights; retain attribution and check the
provider's terms for your deployment.

## Other areas

An operator can configure a permitted ArcGIS Polygon layer in server-side `.env.local`:

```text
PARCEL_LAYER_URL=https://your-authorized-provider/arcgis/rest/services/Parcels/FeatureServer/0
PARCEL_ID_FIELD=APN
PARCEL_OBJECT_ID_FIELD=OBJECTID
```

The service must support spatial intersection, ordering, GeoJSON queries and
WGS84 output. Source URLs are operator configuration, not user input. The default
field names are `apn` and `OBJECTID`. There is no automatic paid provider signup,
address geocoding or inference of property lines from satellite photographs.

## Frontend contract

`src/lib/parcels.ts` exports `findParcels` and the independent `Parcels` type.
`src/app/api/parcels/route.ts` sends that result to the browser. The Leaflet
`ParcelOverlay` component calls this API, cancels stale requests, displays errors
and draws an independent transparent GeoJSON pane above the risk layer.
`RiskMap.tsx` mounts it with the active property's starting center. The shared
`src/data/types.ts` risk-score contract was not changed.

Tests exercise point/area validation, query order/projection, provider errors,
geometry retention, result limits, metadata stripping and API validation. The
source service follows [ArcGIS spatial query conventions](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/).
