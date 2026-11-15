import {describe,it,expect,vi} from "vitest";
import {ParcelScoreCache} from "./parcelScoreCache";
import type {ParcelUnit,ParcelScore} from "@/data/types";
const unit=(id='A'):ParcelUnit=>({id,parts:[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]],center:[.5,.5],acres:1,score:null});
const score:ParcelScore={score:40,level:'medium',source:{kind:'risk-map',asOf:'2026-11-14T00:00:00Z',modelId:'v1',coverage:1}};
describe('per-evidence parcel score memo',()=>{
  it('reuses every score when revisiting a full 500-parcel response',()=>{
    const c=new ParcelScoreCache(),compute=vi.fn(()=>score);
    const parcels=Array.from({length:500},(_,i)=>unit(String(i)));
    for(const parcel of parcels)c.get(parcel,compute);
    for(const parcel of parcels)c.get(parcel,compute);
    expect(compute).toHaveBeenCalledTimes(500);
  });
  it('reuses calculations for equal geometry and isolates returned score objects',()=>{
    const c=new ParcelScoreCache(),compute=vi.fn(()=>score);
    c.get(unit(),compute);const a=c.get(unit(),compute)!;a.score=99;
    expect(c.get(unit(),compute)?.score).toBe(40);expect(compute).toHaveBeenCalledTimes(1);
    const changed=unit();changed.parts[0][0][1]=[0,2];c.get(changed,compute);
    expect(compute).toHaveBeenCalledTimes(2);
    c.clear();c.get(unit(),compute);expect(compute).toHaveBeenCalledTimes(3);
  });
  it('bounds retained entries and geometry bytes, including repeated IDs',()=>{
    const c=new ParcelScoreCache();
    for(let i=0;i<600;i++)c.get(unit(String(i)),()=>null);
    expect(c.stats.entries).toBe(512);expect(c.stats.bytes).toBeLessThanOrEqual(1024*1024);
    c.clear();expect(c.stats).toEqual({entries:0,bytes:0});
    for(let i=0;i<30;i++){
      const value=unit(String(i));value.parts[0][0]=Array.from({length:3000},(_,j)=>[j/10000,j/9000]);
      c.get(value,()=>null);
    }
    expect(c.stats.bytes).toBeLessThanOrEqual(1024*1024);expect(c.stats.entries).toBeLessThan(30);
  });
});
