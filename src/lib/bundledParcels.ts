/** Server-only parcel snapshot and process-local spatial index. */
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {area} from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import {point} from "@turf/helpers";
import type {Feature,Polygon,MultiPolygon,Position} from "geojson";
import {DEFAULT_PARCEL_LAYER,ParcelError,normalizeParcelGeometry,type Parcels,type searchGeometry} from "./parcels";
import {MAX_PARCELS} from "./parcelDisplayConfig";
import manifest from "@/data/parcels/manifest.json";

type Bounds=[number,number,number,number];
export type SnapshotParcel=Feature<Polygon|MultiPolygon,{parcelId:string}>;
type Indexed={feature:SnapshotParcel;bounds:Bounds;acres:number};
const STEP=.01;
const overlaps=(a:Bounds,b:Bounds)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
function positions(g:Polygon|MultiPolygon){return g.type==="Polygon"?g.coordinates.flat():g.coordinates.flat(2);}
function bounds(g:Polygon|MultiPolygon):Bounds{return positions(g).reduce<Bounds>((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);}
function segmentHits(a:Position,b:Position,box:Bounds){
  let lo=0,hi=1;
  for(let axis=0;axis<2;axis++){
    const delta=b[axis]-a[axis];
    if(delta===0){if(a[axis]<box[axis]||a[axis]>box[axis+2])return false;continue;}
    const t1=(box[axis]-a[axis])/delta,t2=(box[axis+2]-a[axis])/delta;
    lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;
  }
  return true;
}
function intersects(feature:SnapshotParcel,box:Bounds){
  const polygons=feature.geometry.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry.coordinates;
  for(const polygon of polygons)for(const ring of polygon)for(let i=1;i<ring.length;i++)if(segmentHits(ring[i-1],ring[i],box))return true;
  return [[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]].some(p=>booleanPointInPolygon(point(p),feature));
}
export class ParcelSpatialIndex {
  private buckets=new Map<string,number[]>();
  private entries:Indexed[]=[];
  readonly extent:Bounds=[Infinity,Infinity,-Infinity,-Infinity];
  constructor(features:SnapshotParcel[]){
    const ids=new Set<string>();
    for(const raw of features){
      const id=raw.properties?.parcelId;
      if(typeof id!=="string"||!id.trim()||id.length>128||ids.has(id))throw new Error("Snapshot APNs must be nonempty and unique");ids.add(id);
      const feature:SnapshotParcel={type:"Feature",geometry:normalizeParcelGeometry(raw.geometry),properties:{parcelId:id}},b=bounds(feature.geometry),acres=area(feature)/4046.8564224;
      if(!Number.isFinite(acres)||acres<=0)throw new Error("Snapshot parcel has invalid area");
      const index=this.entries.length;this.entries.push({feature,bounds:b,acres});
      this.extent[0]=Math.min(this.extent[0],b[0]);this.extent[1]=Math.min(this.extent[1],b[1]);this.extent[2]=Math.max(this.extent[2],b[2]);this.extent[3]=Math.max(this.extent[3],b[3]);
      // Reject accidental whole-world/projected inputs before expanding buckets.
      if((Math.floor(b[2]/STEP)-Math.floor(b[0]/STEP)+1)*(Math.floor(b[3]/STEP)-Math.floor(b[1]/STEP)+1)>10000)throw new Error("Snapshot parcel exceeds spatial index bounds");
      for(let x=Math.floor(b[0]/STEP);x<=Math.floor(b[2]/STEP);x++)for(let y=Math.floor(b[1]/STEP);y<=Math.floor(b[3]/STEP);y++){
        const key=x+","+y,bucket=this.buckets.get(key)??[];bucket.push(index);this.buckets.set(key,bucket);
      }
    }
  }
  query(box:Bounds,minAcres=0,exactPoint?:Position){
    if(!overlaps(this.extent,box))return {features:[],truncated:false};
    const b:Bounds=[Math.max(box[0],this.extent[0]),Math.max(box[1],this.extent[1]),Math.min(box[2],this.extent[2]),Math.min(box[3],this.extent[3])],candidates=new Set<number>();
    for(let x=Math.floor(b[0]/STEP);x<=Math.floor(b[2]/STEP);x++)for(let y=Math.floor(b[1]/STEP);y<=Math.floor(b[3]/STEP);y++)for(const i of this.buckets.get(x+","+y)??[])candidates.add(i);
    const sorted=[...candidates].map(i=>this.entries[i]).filter(e=>e.acres>=minAcres&&overlaps(e.bounds,box)).sort((a,b)=>a.feature.properties.parcelId.localeCompare(b.feature.properties.parcelId));
    const features:SnapshotParcel[]=[];
    for(const item of sorted){
      if(exactPoint?booleanPointInPolygon(point(exactPoint),item.feature):intersects(item.feature,box))features.push(item.feature);
      if(features.length>MAX_PARCELS)break;
    }
    return {features:features.slice(0,MAX_PARCELS),truncated:features.length>MAX_PARCELS};
  }
}
let cached:Promise<ParcelSpatialIndex>|undefined;
export function bundledCoverageContains(spatial:ReturnType<typeof searchGeometry>){
  const g=JSON.parse(spatial.geometry),b=manifest.bounds;
  return spatial.geometryType==="esriGeometryPoint"?g.x>=b[0]&&g.x<=b[2]&&g.y>=b[1]&&g.y<=b[3]:g.xmin>=b[0]&&g.xmax<=b[2]&&g.ymin>=b[1]&&g.ymax<=b[3];
}
function load(){
  if(!cached)cached=(async()=>{
    const bytes=await readFile(join(process.cwd(),"src/data/parcels/slo-parcels.geojson.gz"));
    if(bytes.length!==manifest.compressed_bytes||createHash("sha256").update(bytes).digest("hex")!==manifest.compressed_sha256)throw new Error("Parcel snapshot checksum mismatch");
    const data=JSON.parse(gunzipSync(bytes,{maxOutputLength:64*1024*1024}).toString("utf8"));
    if(data.type!=="FeatureCollection"||!Array.isArray(data.features)||data.features.length!==manifest.parcel_count)throw new Error("Invalid parcel snapshot");
    return new ParcelSpatialIndex(data.features);
  })().catch(error=>{cached=undefined;throw error;});
  return cached;
}
export async function findBundledParcels(spatial:ReturnType<typeof searchGeometry>,minAcres=0):Promise<Parcels>{
  let index:ParcelSpatialIndex;
  try{index=await load();}catch{throw new ParcelError("Bundled parcel data unavailable; check deployment assets",503);}
  const g=JSON.parse(spatial.geometry),exact=spatial.geometryType==="esriGeometryPoint"?[g.x,g.y]:undefined;
  const box:Bounds=exact?[g.x,g.y,g.x,g.y]:[g.xmin,g.ymin,g.xmax,g.ymax];
  const result=index.query(box,minAcres,exact),fetchedAt=new Date().toISOString();
  return {type:"FeatureCollection",features:result.features.map(f=>({type:"Feature",geometry:f.geometry,
    properties:{parcelId:f.properties.parcelId,source:DEFAULT_PARCEL_LAYER,fetchedAt}})),metadata:{source:DEFAULT_PARCEL_LAYER,truncated:result.truncated,limit:MAX_PARCELS,fetchedAt,dataSource:"bundled-geojson",
    note:`Bundled SLO parcel export (${manifest.parcel_count} APNs, imported ${manifest.imported_at}). Coverage is the supplied SLO-area export, not the entire county. County identifier namespace retained for saved scans. GIS outlines are not surveyed boundaries.`}};
}
