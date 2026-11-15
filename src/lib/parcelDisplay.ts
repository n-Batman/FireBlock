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
const ringArea=(ring:number[][])=>Math.abs(ring.slice(1).reduce((sum,p,i)=>sum+ring[i][0]*p[1]-p[0]*ring[i][1],0))/2;

export interface ParcelAreaSummary {
  id:string;
  parts:PolygonRings[];
  count:number;
  scoredCount:number;
  score:number|null;
  coverage:number;
}

/** Fraction of the visible map occupied by actual parcel geometry in screen
 * (Web Mercator) space. Clip to the camera and subtract holes, not bounding boxes.
 */
export function parcelScreenFraction(parcel:ParcelUnit,view:View):number {
  const [w,s]=project([view.south,view.west]),[e,n]=project([view.north,view.east]);
  const total=(e-w)*(n-s);
  if(!Number.isFinite(total)||total<=0)return 1;
  try{
    const shape=parcel.parts.map(part=>part.map(ring=>ring.map(project)));
    const clipped=intersection(shape,[[[w,s],[e,s],[e,n],[w,n],[w,s]]]);
    const visible=clipped.reduce((sum,part)=>sum+ringArea(part[0])-part.slice(1).reduce((holes,ring)=>holes+ringArea(ring),0),0);
    return Math.max(0,Math.min(1,visible/total));
  }catch{return 1;} // A geometry failure must keep the original boundary visible.
}

/** Group only parcels occupying <5% of the screen. Union member outlines;
 * never invent a rectangular boundary, fill roads/holes, or mutate source units.
 */
export function parcelDisplay(parcels:ParcelUnit[],view:View,selectedId:string|null=null):{individuals:ParcelUnit[];areas:ParcelAreaSummary[]} {
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
      const shapes=members.map(p=>p.parts.map(part=>part.map(ring=>ring.map(project))));
      const merged=union(shapes[0],...shapes.slice(1));
      if(!merged.length){individuals.push(...members);continue;}
      let total=0,known=0,weighted=0,scoredCount=0;
      for(const p of members){
        const a=Number.isFinite(p.acres)?Math.max(0,p.acres):0;total+=a;
        if(p.score&&Number.isFinite(p.score.score)&&p.score.score>=0&&p.score.score<=100){known+=a;weighted+=a*p.score.score;scoredCount++;}
      }
      const coverage=total>0?known/total:0;
      areas.push({id:JSON.stringify(members.map(p=>p.id)),parts:merged.map(part=>part.map(ring=>ring.map(unproject))),count:members.length,scoredCount,coverage,score:coverage>=.6&&known>0?weighted/known:null});
    }catch{individuals.push(...members);}
  }
  return {individuals,areas};
}
