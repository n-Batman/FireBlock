import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import {point} from "@turf/helpers";
import type {Feature,Polygon,MultiPolygon} from "geojson";
import type {Fetcher} from "./geocode";
import type {Parcels} from "./parcels";

type Box=[number,number,number,number];
type Wire={body:string;status:number};
type Entry={wire:Wire;box:Box|null;complete:boolean;expires:number;bytes:number};
type Flight={controller:AbortController;promise:Promise<Wire>;users:number};
const TTL=5*60_000, MAX_ENTRIES=16, MAX_BYTES=8*1024*1024, MAX_ENTRY_BYTES=2*1024*1024;
const abortError=()=>new DOMException("Parcel request cancelled","AbortError");
const contains=(a:Box,b:Box)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];

function queryBox(query:URLSearchParams):Box|null {
  if([...query.keys()].some(k=>!["bbox","lat","lon","radius"].includes(k)))return null;
  if(query.has("bbox")){
    if(query.has("lat")||query.has("lon")||query.has("radius"))return null;
    const raw=query.get("bbox")!.split(","),values=raw.map(Number);
    if(raw.some(v=>!v.trim())||values.length!==4||!values.every(Number.isFinite))return null;
    const [w,s,e,n]=values;
    return w>=-180&&e<=180&&s>=-85&&n<=85&&w<e&&s<n?values as Box:null;
  }
  if(!query.has("lat")||!query.has("lon"))return null;
  const lat=Number(query.get("lat")),lon=Number(query.get("lon")),radius=Number(query.get("radius")??0);
  if(!query.get("lat")?.trim()||!query.get("lon")?.trim()||![lat,lon,radius].every(Number.isFinite)||Math.abs(lat)>85||Math.abs(lon)>180||radius<0||radius>2000)return null;
  const dy=radius/111195,dx=dy/Math.cos(lat*Math.PI/180);
  return [lon-dx,lat-dy,lon+dx,lat+dy];
}

/** Exact rectangle contact test; preserve holes and multipart boundaries. */
function intersectsBox(feature:Feature<Polygon|MultiPolygon>,box:Box):boolean {
  const [w,s,e,n]=box;
  if(w===e&&s===n)return booleanPointInPolygon(point([w,s]),feature);
  const inside=(p:number[])=>p[0]>=w&&p[0]<=e&&p[1]>=s&&p[1]<=n;
  const segment=(a:number[],b:number[])=>{
    if(inside(a)||inside(b))return true;
    const dx=b[0]-a[0],dy=b[1]-a[1];
    if(dx)for(const x of [w,e]){const t=(x-a[0])/dx,y=a[1]+t*dy;if(t>=0&&t<=1&&y>=s&&y<=n)return true;}
    if(dy)for(const y of [s,n]){const t=(y-a[1])/dy,x=a[0]+t*dx;if(t>=0&&t<=1&&x>=w&&x<=e)return true;}
    return false;
  };
  const polygons=feature.geometry.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry.coordinates;
  if(polygons.some(poly=>poly.some(ring=>ring.slice(1).some((b,i)=>segment(ring[i],b)))))return true;
  return [[w,s],[e,s],[e,n],[w,n]].some(p=>booleanPointInPolygon(point(p),feature));
}

function boundaryPayload(value:unknown):Parcels|null {
  const p=value as Parcels;
  if(p?.type!=="FeatureCollection"||!Array.isArray(p.features)||p.features.length>200||!p.metadata)return null;
  if(p.features.some(f=>!f?.geometry||!["Polygon","MultiPolygon"].includes(f.geometry.type)||!f.properties))return null;
  // Retain public boundaries only. Scans, addresses and unknown provider fields
  // never enter this cache even if an upstream response adds them later.
  return {type:"FeatureCollection",features:p.features.map(f=>({type:"Feature",geometry:{type:f.geometry.type,coordinates:f.geometry.coordinates} as Polygon|MultiPolygon,
    properties:{parcelId:f.properties.parcelId,source:f.properties.source,fetchedAt:f.properties.fetchedAt}})),
    metadata:{source:p.metadata.source,truncated:p.metadata.truncated===true,limit:p.metadata.limit,
      fetchedAt:p.metadata.fetchedAt,note:p.metadata.note}};
}

/** Browser-session cache: bounded bytes/count/time; independent aborts for shared requests. */
export class ParcelSessionCache {
  private entries=new Map<string,Entry>();
  private flights=new Map<string,Flight>();
  private bytes=0;
  private expiryTimer:ReturnType<typeof setTimeout>|undefined;
  constructor(private fetcher:Fetcher){}
  get stats(){return {entries:this.entries.size,bytes:this.bytes,inFlight:this.flights.size};}
  clear(){
    if(this.expiryTimer!==undefined)clearTimeout(this.expiryTimer);
    this.expiryTimer=undefined;
    this.entries.clear();this.bytes=0;
    for(const flight of this.flights.values())flight.controller.abort();
    this.flights.clear();
  }
  private remove(key:string){const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key);}}
  private prune(){for(const [key,e] of this.entries)if(e.expires<=Date.now())this.remove(key);}
  private scheduleExpiry(){
    if(this.expiryTimer!==undefined)clearTimeout(this.expiryTimer);
    this.expiryTimer=undefined;
    if(this.entries.size){
      const next=Math.min(...[...this.entries.values()].map(e=>e.expires));
      this.expiryTimer=setTimeout(()=>{this.prune();this.scheduleExpiry();},Math.max(1,next-Date.now()));
    }
  }
  private store(key:string,wire:Wire,box:Box|null,payload:Parcels){
    const bytes=new TextEncoder().encode(wire.body).byteLength;
    if(bytes>MAX_ENTRY_BYTES)return;
    this.remove(key);
    this.entries.set(key,{wire,box,complete:!payload.metadata.truncated,bytes,expires:Date.now()+TTL});this.bytes+=bytes;
    while(this.entries.size>MAX_ENTRIES||this.bytes>MAX_BYTES)this.remove(this.entries.keys().next().value!);
    this.scheduleExpiry();
  }
  private cached(key:string,box:Box|null):Wire|undefined {
    this.prune();
    const exact=this.entries.get(key);
    if(exact){this.entries.delete(key);this.entries.set(key,exact);return exact.wire;}
    if(!box)return;
    for(const [stored,e] of this.entries){
      // A capped/truncated response cannot establish coverage of a smaller area.
      if(!e.complete||!e.box||!contains(e.box,box))continue;
      const payload=JSON.parse(e.wire.body) as Parcels;
      payload.features=payload.features.filter(f=>intersectsBox(f,box));
      this.entries.delete(stored);this.entries.set(stored,e);
      return {status:200,body:JSON.stringify(payload)};
    }
  }
  async request(query:URLSearchParams,signal?:AbortSignal):Promise<Response> {
    if(signal?.aborted)throw abortError();
    const sorted=new URLSearchParams(query);sorted.sort();
    const key=sorted.toString(),box=queryBox(sorted),hit=this.cached(key,box);
    const response=(wire:Wire)=>new Response(wire.body,{status:wire.status,headers:{"Content-Type":"application/json","Cache-Control":"private, no-store"}});
    if(hit)return response(hit);
    let flight=this.flights.get(key);
    if(!flight){
      if(this.flights.size>=4)throw new Error("Parcel request limit reached");
      const controller=new AbortController();
      let rejectAbort:(reason:unknown)=>void=()=>{};
      const cancelled=new Promise<never>((_,reject)=>{rejectAbort=reject;});
      const onAbort=()=>rejectAbort(abortError());
      controller.signal.addEventListener("abort",onAbort,{once:true});
      const timeout=setTimeout(()=>controller.abort(),20_000);
      const current:Flight={controller,users:0,promise:Promise.resolve({body:"",status:200})};
      const loading=(async()=>{
        const init={signal:controller.signal,cache:"no-store" as const,credentials:"same-origin" as const};
        const res=await this.fetcher(`/api/parcels?${key}`,init);
        const value=await res.json();
        const payload=res.ok?boundaryPayload(value):null;
        const wire={body:JSON.stringify(payload??value),status:res.status};
        if(payload&&!controller.signal.aborted&&this.flights.get(key)===current)this.store(key,wire,box,payload);
        return wire;
      })();
      current.promise=Promise.race([loading,cancelled]);
      const finish=()=>{
        clearTimeout(timeout);controller.signal.removeEventListener("abort",onAbort);
        if(this.flights.get(key)===current)this.flights.delete(key);
      };
      current.promise.then(finish,finish);
      this.flights.set(key,current);flight=current;
    }
    const shared=flight;
    if(shared.users>=32)throw new Error("Parcel subscriber limit reached");
    shared.users++;
    return new Promise<Response>((resolve,reject)=>{
      let finished=false;
      const release=()=>{
        if(finished)return false;finished=true;
        signal?.removeEventListener("abort",abort);
        if(--shared.users===0&&this.flights.get(key)===shared){this.flights.delete(key);shared.controller.abort();}
        return true;
      };
      const abort=()=>{if(release())reject(abortError());};
      signal?.addEventListener("abort",abort,{once:true});
      shared.promise.then(wire=>{if(release()){try{resolve(response(wire));}catch(error){reject(error);}}},error=>{if(release())reject(error);});
      if(signal?.aborted)abort();
    });
  }
}

let session:ParcelSessionCache|undefined;
let sessionFetcher:Fetcher|undefined;
let watchingPage=false;
export function clearParcelCache(){session?.clear();}
/** Never create a shared server cache or retain custom fetchers in production. */
export function fetchParcelResponse(query:URLSearchParams,{fetcher=fetch,signal}:{fetcher?:Fetcher;signal?:AbortSignal}={}){
  if(typeof window==="undefined"||fetcher!==globalThis.fetch){const init={signal,cache:"no-store" as const};return fetcher(`/api/parcels?${query}`,init);}
  if(!session||sessionFetcher!==fetcher){session?.clear();session=new ParcelSessionCache(fetcher);sessionFetcher=fetcher;}
  if(!watchingPage){window.addEventListener("pagehide",clearParcelCache);watchingPage=true;}
  return session.request(query,signal);
}

/** One nearby envelope; no county-wide crawl or speculative parallel queue. */
export async function preloadNearbyParcels(box:Box,signal:AbortSignal){
  const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  if(connection?.saveData||["slow-2g","2g"].includes(connection?.effectiveType??""))return;
  const [w,s,e,n]=box,area=(e-w)*111.195*Math.cos((s+n)/2*Math.PI/180)*(n-s)*111.195;
  if(!box.every(Number.isFinite)||area<=0||area>4)return;
  const dx=(e-w)*.25,dy=(n-s)*.25;
  try {await fetchParcelResponse(new URLSearchParams({bbox:[w-dx,s-dy,e+dx,n+dy].join(",")}),{signal});}
  catch {/* Speculative failure never replaces visible data or creates an error loop. */}
}
