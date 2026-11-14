import {describe,it,expect} from "vitest";
import {parseRiskGrid,projectGridToParcels,type GridCell,type RiskGrid} from "./parcelRisk";
import type {Parcels} from "./parcels";
import type {Polygon} from "geojson";
function box(w:number,e:number,s=0,n=1):Polygon{return {type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]};}
function cell(id:string,w:number,e:number,score:number|null):GridCell{return {type:"Feature",geometry:box(w,e),properties:{cell_id:id,risk_score:score,model_id:"test-model",as_of:"2026-11-14T12:00:00Z",layer:"relative_risk"}};}
function grid(...features:GridCell[]):RiskGrid{return {type:"FeatureCollection",features};}
function parcels(geometry=box(0,2)):Parcels{return {type:"FeatureCollection",features:[{type:"Feature",geometry,properties:{parcelId:"APN",source:"county",fetchedAt:"now"}}],metadata:{source:"county",truncated:false,limit:200,fetchedAt:"now",note:"test"}};}
describe("backend grid to property display",()=>{
  it("area-weights clipped cells and leaves the input grid unchanged",()=>{
    const input=grid(cell("a",0,1,20),cell("b",1,2,80));const original=JSON.stringify(input);
    const output=projectGridToParcels(parcels(box(0,1.25)),input).features[0];
    expect(output.properties.risk_score).toBeCloseTo(32,4);
    expect(output.properties.coverage).toBeCloseTo(1,4);
    expect(output.properties.peak_score).toBe(80);
    expect(output.properties.cells).toBe(2);
    expect(JSON.stringify(input)).toBe(original);
    expect(output.geometry).toEqual(box(0,1.25));
  });
  it("missing and outside-grid area is unknown, never averaged as zero",()=>{
    const result=projectGridToParcels(parcels(),grid(cell("a",0,1,80),cell("b",1,2,null))).features[0].properties;
    expect(result.coverage).toBeCloseTo(.5);expect(result.risk_score).toBeNull();expect(result.observed_mean).toBeCloseTo(80);
    expect(result.status).toBe("insufficient_coverage");
    const outside=projectGridToParcels(parcels(box(4,5)),grid(cell("a",0,1,80))).features[0].properties;
    expect(outside.coverage).toBe(0);expect(outside.status).toBe("unknown");expect(outside.peak_score).toBeNull();
  });
  it("zero is a valid score and edge-only contact adds no area",()=>{
    const p=projectGridToParcels(parcels(box(0,1)),grid(cell("a",0,1,0),cell("b",1,2,100))).features[0].properties;
    expect(p.risk_score).toBe(0);expect(p.cells).toBe(1);
  });
  it("holes are excluded from both area and risk weighting",()=>{
    const polygon=box(0,2);polygon.coordinates.push(box(.1,.9,.1,.9).coordinates[0]);
    const p=projectGridToParcels(parcels(polygon),grid(cell("a",0,1,0),cell("b",1,2,100))).features[0].properties;
    expect(p.coverage).toBeCloseTo(1,4);expect(p.risk_score!).toBeGreaterThan(70);
  });
  it("rejects overlapping cells and duplicate IDs while preserving mixed issue times",()=>{
    expect(()=>parseRiskGrid(grid(cell("a",0,2,0),cell("b",1,3,100)))).toThrow(/Overlapping/);
    expect(()=>parseRiskGrid(grid(cell("a",0,1,0),cell("a",1,2,100)))).toThrow(/unique/);
    const b=cell("b",1,2,10);b.properties.as_of="2026-11-15T12:00:00Z";
    expect(parseRiskGrid(grid(cell("a",0,1,0),b)).features[1].properties.as_of).toBe(b.properties.as_of);
    const projected=projectGridToParcels(parcels(),grid(cell("a",0,1,0),b));
    expect(projected.features[0].properties.as_of).toBe("multiple-observation-times");
  });
  it("summarizes disconnected plots of a multipart parcel",()=>{
    const input=parcels();input.features[0].geometry={type:"MultiPolygon",coordinates:[box(0,1).coordinates,box(2,3).coordinates]};
    const p=projectGridToParcels(input,grid(cell("a",0,1,20),cell("b",2,3,80))).features[0].properties;
    expect(p.risk_score).toBeCloseTo(50,4);expect(p.coverage).toBeCloseTo(1,4);
  });
  it("rejects bad values, malformed rectangles, missing timestamps and arbitrary files",()=>{
    for(const score of [NaN,-1,101])expect(()=>parseRiskGrid(grid(cell("a",0,1,score)))).toThrow();
    const a=cell("a",0,1,50);a.geometry.coordinates[0][1]=[.5,.5];expect(()=>parseRiskGrid(grid(a))).toThrow();
    expect(()=>parseRiskGrid({hello:"world"})).toThrow();
  });
});
