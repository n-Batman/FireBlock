import {it,expect,vi,afterEach} from "vitest";
import {act,renderHook} from "@testing-library/react";
import type {ParcelUnit} from "@/data/types";
import {useParcelDisplay} from "./ParcelAreas";
import {parcelDisplay,parcelScreenFraction,ParcelOutlineCache} from "./parcelDisplay";

vi.mock("./parcelDisplay",async importOriginal=>{
  const actual=await importOriginal<typeof import("./parcelDisplay")>();
  return {...actual,parcelDisplay:vi.fn(actual.parcelDisplay),parcelScreenFraction:vi.fn(actual.parcelScreenFraction)};
});
afterEach(()=>vi.restoreAllMocks());

it("passes all 500 original parcels through without camera or combiner work",()=>{
  const outline=vi.spyOn(ParcelOutlineCache.prototype,"outline");
  const parcels:ParcelUnit[]=Array.from({length:500},(_,i)=>({
    id:String(i),acres:1,center:[35,-120],score:null,
    parts:[[[[35,-120],[35,-119.999],[35.001,-119.999],[35.001,-120],[35,-120]]]],
  }));
  // No Leaflet provider: a camera lookup/subscription here would fail.
  const hook=renderHook(({selectedId}:{selectedId:string|null})=>useParcelDisplay(parcels,selectedId),{initialProps:{selectedId:null as string|null}});
  const original=hook.result.current;
  expect(original.individuals).toBe(parcels);
  expect(original.areas).toEqual([]);
  act(()=>{window.dispatchEvent(new Event("resize"));});
  hook.rerender({selectedId:"0"});
  expect(hook.result.current).toBe(original);
  expect(parcelDisplay).not.toHaveBeenCalled();
  expect(parcelScreenFraction).not.toHaveBeenCalled();
  expect(outline).not.toHaveBeenCalled();
});
