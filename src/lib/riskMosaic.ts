import {parseRiskGrid,type RiskGrid,type GridCell} from "./parcelRisk";

export type RiskBounds=[number,number,number,number];
export type RiskPublication={id:string;grid:RiskGrid};
export class RiskLimitError extends Error {}
export const intersects=(a:RiskBounds,b:RiskBounds)=>a[0]<b[2]-1e-12&&a[2]>b[0]+1e-12&&a[1]<b[3]-1e-12&&a[3]>b[1]+1e-12;
export function cellBounds(cell:GridCell):RiskBounds {
  const ring=cell.geometry.coordinates[0];
  return [Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
}
export function riskBounds(value:unknown):RiskBounds {
  if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite)||value[0]>=value[2]||value[1]>=value[3]||value[0]<-180||value[2]>180||value[1]<-85||value[3]>85)throw new Error("Invalid risk bounding box");
  return value as RiskBounds;
}
function subtract(a:RiskBounds,b:RiskBounds):RiskBounds[]{
  if(!intersects(a,b))return [a];
  const w=Math.max(a[0],b[0]),e=Math.min(a[2],b[2]),s=Math.max(a[1],b[1]),n=Math.min(a[3],b[3]);
  return [[a[0],a[1],w,a[3]],[e,a[1],a[2],a[3]],[w,a[1],e,s],[w,n,e,a[3]]].filter(r=>r[2]-r[0]>1e-12&&r[3]-r[1]>1e-12) as RiskBounds[];
}
/** Newest known observations win. Older coverage fills gaps, including newer nodata.
 * Subtract rectangular intersections so parcel weighting never counts area twice.
 * Cell scores, model IDs and observation times remain unchanged.
 */
export function mergeRiskGrids(publications:RiskPublication[],bbox?:RiskBounds):RiskGrid {
  const cells=publications.flatMap(({id,grid})=>parseRiskGrid(grid).features.map(cell=>({id,cell,b:cellBounds(cell)})))
    .filter(item=>!bbox||intersects(item.b,bbox))
    .sort((a,b)=>Number(a.cell.properties.risk_score===null)-Number(b.cell.properties.risk_score===null)||Date.parse(b.cell.properties.as_of)-Date.parse(a.cell.properties.as_of)||a.id.localeCompare(b.id)||a.cell.properties.cell_id.localeCompare(b.cell.properties.cell_id));
  if(cells.length>30000)throw new RiskLimitError("Too many source cells; zoom into a smaller area");
  const accepted:{b:RiskBounds;cell:GridCell}[]=[];
  let operations=0;
  for(const item of cells){
    let parts=[item.b];
    for(const previous of accepted){
      if(!intersects(item.b,previous.b))continue;
      operations+=parts.length;
      if(operations>1000000)throw new RiskLimitError("Too many grid intersections; zoom into a smaller area");
      parts=parts.flatMap(part=>subtract(part,previous.b));
      if(!parts.length)break;
    }
    for(const [i,b] of parts.entries()){
      const [w,s,e,n]=b;
      accepted.push({b,cell:{...item.cell,geometry:{type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]},properties:{...item.cell.properties,cell_id:`${item.id}:${item.cell.properties.cell_id}:${i}`,source_run_id:item.id} as GridCell["properties"]}});
      if(accepted.length>10000)throw new RiskLimitError("Too many visible cells; zoom into a smaller area");
    }
  }
  return {type:"FeatureCollection",features:accepted.map(item=>item.cell)};
}
