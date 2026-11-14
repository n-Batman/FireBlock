import {describe,it,expect} from "vitest";
import {mergeRiskGrids,riskBounds} from "./riskMosaic";
import {parseRiskGrid,projectGridToParcels,type RiskGrid} from "./parcelRisk";
import {publishedRiskGrid} from "./publishedRiskGrid";
import type {Parcels} from "./parcels";
const polygon=(w:number,e:number)=>({type:"Polygon" as const,coordinates:[[[w,0],[e,0],[e,1],[w,1],[w,0]]]});
function grid(w:number,e:number,score:number|null,stamp="2026-11-14T12:00:00Z"):RiskGrid{
  return {type:"FeatureCollection",features:[{type:"Feature",geometry:polygon(w,e),properties:{cell_id:"0",layer:"relative_risk",model_id:"math-v1",as_of:stamp,risk_score:score}}]};
}
describe("location-based risk mosaic",()=>{
  it("retains older edges around a newer overlapping cell without double-counting",()=>{
    const mosaic=mergeRiskGrids([{id:"old",grid:grid(0,3,20,"2026-11-13T12:00:00Z")},{id:"new",grid:grid(1,2,80)}]);
    expect(parseRiskGrid(mosaic).features).toHaveLength(3);
    const parcels:Parcels={type:"FeatureCollection",features:[{type:"Feature",geometry:polygon(0,3),properties:{parcelId:"p",source:"test",fetchedAt:"now"}}],metadata:{source:"test",truncated:false,limit:200,fetchedAt:"now",note:"test"}};
    const result=projectGridToParcels(parcels,mosaic).features[0].properties;
    expect(result.coverage).toBeCloseTo(1);expect(result.risk_score).toBeCloseTo(40);
    expect(result.as_of).toBe("multiple-observation-times");
  });
  it("fills newer unknown coverage from older known data and filters by location",()=>{
    const runs=[{id:"new",grid:grid(0,1,null)},{id:"old",grid:grid(0,1,60,"2026-11-13T12:00:00Z")},{id:"remote",grid:grid(10,11,90)}];
    const result=mergeRiskGrids(runs,[0,0,2,1]);
    expect(result.features).toHaveLength(1);expect(result.features[0].properties.risk_score).toBe(60);
    expect(mergeRiskGrids(runs,[20,0,21,1]).features).toHaveLength(0);
  });
  it("namespaces duplicate cell IDs across runs and resolves ties deterministically",()=>{
    const a={id:"a",grid:grid(0,1,10)},b={id:"b",grid:grid(0,1,90)},c={id:"c",grid:grid(1,2,30)};
    expect(mergeRiskGrids([a,b,c])).toEqual(mergeRiskGrids([c,b,a]));
    expect(parseRiskGrid(mergeRiskGrids([a,b,c])).features).toHaveLength(2);
    expect(()=>riskBounds([2,0,1,1])).toThrow();
  });
  it("serves Madonna together with SLO and preserves separate Silver River coverage",async()=>{
    const slo=await publishedRiskGrid([-120.72,35.24,-120.61,35.31]);
    expect(slo.features).toHaveLength(1536);
    expect(slo.publication.runs).toHaveLength(2);
    expect(parseRiskGrid(slo).features.filter(f=>f.properties.risk_score!==null)).toHaveLength(1526);
    const silver=await publishedRiskGrid([-120.72,35.71,-120.62,35.78]);
    expect(silver.features).toHaveLength(1476);
    expect((await publishedRiskGrid([0,0,1,1])).features).toHaveLength(0);
  });
});
