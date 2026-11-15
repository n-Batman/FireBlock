import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { MAX_PARCELS } from "./parcelDisplayConfig";

export const DEFAULT_PARCEL_LAYER = "https://gis.slocounty.ca.gov/arcgis/rest/services/PLN/PLN_WEB_SERVICES/MapServer/0";
export class ParcelError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type ParcelProperties = { parcelId: string; source: string; fetchedAt: string };
export type Parcels = FeatureCollection<Polygon | MultiPolygon, ParcelProperties> & {
  metadata: { source: string; truncated: boolean; limit: number; fetchedAt: string; note: string; dataSource?:"bundled-geojson"|"arcgis"|"bundled-geojson+arcgis" };
};
export function searchGeometry(params: URLSearchParams) {
  const numeric = (key: string) => {
    const raw = params.get(key);
    if (raw === null || !raw.trim() || !Number.isFinite(Number(raw))) throw new ParcelError(`Invalid ${key}`);
    return Number(raw);
  };
  if (params.has("bbox")) {
    if (params.has("lat") || params.has("lon") || params.has("radius")) throw new ParcelError("Choose point OR bbox");
    const values = params.get("bbox")!.split(",");
    if (values.length !== 4 || values.some(v => !v.trim() || !Number.isFinite(Number(v)))) throw new ParcelError("bbox must be west,south,east,north");
    const [w,s,e,n] = values.map(Number);
    return envelope(w,s,e,n);
  }
  const lat = numeric("lat"), lon = numeric("lon");
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180) throw new ParcelError("Point outside supported coordinate bounds");
  const radius = params.has("radius") ? numeric("radius") : 0;
  if (radius < 0 || radius > 2000) throw new ParcelError("radius must be 0–2000 metres");
  if (!radius) return { geometry: JSON.stringify({ x:lon,y:lat,spatialReference:{wkid:4326} }), geometryType:"esriGeometryPoint" };
  const dy = radius/111195, dx=dy/Math.cos(lat*Math.PI/180);
  return envelope(lon-dx,lat-dy,lon+dx,lat+dy);
}
function envelope(w:number,s:number,e:number,n:number) {
  const area=(e-w)*111.195*Math.cos((s+n)/2*Math.PI/180)*(n-s)*111.195;
  if (w < -180 || e > 180 || s < -85 || n > 85 || w >= e || s >= n || area > 25) throw new ParcelError("Use a valid area no larger than 25 km²; split antimeridian searches");
  return {geometry:JSON.stringify({xmin:w,ymin:s,xmax:e,ymax:n,spatialReference:{wkid:4326}}),geometryType:"esriGeometryEnvelope"};
}
export function normalizeParcelGeometry(value: unknown): Polygon | MultiPolygon {
  if (!value || typeof value !== "object") throw new ParcelError("Invalid parcel geometry from provider",502);
  const g=value as Polygon | MultiPolygon;
  if (g.type!=="Polygon" && g.type!=="MultiPolygon") throw new ParcelError("Provider must return parcel polygons",502);
  const polygons=g.type==="Polygon" ? [g.coordinates] : g.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) throw new ParcelError("Empty provider geometry",502);
  let count=0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new ParcelError("Invalid provider polygon",502);
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length<4) throw new ParcelError("Invalid provider ring",502);
      for (const point of ring) {
        if (++count>200000 || !Array.isArray(point) || point.length<2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0])>180 || Math.abs(point[1])>90) throw new ParcelError("Invalid provider coordinates",502);
      }
      if (ring[0][0]!==ring[ring.length-1][0] || ring[0][1]!==ring[ring.length-1][1]) throw new ParcelError("Unclosed provider ring",502);
    }
  }
  // Emit only two dimensions, keeping GeoJSON order longitude, latitude.
  const clean=(p:Position)=>[p[0],p[1]];
  return g.type==="Polygon" ? {type:"Polygon",coordinates:g.coordinates.map(r=>r.map(clean))} :
    {type:"MultiPolygon",coordinates:g.coordinates.map(p=>p.map(r=>r.map(clean)))};
}
export async function findParcels(params:URLSearchParams, fetcher:typeof fetch=fetch):Promise<Parcels> {
  const spatial=searchGeometry(params);
  const minAcres=params.has("min_acres")?Number(params.get("min_acres")):0;
  if(params.has("min_acres")&&(!params.has("bbox")||!params.get("min_acres")?.trim()||!Number.isFinite(minAcres)||minAcres<0||minAcres>1000000))
    throw new ParcelError("min_acres requires a bbox and a value from 0 to 1000000");
  // Local-first for SLO; custom providers retain their original adapter/namespace.
  if(process.env.PARCEL_DATA_SOURCE!=="arcgis"&&(!process.env.PARCEL_LAYER_URL||process.env.PARCEL_LAYER_URL===DEFAULT_PARCEL_LAYER)){
    const {findBundledParcels,bundledCoverageContains}=await import("./bundledParcels");
    let local:Parcels;
    try{local=await findBundledParcels(spatial,minAcres);}catch(error){
      if(process.env.PARCEL_DATA_SOURCE==="bundled")throw error;
      return findRemoteParcels(spatial,minAcres,fetcher);
    }
    if(process.env.PARCEL_DATA_SOURCE==="bundled"||local.metadata.truncated||(local.features.length>0&&bundledCoverageContains(spatial)))return local;
    try{
      const remote=await findRemoteParcels(spatial,minAcres,fetcher);
      if(!local.features.length)return remote;
      const byId=new Map(local.features.map(f=>[f.properties.parcelId,f]));
      for(const f of remote.features)if(!byId.has(f.properties.parcelId))byId.set(f.properties.parcelId,f);
      const combined=[...byId.values()].sort((a,b)=>a.properties.parcelId.localeCompare(b.properties.parcelId));
      return {...local,features:combined.slice(0,MAX_PARCELS),metadata:{...local.metadata,truncated:remote.metadata.truncated||combined.length>MAX_PARCELS,
        dataSource:"bundled-geojson+arcgis",note:local.metadata.note+" County service queried for uncovered area; matching APNs deduplicated."}};
    }catch(error){
      if(!local.features.length)throw error;
      return {...local,metadata:{...local.metadata,truncated:true,note:local.metadata.note+" County fallback unavailable; only local matches returned, coverage incomplete."}};
    }
  }
  return findRemoteParcels(spatial,minAcres,fetcher);
}
async function findRemoteParcels(spatial:ReturnType<typeof searchGeometry>,minAcres:number,fetcher:typeof fetch):Promise<Parcels>{
  const source=process.env.PARCEL_LAYER_URL || DEFAULT_PARCEL_LAYER;
  const url=new URL(source);
  if (url.protocol!=="https:" || !/\/(MapServer|FeatureServer)\/\d+\/?$/.test(url.pathname) || url.search || url.username || url.password) throw new ParcelError("Invalid configured parcel layer",503);
  const apn=process.env.PARCEL_ID_FIELD || "apn";
  const oid=process.env.PARCEL_OBJECT_ID_FIELD || "OBJECTID";
  if (![apn,oid].every(v=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))) throw new ParcelError("Invalid configured parcel field",503);
  // The county layer stores geometry area in square feet. Filter there before
  // downloading vertices; never compute polygon area to decide what to fetch.
  const areaField=process.env.PARCEL_AREA_FIELD||"Shape.STArea()";
  if(minAcres&&!/^(?:[A-Za-z_][A-Za-z0-9_]*|Shape\.STArea\(\))$/.test(areaField))throw new ParcelError("Invalid configured parcel area field",503);
  const where=minAcres?`${areaField} >= ${minAcres*43560}`:"1=1";
  url.pathname=url.pathname.replace(/\/$/,"")+"/query";
  url.search=new URLSearchParams({...spatial,f:"geojson",where,inSR:"4326",outSR:"4326",
    spatialRel:"esriSpatialRelIntersects",outFields:`${oid},${apn}`,returnGeometry:"true",
    orderByFields:oid,resultRecordCount:String(MAX_PARCELS+1),returnZ:"false",returnM:"false"}).toString();
  const response=await fetcher(url,{cache:"no-store",signal:AbortSignal.timeout(15000),redirect:"error"});
  if (!response.ok || !response.body) throw new ParcelError("Parcel provider is unavailable",502);
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  for (;;) {
    const {done,value}=await reader.read(); if (done) break;
    size+=value.byteLength;
    if (size>8*1024*1024) { await reader.cancel(); throw new ParcelError("Parcel response too large; narrow the area",502); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){ bytes.set(chunk,offset); offset+=chunk.length; }
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if (data.error || data.type!=="FeatureCollection" || !Array.isArray(data.features)) throw new ParcelError("Parcel provider did not return queryable GeoJSON",502);
  const fetchedAt=new Date().toISOString();
  return {type:"FeatureCollection",features:data.features.slice(0,MAX_PARCELS).map((f:{geometry:unknown;properties:Record<string,unknown>;id?:string|number})=>({
    type:"Feature",geometry:normalizeParcelGeometry(f.geometry),properties:{parcelId:String(f.properties?.[apn] ?? f.properties?.[oid] ?? f.id ?? "Unknown"),source,fetchedAt},
  })),metadata:{source,truncated:data.features.length>MAX_PARCELS || data.exceededTransferLimit===true || data.properties?.exceededTransferLimit===true,
    limit:MAX_PARCELS,fetchedAt,dataSource:"arcgis",note:"GIS parcel outlines for planning; not surveyed boundaries. No fire-risk score is inferred."}};
}
