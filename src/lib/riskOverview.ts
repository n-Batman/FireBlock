import type { FeatureCollection, Polygon } from "geojson";
import type { RiskGrid } from "./parcelRisk";
import type { View } from "./parcelApi";
import { INDIVIDUAL_PARCEL_ZOOM } from "./parcelDisplay";

const R=6378137, radians=Math.PI/180;
const x=(lon:number)=>R*lon*radians;
const y=(lat:number)=>R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*radians/2));
const lon=(v:number)=>v/R/radians;
const lat=(v:number)=>(2*Math.atan(Math.exp(v/R))-Math.PI/2)/radians;
const area=(w:number,s:number,e:number,n:number)=>R*R*(e-w)*radians*(Math.sin(n*radians)-Math.sin(s*radians));
export type OverviewGrid=FeatureCollection<Polygon,{id:string;risk_score:number|null;coverage:number;cells:number}>;

/** Overview tiles use saved model cells, never county parcel geometry or house scores.
 * Split rectangular cells at tile edges so area weights and missing coverage stay honest.
 */
export function riskOverview(grid:RiskGrid,zoom:number,view:View):OverviewGrid {
  const empty:OverviewGrid={type:"FeatureCollection",features:[]};
  if(!Number.isFinite(zoom)||zoom>=INDIVIDUAL_PARCEL_ZOOM)return empty;
  let size=512*2**(16-Math.max(0,Math.floor(zoom)));
  for(let attempt=0;attempt<12;attempt++,size*=2){
    const buckets=new Map<string,{i:number;j:number;known:number;weighted:number;cells:number}>();
    for(const cell of grid.features){
      const ring=cell.geometry.coordinates[0];
      const w=Math.min(...ring.map(p=>p[0])),e=Math.max(...ring.map(p=>p[0]));
      const s=Math.min(...ring.map(p=>p[1])),n=Math.max(...ring.map(p=>p[1]));
      // Include the whole summary tiles intersecting the camera, avoiding pan-dependent scores.
      for(let i=Math.max(Math.floor(x(w)/size),Math.floor(x(view.west)/size));i<Math.min(Math.ceil(x(e)/size),Math.ceil(x(view.east)/size));i++){
        const tw=lon(i*size),te=lon((i+1)*size);
        if(te<=view.west||tw>=view.east)continue;
        for(let j=Math.max(Math.floor(y(s)/size),Math.floor(y(view.south)/size));j<Math.min(Math.ceil(y(n)/size),Math.ceil(y(view.north)/size));j++){
          const ts=lat(j*size),tn=lat((j+1)*size);
          if(tn<=view.south||ts>=view.north)continue;
          const a=area(Math.max(w,tw),Math.max(s,ts),Math.min(e,te),Math.min(n,tn));
          if(a<=0)continue;
          const id=`${size}:${i}:${j}`,b=buckets.get(id)??{i,j,known:0,weighted:0,cells:0};
          b.cells++;
          if(cell.properties.risk_score!==null){b.known+=a;b.weighted+=a*cell.properties.risk_score;}
          buckets.set(id,b);
        }
      }
    }
    if(buckets.size>256)continue;
    return {type:"FeatureCollection",features:[...buckets].map(([id,b])=>{
      const w=lon(b.i*size),e=lon((b.i+1)*size),s=lat(b.j*size),n=lat((b.j+1)*size);
      const coverage=Math.min(1,b.known/area(w,s,e,n));
      return {type:"Feature",geometry:{type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]},
        properties:{id,risk_score:coverage>=.6&&b.known>0?b.weighted/b.known:null,coverage,cells:b.cells}};
    })};
  }
  return empty;
}
