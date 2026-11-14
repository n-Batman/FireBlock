import { intersect } from "@turf/intersect";
import { area } from "@turf/area";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { Parcels, ParcelProperties } from "./parcels";

export type GridCell = Feature<Polygon,{cell_id:string;risk_score:number|null;model_id:string;as_of:string;layer:"relative_risk";source_run_id?:string}>;
export type RiskGrid = FeatureCollection<Polygon,GridCell["properties"]>;
export type ParcelRisk = ParcelProperties & {risk_score:number|null;observed_mean:number|null;peak_score:number|null;
  coverage:number;status:"estimated"|"insufficient_coverage"|"unknown";cells:number;model_id:string;as_of:string;source_model_ids:string[];source_as_of:string[];aggregation:"intersection-area-weighted-v1"};
type Bounds=[number,number,number,number];
function bounds(cell:GridCell):Bounds {
  const points=cell.geometry.coordinates[0];
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
function overlap(a:Bounds,b:Bounds) { return Math.min(a[2],b[2])>Math.max(a[0],b[0])+1e-12 && Math.min(a[3],b[3])>Math.max(a[1],b[1])+1e-12; }
/** Accept the current backend's non-overlapping, rectangular WGS84 risk cells. */
export function parseRiskGrid(input:unknown):RiskGrid {
  const data=input as RiskGrid;
  if (!data || data.type!=="FeatureCollection" || !Array.isArray(data.features)) throw new Error("Choose the backend risk_map.geojson FeatureCollection");
  const cells=data.features.filter(f=>f?.properties?.layer==="relative_risk");
  if ((!cells.length&&data.features.length>0) || cells.length>10000) throw new Error("Select a regional grid with at most 10000 risk cells");
  const ids=new Set<string>();
  const indexed=cells.map(cell=>{
    const p=cell.properties, rings=cell.geometry?.coordinates;
    if(cell.geometry?.type!=="Polygon" || !Array.isArray(rings) || rings.length!==1 || rings[0].length!==5 ||
      rings[0].some(v=>!Array.isArray(v)||v.length<2||!Number.isFinite(v[0])||!Number.isFinite(v[1])||Math.abs(v[0])>180||Math.abs(v[1])>85))throw new Error("Grid cells must be rectangular WGS84 polygons");
    const b=bounds(cell),ring=rings[0];
    const corners=new Set(ring.slice(0,4).map(v=>`${v[0]},${v[1]}`));
    if(b[0]>=b[2]||b[1]>=b[3]||b[2]-b[0]>5||b[3]-b[1]>5||corners.size!==4 || ring[0][0]!==ring[4][0] || ring[0][1]!==ring[4][1] ||
      ring.some(v=>![b[0],b[2]].includes(v[0])||![b[1],b[3]].includes(v[1])) ||
      ring.slice(1).some((v,i)=>v[0]!==ring[i][0]&&v[1]!==ring[i][1]))throw new Error("Invalid rectangular grid cell");
    if(typeof p.cell_id!=="string"||!p.cell_id||ids.has(p.cell_id))throw new Error("Risk cells require unique IDs"); ids.add(p.cell_id);
    if(p.risk_score!==null&&(typeof p.risk_score!=="number"||!Number.isFinite(p.risk_score)||p.risk_score<0||p.risk_score>100))throw new Error("Risk scores must be null or 0–100");
    if(typeof p.model_id!=="string"||!p.model_id||typeof p.as_of!=="string"||!Number.isFinite(Date.parse(p.as_of))||!/(Z|[+-]\d\d:\d\d)$/.test(p.as_of))throw new Error("Grid needs model and timezone-aware issue time");
    return {cell,b};
  }).sort((a,b)=>a.b[0]-b.b[0]);
  let active:typeof indexed=[];
  for(const item of indexed){active=active.filter(v=>v.b[2]>item.b[0]+1e-12);if(active.some(v=>overlap(v.b,item.b)))throw new Error("Overlapping risk cells would double-count area");active.push(item);}
  return {type:"FeatureCollection",features:cells};
}
/** Derive a display layer; the original backend cells and parcel geometries stay unchanged. */
export function projectGridToParcels(parcels:Parcels,grid:RiskGrid,minCoverage=.6):FeatureCollection<Parcels["features"][number]["geometry"],ParcelRisk> {
  if(!Number.isFinite(minCoverage)||minCoverage<=0||minCoverage>1)throw new Error("Coverage threshold must be greater than 0 and at most 1");
  const validated=parseRiskGrid(grid);
  if(parcels.features.length>200)throw new Error("Project at most 200 parcels at once");
  const cells=validated.features.map(cell=>({cell,b:bounds(cell)}));
  return {type:"FeatureCollection",features:parcels.features.map(parcel=>{
    const coordinates=parcel.geometry.type==="Polygon"?parcel.geometry.coordinates.flat():parcel.geometry.coordinates.flat(2);
    const b=coordinates.reduce<Bounds>((v,p)=>[Math.min(v[0],p[0]),Math.min(v[1],p[1]),Math.max(v[2],p[0]),Math.max(v[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
    const total=area(parcel);if(!Number.isFinite(total)||total<=0)throw new Error("Parcel must have positive area");
    let known=0,weighted=0,peak:number|null=null,count=0;
    const models=new Set<string>(),times=new Set<string>();
    for(const {cell,b:cellBounds} of cells){
      if(cell.properties.risk_score===null||!overlap(b,cellBounds))continue;
      const clipped=intersect({type:"FeatureCollection",features:[parcel,cell]});
      if(!clipped)continue; const covered=area(clipped); if(covered<=0)continue;
      known+=covered;weighted+=covered*cell.properties.risk_score;peak=Math.max(peak??0,cell.properties.risk_score);count++;
      models.add(cell.properties.model_id);times.add(cell.properties.as_of);
    }
    const coverage=Math.min(1,known/total),mean=known>0?weighted/known:null;
    const sufficient=coverage+1e-9>=minCoverage;
    return {...parcel,properties:{...parcel.properties,risk_score:sufficient?mean:null,observed_mean:mean,peak_score:peak,
      coverage,status:known===0?"unknown":sufficient?"estimated":"insufficient_coverage",cells:count,
      model_id:models.size===1?[...models][0]:models.size?"multiple-models":"unknown",as_of:times.size===1?[...times][0]:"multiple-observation-times",source_model_ids:[...models],source_as_of:[...times].sort(),aggregation:"intersection-area-weighted-v1"}};
  })};
}
