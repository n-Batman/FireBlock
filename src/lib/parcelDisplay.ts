import {intersection,union} from "polyclip-ts";
import type {ParcelUnit,PolygonRings} from "@/data/types";
import type {View} from "./parcelApi";
import {PARCEL_SCREEN_THRESHOLD} from "./parcelDisplayConfig";
export {PARCEL_SCREEN_THRESHOLD} from "./parcelDisplayConfig";

// Retained for legacy risk overview helpers; parcel loading/rendering has no zoom cutoff.
export const INDIVIDUAL_PARCEL_ZOOM=17;
const R=6378137;
type XY=[number,number];
const project=([lat,lon]:number[]):XY=>[R*lon*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360))];
const unproject=([x,y]:number[]):XY=>[(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI,x/R*180/Math.PI];
const ringArea=(ring:number[][])=>{
  if(ring.length<3)return 0;
  // Translate to a local origin to avoid cancellation at Mercator magnitudes.
  const [x,y]=ring[0];
  let twiceArea=0;
  for(let i=0;i<ring.length;i++){
    const p=ring[i],q=ring[(i+1)%ring.length];
    twiceArea+=(p[0]-x)*(q[1]-y)-(q[0]-x)*(p[1]-y);
  }
  return Math.abs(twiceArea)/2;
};

export interface ParcelAreaSummary {
  id:string;
  parts:PolygonRings[];
  count:number;
  scoredCount:number;
  score:number|null;
  coverage:number;
}

/** Per-map, bounded LRU of merged geometry, independent of camera and scores. */
export class ParcelOutlineCache {
  private entries=new Map<string,{parts:PolygonRings[];bytes:number}>();
  private bytes=0;
  constructor(private maxEntries=128,private maxBytes=8*1024*1024){}

  outline(members:ParcelUnit[]):PolygonRings[] {
    // Include coordinates so refreshed data with the same IDs cannot reuse stale outlines.
    const key=JSON.stringify(members.map(p=>[p.id,p.parts]));
    const cached=this.entries.get(key);
    if(cached){
      this.entries.delete(key);this.entries.set(key,cached);
      return cached.parts;
    }
    const shapes=members.map(p=>p.parts.map(part=>part.map(ring=>ring.map(project))));
    const parts=union(shapes[0],...shapes.slice(1)).map(part=>part.map(ring=>ring.map(unproject)));
    const bytes=2*(key.length+JSON.stringify(parts).length);
    if(parts.length&&this.maxEntries>0&&bytes<=this.maxBytes){
      while(this.entries.size&&(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes)){
        const oldest=this.entries.keys().next().value!;
        this.bytes-=this.entries.get(oldest)!.bytes;this.entries.delete(oldest);
      }
      this.entries.set(key,{parts,bytes});this.bytes+=bytes;
    }
    return parts;
  }
}

/** Fraction of the visible map occupied by actual parcel geometry in screen
 * (Web Mercator) space. Use shoelace area minus holes directly for contained
 * parcels; only clip geometry whose bounding box crosses the camera edge.
 */
export function parcelScreenFraction(parcel:ParcelUnit,view:View):number {
  const [w,s]=project([view.south,view.west]),[e,n]=project([view.north,view.east]);
  const total=(e-w)*(n-s);
  if(!Number.isFinite(total)||total<=0)return 1;
  try{
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const shape=parcel.parts.map(part=>part.map(ring=>ring.map(point=>{
      const p=project(point);
      if(!p.every(Number.isFinite))throw new Error("Invalid parcel coordinate");
      minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);
      minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);
      return p;
    })));
    if(maxX<=w||minX>=e||maxY<=s||minY>=n)return 0;
    const contained=minX>=w&&maxX<=e&&minY>=s&&maxY<=n;
    const visibleShape=contained?shape:intersection(shape,[[[w,s],[e,s],[e,n],[w,n],[w,s]]]);
    const visible=visibleShape.reduce((sum,part)=>sum+ringArea(part[0])-part.slice(1).reduce((holes,ring)=>holes+ringArea(ring),0),0);
    return Math.max(0,Math.min(1,visible/total));
  }catch{return 1;} // A geometry failure must keep the original boundary visible.
}

/** Group only parcels occupying <5% of the screen. Union member outlines;
 * never invent a rectangular boundary, fill roads/holes, or mutate source units.
 */
export function parcelDisplay(parcels:ParcelUnit[],view:View,selectedId:string|null=null,outlineCache=new ParcelOutlineCache()):{individuals:ParcelUnit[];areas:ParcelAreaSummary[]} {
  const [w,s]=project([view.south,view.west]),[e,n]=project([view.north,view.east]);
  if(!Number.isFinite((e-w)*(n-s))||e<=w||n<=s)return {individuals:parcels,areas:[]};
  const individuals:ParcelUnit[]=[],buckets=new Map<string,ParcelUnit[]>();
  // Screen-sized neighborhoods bound the cost and extent of each merged shape.
  const width=(e-w)*Math.sqrt(PARCEL_SCREEN_THRESHOLD),height=(n-s)*Math.sqrt(PARCEL_SCREEN_THRESHOLD);
  const lastBucket=Math.ceil(1/Math.sqrt(PARCEL_SCREEN_THRESHOLD))-1;
  for(const parcel of parcels){
    if(parcel.id===selectedId||parcelScreenFraction(parcel,view)+1e-9>=PARCEL_SCREEN_THRESHOLD){individuals.push(parcel);continue;}
    const [x,y]=project(parcel.center);
    const key=`${Math.max(0,Math.min(lastBucket,Math.floor((x-w)/width)))}:${Math.max(0,Math.min(lastBucket,Math.floor((y-s)/height)))}`;
    const members=buckets.get(key)??[];members.push(parcel);buckets.set(key,members);
  }
  const areas:ParcelAreaSummary[]=[];
  for(const [,members] of [...buckets].sort(([a],[b])=>a.localeCompare(b))){
    if(members.length<2){individuals.push(...members);continue;}
    members.sort((a,b)=>a.id.localeCompare(b.id));
    try{
      const parts=outlineCache.outline(members);
      if(!parts.length){individuals.push(...members);continue;}
      let total=0,known=0,weighted=0,scoredCount=0;
      for(const p of members){
        const a=Number.isFinite(p.acres)?Math.max(0,p.acres):0;total+=a;
        if(p.score&&Number.isFinite(p.score.score)&&p.score.score>=0&&p.score.score<=100){known+=a;weighted+=a*p.score.score;scoredCount++;}
      }
      const coverage=total>0?known/total:0;
      areas.push({id:JSON.stringify(members.map(p=>p.id)),parts,count:members.length,scoredCount,coverage,score:coverage>=.6&&known>0?weighted/known:null});
    }catch{individuals.push(...members);}
  }
  return {individuals,areas};
}
