import {describe,it,expect} from 'vitest';
import type {GridCell,RiskGrid} from './parcelRisk';
import {riskOverview} from './riskOverview';
const R=6378137,deg=180/Math.PI;
const lon=(x:number)=>x/R*deg,lat=(y:number)=>(2*Math.atan(Math.exp(y/R))-Math.PI/2)*deg;
const x=Math.floor(-120.66/deg*R/512)*512;
const y=Math.floor(R*Math.log(Math.tan(Math.PI/4+35.28/deg/2))/512)*512;
function cell(id:string,dx:number,dy:number,size:number,score:number|null):GridCell{
  const w=lon(x+dx),e=lon(x+dx+size),s=lat(y+dy),n=lat(y+dy+size);
  return {type:'Feature',geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]},properties:{cell_id:id,risk_score:score,model_id:'m',as_of:'2026-11-14T00:00:00Z',layer:'relative_risk'}};
}
const grid=(features:GridCell[]):RiskGrid=>({type:'FeatureCollection',features});
const view={west:lon(x),east:lon(x+512),south:lat(y),north:lat(y+512)};
const four=()=>[cell('a',0,0,256,20),cell('b',256,0,256,40),cell('c',0,256,256,60),cell('d',256,256,256,80)];
describe('saved risk-cell overview',()=>{
  it('replaces four detailed cells with one larger shape using area-weighted known scores',()=>{
    const input=grid(four()),original=JSON.stringify(input);
    const result=riskOverview(input,16,view);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.risk_score).toBeCloseTo(50,2);
    expect(result.features[0].properties.coverage).toBeCloseTo(1,6);
    expect(result.features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(JSON.stringify(input)).toBe(original);
  });
  it('does not turn missing evidence into zero or a property rating',()=>{
    const cells=four();cells[0].properties.risk_score=null;
    const known=riskOverview(grid(cells),16,view).features[0].properties;
    expect(known.coverage).toBeCloseTo(.75,3);expect(known.risk_score).toBeGreaterThan(59);
    cells[1].properties.risk_score=null;cells[2].properties.risk_score=null;
    expect(riskOverview(grid(cells),16,view).features[0].properties.risk_score).toBeNull();
    for(const c of cells)c.properties.risk_score=0;
    expect(riskOverview(grid(cells),16,view).features[0].properties.risk_score).toBe(0);
  });
  it('removes summaries at detail zoom and filters the viewport without changing tile scores',()=>{
    const input=grid(four());expect(riskOverview(input,17,view).features).toEqual([]);
    expect(riskOverview(input,16,{...view,west:0,east:1}).features).toEqual([]);
    const small={...view,west:lon(x+100),east:lon(x+200),south:lat(y+100),north:lat(y+200)};
    expect(riskOverview(input,16,small)).toEqual(riskOverview(input,16,view));
  });
  it('caps overview shapes by coarsening instead of drawing every small plot',()=>{
    const cells:GridCell[]=[];
    for(let i=0;i<32;i++)for(let j=0;j<32;j++)cells.push(cell(`${i}-${j}`,i*512,j*512,512,20));
    const result=riskOverview(grid(cells),16,{...view,east:lon(x+32*512),north:lat(y+32*512)});
    expect(result.features.length).toBeGreaterThan(0);expect(result.features.length).toBeLessThanOrEqual(256);
    expect(result.features.length).toBeLessThan(cells.length);
  });
});
