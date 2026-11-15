import {beforeEach,describe,it,expect,vi} from "vitest";
import {intersection,union} from "polyclip-ts";
import type {ParcelUnit} from "@/data/types";
import {parcelDisplay,parcelScreenFraction,ParcelOutlineCache} from "./parcelDisplay";
vi.mock("polyclip-ts",async importOriginal=>{
  const actual=await importOriginal<typeof import("polyclip-ts")>();
  return {...actual,intersection:vi.fn(actual.intersection),union:vi.fn(actual.union)};
});
const R=6378137;
const ll=(x:number,y:number):[number,number]=>[(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI,x/R*180/Math.PI];
const view=(size:number)=>({west:ll(0,0)[1],south:ll(0,0)[0],east:ll(size,size)[1],north:ll(size,size)[0]});
function lot(id:string,x=10,y=10,size=40,score:number|null=20):ParcelUnit{
  return {id,acres:1,center:ll(x+size/2,y+size/2),parts:[[[ll(x,y),ll(x+size,y),ll(x+size,y+size),ll(x,y+size),ll(x,y)]]],score:score===null?null:{score,level:"low",source:{kind:"risk-map",modelId:"test",asOf:"2026-11-14",coverage:1}}};
}
describe("screen-sized parcel display",()=>{
  beforeEach(()=>{vi.mocked(intersection).mockClear();vi.mocked(union).mockClear();});
  it("reuses the same merged outline on pan, data refresh and zoom return while updating scores",()=>{
    const cache=new ParcelOutlineCache(),parcels=[lot("a"),lot("b",50)];
    const first=parcelDisplay(parcels,view(1000),null,cache).areas[0];
    const panned={...view(1000),west:ll(-10,0)[1],east:ll(990,0)[1]};
    expect(parcelDisplay(parcels,panned,null,cache).areas[0].parts).toBe(first.parts);
    parcelDisplay(parcels,view(100),null,cache);
    const refreshed=JSON.parse(JSON.stringify(parcels)) as ParcelUnit[];
    refreshed[0].score!.score=80;
    const returned=parcelDisplay(refreshed.reverse(),view(1000),null,cache).areas[0];
    expect(returned.parts).toBe(first.parts);
    expect(returned.score).toBe(50);
    expect(union).toHaveBeenCalledTimes(1);
  });
  it("rebuilds outlines when membership or coordinates change, including same-ID geometry",()=>{
    const cache=new ParcelOutlineCache(),parcels=[lot("a"),lot("b",50)];
    const first=parcelDisplay(parcels,view(1000),null,cache).areas[0];
    const moved=parcelDisplay([parcels[0],lot("b",60)],view(1000),null,cache).areas[0];
    expect(moved.parts).not.toBe(first.parts);
    expect(moved.parts).not.toEqual(first.parts);
    const added=parcelDisplay([...parcels,lot("c",100)],view(1000),null,cache).areas[0];
    expect(added.parts).not.toBe(first.parts);
    expect(union).toHaveBeenCalledTimes(3);
  });
  it("bounds retained outlines by entry count and byte budget",()=>{
    const parcels=[lot("a"),lot("b",50)],other=[lot("c"),lot("d",50)];
    for(const cache of [new ParcelOutlineCache(1),new ParcelOutlineCache(128,1)]){
      const first=parcelDisplay(parcels,view(1000),null,cache).areas[0];
      parcelDisplay(other,view(1000),null,cache);
      expect(parcelDisplay(parcels,view(1000),null,cache).areas[0].parts).not.toBe(first.parts);
    }
    expect(union).toHaveBeenCalledTimes(6);
  });
  it("uses direct area minus holes for contained multipart parcels without clipping",()=>{
    const parcel=lot("p",10,10,40);
    parcel.parts[0].push(lot("hole",20,20,20).parts[0][0].slice().reverse());
    parcel.parts.push(lot("island",70,70,10).parts[0]);
    expect(parcelScreenFraction(parcel,view(100))).toBeCloseTo(.13);
    expect(intersection).not.toHaveBeenCalled();
  });
  it("avoids clipping for parcels on the view boundary or wholly outside it",()=>{
    expect(parcelScreenFraction(lot("p",0,0,100),view(100))).toBeCloseTo(1);
    for(const [x,y] of [[-50,10],[100,10],[10,-50],[10,100]]){
      expect(parcelScreenFraction(lot("outside",x,y,40),view(100))).toBe(0);
    }
    expect(intersection).not.toHaveBeenCalled();
  });
  it("clips only edge-crossing bounds, retaining partial holes and enclosing parcels",()=>{
    for(const [x,y] of [[-20,20],[80,20],[20,-20],[20,80]]){
      expect(parcelScreenFraction(lot("edge",x,y,40),view(100))).toBeCloseTo(.08);
    }
    const parcel=lot("p",-50,-50,200);
    parcel.parts[0].push(lot("hole",50,20,100).parts[0][0]);
    expect(parcelScreenFraction(parcel,view(100))).toBeCloseTo(.6);
    expect(intersection).toHaveBeenCalledTimes(5);
  });
  it("keeps boundaries visible if geometry or clipping fails",()=>{
    const parcel=lot("invalid");parcel.parts[0][0][0]=[NaN,0];
    expect(parcelScreenFraction(parcel,view(100))).toBe(1);
    expect(intersection).not.toHaveBeenCalled();
    vi.mocked(intersection).mockImplementationOnce(()=>{throw new Error("clip failed");});
    expect(parcelScreenFraction(lot("edge",-20,20,40),view(100))).toBe(1);
  });
  it("restores parcels between 5% and the previous 10% threshold",()=>{
    const parcels=[lot("a"),lot("b",50)];
    const camera={...view(100),east:view(300).east};
    expect(parcelScreenFraction(parcels[0],camera)).toBeGreaterThan(.05);
    expect(parcelScreenFraction(parcels[0],camera)).toBeLessThan(.1);
    expect(parcelDisplay(parcels,camera)).toEqual({individuals:parcels,areas:[]});
  });
  it("groups below 5% and restores the original polygons when zooming back in",()=>{
    const parcels=[lot("a"),lot("b",50)],original=JSON.stringify(parcels);
    const wide=parcelDisplay(parcels,view(1000));
    expect(wide.individuals).toHaveLength(0);expect(wide.areas).toHaveLength(1);
    expect(parcelDisplay(parcels,view(100)).individuals).toEqual(parcels);
    expect(parcelDisplay(parcels,view(1000))).toEqual(wide);
    expect(JSON.stringify(parcels)).toBe(original);
  });
  it("measures actual visible area, subtracts holes, and changes with screen aspect ratio",()=>{
    const parcel=lot("p",0,0,100);
    expect(parcelScreenFraction(parcel,view(100))).toBeCloseTo(1);
    const half={...view(100),west:ll(50,0)[1],east:ll(150,0)[1]};
    expect(parcelScreenFraction(parcel,half)).toBeCloseTo(.5);
    const hole=lot("hole",0,0,100);hole.parts[0].push(lot("inside",10,10,80).parts[0][0]);
    expect(parcelScreenFraction(hole,view(100))).toBeCloseTo(.36);
    expect(parcelScreenFraction(parcel,{...view(100),east:view(1000).east})).toBeCloseTo(.1);
  });
  it("keeps parcels at exactly 5% and a selected small parcel individually visible",()=>{
    const parcel=lot("p",0,0,100),other=lot("other",150);
    const v={...view(100),east:view(2000).east};
    expect(parcelDisplay([parcel,other],v).individuals).toContain(parcel);
    expect(parcelDisplay([parcel,other],view(1000),"p").individuals).toContain(parcel);
  });
  it("unions an L-shaped neighborhood instead of drawing a box across the missing corner",()=>{
    const result=parcelDisplay([lot("a",10,10),lot("b",50,10),lot("c",10,50)],view(1000));
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].parts[0][0].length).toBeGreaterThan(5);
    expect(result.areas[0].count).toBe(3);
  });
  it("preserves holes and disconnected parcels without filling the space between them",()=>{
    const a=lot("a",10,10,100);a.parts[0].push(lot("hole",20,20,20).parts[0][0]);
    const result=parcelDisplay([a,lot("b",150,10,40)],view(1000));
    expect(result.areas[0].parts).toHaveLength(2);
    expect(result.areas[0].parts.some(part=>part.length===2)).toBe(true);
  });
  it("area-weights known scores, keeps unknown unknown, and ignores input order",()=>{
    const a={...lot("a",10,10,40,80),acres:3},b=lot("b",50,10,40,20),c=lot("c",90,10,40,null);
    const result=parcelDisplay([a,b,c],view(1000));
    expect(result.areas[0]).toMatchObject({score:65,coverage:.8,scoredCount:2});
    expect(parcelDisplay([c,b,a],view(1000))).toEqual(result);
    expect(parcelDisplay([{...a,score:null},{...b,score:null}],view(1000)).areas[0].score).toBeNull();
  });
  it("keeps singleton and invalid-camera boundaries instead of hiding them",()=>{
    const parcel=lot("p");
    expect(parcelDisplay([parcel],view(1000)).individuals).toEqual([parcel]);
    expect(parcelDisplay([parcel],{...view(100),east:NaN}).individuals).toEqual([parcel]);
    expect(parcelDisplay([],view(100))).toEqual({individuals:[],areas:[]});
  });
});
