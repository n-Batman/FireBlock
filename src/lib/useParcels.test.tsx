import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { PARCEL_SCAN_KEY } from "./parcelScanStore";
import { useParcels as useViewportParcels } from "./useParcels";
import type { View } from "./parcelApi";
import { clearParcelCache } from "./parcelCache";
import { ParcelScoreCache } from "./parcelScoreCache";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import * as parcelApi from "./parcelApi";
import {toParcelUnits} from "./parcelUnits";
import type {Parcels} from "./parcels";

vi.mock("@turf/boolean-point-in-polygon",async importOriginal=>{
  const actual=await importOriginal<typeof import("@turf/boolean-point-in-polygon")>();
  return {...actual,default:vi.fn(actual.default)};
});

const square = (lon: number, lat: number, w: number) => [
  [lon, lat], [lon + w, lat], [lon + w, lat + w], [lon, lat + w], [lon, lat],
];
const parcelsBody = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.004)] }, properties: { parcelId: "A-1", source: "s", fetchedAt: "t" } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [square(-120.85, 35.63, 0.004)] }, properties: { parcelId: "B-2", source: "s", fetchedAt: "t" } },
  ],
  metadata: { source: "s", truncated: false, limit: 200, fetchedAt: "t", note: "n" },
};
const riskMap = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [square(-120.87, 35.62, 0.03)] },
      properties: { layer: "relative_risk", cell_id: "r0c0", risk_score: 40, as_of: "2026-11-13T00:00:00Z", model_id: "m1" },
    },
  ],
};

const reply = (json: unknown, status = 200) => ({ ok: status < 400, status, json: async () => json });
const fetchMock = vi.fn();
/** Routes the parcel API and the optional risk-map file. */
function routes(over: { parcels?: () => Promise<unknown>; risk?: unknown } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/parcels")) return over.parcels ? over.parcels() : reply(parcelsBody);
    if (url.includes("/data/risk_map.geojson")) return over.risk ? reply(over.risk) : reply({}, 404);
    throw new Error(`unexpected ${url}`);
  });
}

// This jsdom has no working localStorage, so the tests use a small in-memory one.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

beforeEach(() => {
  clearParcelCache();
  store.clear();
  vi.stubGlobal("localStorage", memoryStorage);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  clearParcelCache();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const at = (id: number, lat = 35.632, lon = -120.858) => ({ lat, lon, id });
const detail:View={west:-120.87,south:35.62,east:-120.84,north:35.64,zoom:17};
const useParcels=(place:Parameters<typeof useViewportParcels>[0],view:View|null=detail)=>useViewportParcels(place,view);

describe("useParcels", () => {
  it("reuses displayed parcel objects for cloned and reordered identical APN results",async()=>{
    routes();
    const raw=toParcelUnits(parcelsBody as Parcels);
    vi.spyOn(parcelApi,"lookupParcelsInView")
      .mockResolvedValueOnce({kind:"ok",units:raw,truncated:false})
      .mockResolvedValueOnce({kind:"ok",units:structuredClone(raw).reverse(),truncated:false})
      .mockResolvedValueOnce({kind:"ok",units:structuredClone(raw),truncated:true});
    const place=at(1);
    const hook=renderHook(({view})=>useParcels(place,view),{initialProps:{view:detail}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    const [a,b]=hook.result.current.units;
    const get=vi.spyOn(ParcelScoreCache.prototype,"get");
    hook.rerender({view:{...detail,west:detail.west-.0001}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(hook.result.current.units[0]).toBe(a);expect(hook.result.current.units[1]).toBe(b);
    expect(get).not.toHaveBeenCalled();
    hook.rerender({view:{...detail,west:detail.west-.0002}});
    await waitFor(()=>expect(hook.result.current.truncated).toBe(true));
    expect(hook.result.current.units[0]).toBe(a);expect(hook.result.current.units[1]).toBe(b);
    expect(get).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("keeps unchanged APNs when geometry changes, adds new IDs and drops missing IDs",async()=>{
    routes();
    const raw=toParcelUnits(parcelsBody as Parcels),changed=structuredClone(raw[1]);
    changed.parts[0][0][1][1]+=.0001;
    const added={...structuredClone(raw[0]),id:"C-3"};
    vi.spyOn(parcelApi,"lookupParcelsInView")
      .mockResolvedValueOnce({kind:"ok",units:raw,truncated:false})
      .mockResolvedValueOnce({kind:"ok",units:[structuredClone(raw[0]),changed,added],truncated:false})
      .mockResolvedValueOnce({kind:"ok",units:[structuredClone(raw[0]),structuredClone(added)],truncated:false});
    const place=at(1);
    const hook=renderHook(({view})=>useParcels(place,view),{initialProps:{view:detail}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    const [a,b]=hook.result.current.units;
    hook.rerender({view:{...detail,west:detail.west-.0001}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    const [nextA,nextB,c]=hook.result.current.units;
    expect(nextA).toBe(a);expect(nextB).not.toBe(b);
    expect(nextB.parts).toBe(changed.parts);expect(c.id).toBe("C-3");
    hook.rerender({view:{...detail,west:detail.west-.0002}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(hook.result.current.units.map(u=>u.id)).toEqual(["A-1","C-3"]);
    expect(hook.result.current.units[0]).toBe(a);expect(hook.result.current.units[1]).toBe(c);
    hook.unmount();
  });
  it.each(["acres","center"] as const)("replaces an APN when its %s changes",async field=>{
    routes();
    const raw=toParcelUnits(parcelsBody as Parcels),changed=structuredClone(raw[0]);
    if(field==="acres")changed.acres+=1;else changed.center[0]+=.0001;
    vi.spyOn(parcelApi,"lookupParcelsInView")
      .mockResolvedValueOnce({kind:"ok",units:raw,truncated:false})
      .mockResolvedValueOnce({kind:"ok",units:[changed,structuredClone(raw[1])],truncated:false});
    const place=at(1);
    const hook=renderHook(({view})=>useParcels(place,view),{initialProps:{view:detail}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    const [a,b]=hook.result.current.units;
    hook.rerender({view:{...detail,west:detail.west-.0001}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(hook.result.current.units[0]).not.toBe(a);expect(hook.result.current.units[1]).toBe(b);
    hook.unmount();
  });
  it("filters retained units on view changes without repeating point tests or score lookups",async()=>{
    routes({risk:riskMap});
    const place=at(1);
    const hook=renderHook(({view}:{view:View|null})=>useViewportParcels(place,view),{initialProps:{view:detail as View|null}});
    await waitFor(()=>expect(hook.result.current.units[0]?.score?.score).toBe(40));
    const [a,b]=hook.result.current.units;
    expect(a.atPoint).toBe(true);expect(b.atPoint).toBe(false);
    const get=vi.spyOn(ParcelScoreCache.prototype,"get");
    vi.mocked(booleanPointInPolygon).mockClear();
    hook.rerender({view:{...detail,east:-120.852}});
    expect(hook.result.current.units).toEqual([a]);
    expect(hook.result.current.units[0]).toBe(a);
    expect(get).not.toHaveBeenCalled();
    // The API cache may test viewport corners; only chosen-point work belongs
    // to this memo and must stay unchanged on pan.
    const pointTests=()=>vi.mocked(booleanPointInPolygon).mock.calls.filter(([p])=>
      "geometry" in p&&p.geometry.coordinates[0]===place.lon&&p.geometry.coordinates[1]===place.lat);
    expect(pointTests()).toHaveLength(0);
    // Too-wide replies do not replace the retained display/evidence version.
    hook.rerender({view:{west:-121,south:35.5,east:-120.5,north:36,zoom:16}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("zoom"));
    expect(hook.result.current.units[0]).toBe(a);
    expect(hook.result.current.units[1]).toBe(b);
    expect(get).not.toHaveBeenCalled();
    expect(pointTests()).toHaveLength(0);
    hook.unmount();
  });
  it("recomputes atPoint when the chosen coordinates change within the same display",async()=>{
    routes();
    const hook=renderHook(({place})=>useParcels(place),{initialProps:{place:at(1)}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(hook.result.current.units.map(u=>u.atPoint)).toEqual([true,false]);
    hook.rerender({place:at(1,35.632,-120.848)});
    expect(hook.result.current.units.map(u=>u.atPoint)).toEqual([false,true]);
    hook.unmount();
  });
  it('loads real parcel units through the browser cache with a native-style fetch receiver check',async()=>{
    fetchMock.mockImplementation(function(this:unknown,url:string){
      if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');
      return Promise.resolve(url.includes('/api/parcels')?reply(parcelsBody):reply({},404));
    });
    const hook=renderHook(()=>useParcels(at(1)));
    await waitFor(()=>expect(hook.result.current.phase).toBe('ready'));
    expect(hook.result.current.units.map(u=>u.id)).toEqual(['A-1','B-2']);
    expect(hook.result.current.message).toBeNull();
  });
  it('loads parcels at every zoom and restores them after zoom-out and zoom-in',async()=>{
    routes({risk:riskMap});
    const hook=renderHook(({view}:{view:View|null})=>useViewportParcels(at(1),view),{initialProps:{view:null as View|null}});
    expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/api/parcels'))).toHaveLength(0);
    hook.rerender({view:{...detail,zoom:16}});
    await waitFor(()=>expect(hook.result.current.phase).toBe('ready'));
    expect(hook.result.current.units).toHaveLength(2);
    hook.rerender({view:{...detail,zoom:14}});
    expect(hook.result.current.units).toHaveLength(2);
    await waitFor(()=>expect(hook.result.current.phase).toBe('ready'));
    hook.rerender({view:detail});
    await waitFor(()=>expect(hook.result.current.phase).toBe('ready'));
    expect(hook.result.current.units.map(u=>u.id)).toEqual(['A-1','B-2']);
    hook.unmount();
  });
  it('keeps loaded parcels when the next viewport is too wide to query',async()=>{
    routes();
    const hook=renderHook(({view})=>useParcels(at(1),view),{initialProps:{view:detail}});
    await waitFor(()=>expect(hook.result.current.phase).toBe('ready'));
    hook.rerender({view:{west:-121,south:35.5,east:-120.5,north:36,zoom:10}});
    await waitFor(()=>expect(hook.result.current.phase).toBe('zoom'));
    expect(hook.result.current.units).toHaveLength(0); // Retained parcels are too small for zoom 10.
    hook.rerender({view:detail});
    await waitFor(()=>expect(hook.result.current.phase).toBe('ready'));
    expect(hook.result.current.units).toHaveLength(2);
  });
  it("hides retained small parcels immediately on zoom-out and reloads detail on zoom-in",async()=>{
    const mixed={...parcelsBody,features:[parcelsBody.features[0],{
      ...parcelsBody.features[1],geometry:{type:"Polygon",coordinates:[square(-120.85,35.63,.0001)]},
    }]};
    fetchMock.mockImplementation(async(url:string)=>{
      if(!url.includes("/api/parcels"))return reply({},404);
      const min=new URL(url,"https://local.test").searchParams.get("min_acres");
      return reply({...mixed,features:min?[mixed.features[0]]:mixed.features});
    });
    const place=at(1);
    const hook=renderHook(({view})=>useParcels(place,view),{initialProps:{view:detail}});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(hook.result.current.units).toHaveLength(2);
    hook.rerender({view:{...detail,zoom:16}});
    expect(hook.result.current.units.map(u=>u.id)).toEqual(["A-1"]);
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(fetchMock.mock.calls.some(([url])=>String(url).includes("min_acres=0.25"))).toBe(true);
    hook.rerender({view:detail});
    await waitFor(()=>expect(hook.result.current.phase).toBe("ready"));
    expect(hook.result.current.units).toHaveLength(2);
    hook.unmount();
  });
  it("invalidates memoized parcel scores when new scan evidence arrives", async () => {
    routes({risk:riskMap});
    const hook=renderHook(()=>useParcels(at(1)));
    await waitFor(()=>expect(hook.result.current.units[0]?.score?.score).toBe(40));
    act(()=>{
      memoryStorage.setItem(PARCEL_SCAN_KEY,JSON.stringify([{lat:35.632,lon:-120.858,risks:3,clears:1,at:'2026-11-14T18:00:00Z'}]));
      window.dispatchEvent(new Event('storage'));
    });
    await waitFor(()=>expect(hook.result.current.units[0]?.score?.score).toBe(75));
    expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/api/parcels'))).toHaveLength(1);
    hook.unmount();
  });
  it("does not start speculative requests after visible parcels and clears timers on page exit", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url:string,init?:{signal?:AbortSignal})=>{
      if(url.includes('/data/'))return reply({},404);
      return reply(parcelsBody);
    });
    const hook=renderHook(()=>useParcels(at(1)));
    try{
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(hook.result.current.phase).toBe('ready');
      await act(async()=>{await vi.advanceTimersByTimeAsync(501);});
      expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('/api/parcels'))).toHaveLength(1);
      hook.unmount();
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    }finally{hook.unmount();vi.useRealTimers();}
  });
  it("does nothing until a place is chosen", () => {
    routes();
    const { result } = renderHook(() => useParcels(null));
    expect(result.current.phase).toBe("idle");
    expect(result.current.units).toEqual([]);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/parcels"))).toBe(false);
  });

  it("looks up the parcels around the place, and leaves them unscored when nothing can score them", async () => {
    routes();
    const { result } = renderHook(() => useParcels(at(1)));
    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.units.map((u) => u.id)).toEqual(["A-1", "B-2"]);
    expect(result.current.units.every((u) => u.score === null)).toBe(true);
  });

  it("scores the parcel a saved scan's GPS falls inside, and only that one", async () => {
    routes();
    memoryStorage.setItem(
      PARCEL_SCAN_KEY,
      JSON.stringify([{ lat: 35.632, lon: -120.858, risks: 3, clears: 1, at: "2026-11-14T10:00:00-08:00" }]),
    );
    const { result } = renderHook(() => useParcels(at(1)));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const [a, b] = result.current.units;
    expect(a.score).toMatchObject({ score: 75, source: { kind: "scan" } });
    expect(b.score).toBeNull();
  });

  it("scores parcels from public/data/risk_map.geojson when it exists", async () => {
    routes({ risk: riskMap });
    const { result } = renderHook(() => useParcels(at(1)));
    await waitFor(() => {
      expect(result.current.units).toHaveLength(2);
      expect(result.current.units.every((u) => u.score !== null)).toBe(true);
    });
    expect(result.current.units[0].score).toMatchObject({ score: 40, source: { kind: "risk-map", modelId: "m1" } });
  });

  it("falls back to unscored, with no error, when there is no risk map file", async () => {
    routes();
    const { result } = renderHook(() => useParcels(at(1)));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.message).toBeNull();
  });

  it("reports outside SLO County without calling the parcel API", async () => {
    routes();
    const { result } = renderHook(() => useParcels(at(1, 36.6777, -121.6555)));
    await waitFor(() => expect(result.current.phase).toBe("outside"));
    expect(result.current.units).toEqual([]);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/parcels"))).toBe(false);
  });

  it("explains a 502 in plain words", async () => {
    routes({ parcels: async () => reply({ error: "Parcel provider is unavailable" }, 502) });
    const { result } = renderHook(() => useParcels(at(1)));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.message).toBe("The county parcel service is not answering. Try again in a moment.");
    expect(result.current.units).toEqual([]);
  });

  it("drops the answer to an earlier place when a new place is chosen", async () => {
    let release: (v: unknown) => void = () => {};
    let calls = 0;
    routes({
      parcels: () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => (release = resolve));
        return Promise.resolve(reply({ ...parcelsBody, features: [parcelsBody.features[1]] }));
      },
    });
    const { result, rerender } = renderHook(({ place }) => useParcels(place), { initialProps: { place: at(1) } });
    rerender({ place: at(2) });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    release(reply(parcelsBody)); // the first, late answer
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.units.map((u) => u.id)).toEqual(["B-2"]);
  });
});
