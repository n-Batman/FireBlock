import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { PARCEL_SCAN_KEY } from "./parcelScanStore";
import { useParcels } from "./useParcels";
import { clearParcelCache } from "./parcelCache";

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
  clearParcelCache();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const at = (id: number, lat = 35.632, lon = -120.858) => ({ lat, lon, id });

describe("useParcels", () => {
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
  it("preloads after visible parcels, cancels on unmount and clears timers on page exit", async () => {
    vi.useFakeTimers();
    let preloadSignal:AbortSignal|undefined;
    fetchMock.mockImplementation(async (url:string,init?:{signal?:AbortSignal})=>{
      if(url.includes('/data/'))return reply({},404);
      if(url.includes('bbox=')){preloadSignal=init?.signal;return new Promise(()=>{});}
      return reply(parcelsBody);
    });
    const hook=renderHook(()=>useParcels(at(1)));
    try{
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(hook.result.current.phase).toBe('ready');
      expect(preloadSignal).toBeUndefined();
      await act(async()=>{await vi.advanceTimersByTimeAsync(501);});
      expect(preloadSignal).toBeDefined();
      hook.unmount();expect(preloadSignal!.aborted).toBe(true);
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
