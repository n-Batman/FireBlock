import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapContainer, useMap } from "react-leaflet";
import L from "leaflet";
import { ParcelOverlay } from "./ParcelOverlay";
import { clearParcelCache } from "./parcelCache";
import * as riskProjection from "./parcelRisk";
import * as coverage from "./gridCoverage";

const CENTER: [number, number] = [35.63, -120.85];
const EMPTY = { type: "FeatureCollection", features: [], metadata: { truncated: false, source: "https://example.test", fetchedAt: "t1" } };

const fetchMock = vi.fn();
beforeEach(() => {
  clearParcelCache();
  // His overlay also asks /api/risk-grid when it mounts. Here that grid is simply not available.
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes("/api/risk-grid")
      ? { ok: false, json: async () => ({ error: "No grid in this test" }) }
      : { ok: true, json: async () => EMPTY },
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  clearParcelCache();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ParcelOverlay risk-grid refresh",()=>{
  const grid={type:"FeatureCollection",publication:{source:"published-snapshot"},features:[{
    type:"Feature",geometry:{type:"Polygon",coordinates:[[[-120.86,35.62],[-120.84,35.62],[-120.84,35.64],[-120.86,35.64],[-120.86,35.62]]]},
    properties:{layer:"relative_risk",cell_id:"a",risk_score:40,model_id:"test-model",as_of:"2026-11-14T00:00:00Z"},
  }]};
  let bounds:L.LatLngBounds,map:L.Map;
  const gridCalls=()=>fetchMock.mock.calls.filter(([url])=>String(url).includes("/api/risk-grid"));
  const advance=async(ms:number)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
  const pan=(south:number,west:number)=>{
    act(()=>{bounds=L.latLngBounds([south,west],[south+.02,west+.02]);map.fire("moveend");});
  };
  beforeEach(()=>{
    vi.useFakeTimers();
    bounds=L.latLngBounds([35.62,-120.86],[35.64,-120.84]);
    vi.spyOn(L.Map.prototype,"getBounds").mockImplementation(()=>bounds);
    fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes("/api/risk-grid")?grid:EMPTY}));
  });
  async function mountGrid(onGridActive=vi.fn()){
    function Grab(){map=useMap();return null;}
    const mounted=render(<MapContainer center={CENTER} zoom={12} style={{height:400,width:400}}>
      <Grab/><ParcelOverlay center={CENTER} onGridActive={onGridActive}/>
    </MapContainer>);
    await advance(0);
    expect(gridCalls()).toHaveLength(1);
    return {...mounted,onGridActive};
  }

  it("makes no new fetches for small pans inside the 50%-padded bbox",async()=>{
    await mountGrid();
    const bbox=new URL(String(gridCalls()[0][0]),"https://local.test").searchParams.get("bbox")!.split(",").map(Number);
    [-120.87,35.61,-120.83,35.65].forEach((value,i)=>expect(bbox[i]).toBeCloseTo(value,10));
    expect(gridCalls()[0][1]).toMatchObject({cache:"no-store"});
    pan(35.625,-120.855);await advance(300);
    pan(35.615,-120.865);await advance(300);
    expect(gridCalls()).toHaveLength(1);
  });

  it("makes exactly one debounced fetch when panning outside the padded bbox",async()=>{
    await mountGrid();
    pan(35.64,-120.83);await advance(200);
    pan(35.645,-120.825);await advance(249);
    expect(gridCalls()).toHaveLength(1);
    await advance(1);
    expect(gridCalls()).toHaveLength(2);
    pan(35.646,-120.824);await advance(300);
    expect(gridCalls()).toHaveLength(2);
  });

  it("makes no extra fetches after more than two minutes",async()=>{
    await mountGrid();await advance(125000);
    expect(gridCalls()).toHaveLength(1);
  });

  it("calls onGridActive(true) once and preserves the drawn published snapshot",async()=>{
    const {onGridActive}=await mountGrid();
    expect(onGridActive.mock.calls.filter(([active])=>active===true)).toHaveLength(1);
    expect(screen.getByText(/Published real-data snapshot.*1 cells.*test-model/)).toBeInTheDocument();
    let drawn=false;map.eachLayer(layer=>{if(layer instanceof L.GeoJSON&&layer.getLayers().length)drawn=true;});
    expect(drawn).toBe(true);
    pan(35.625,-120.855);await advance(125000);
    expect(onGridActive.mock.calls.filter(([active])=>active===true)).toHaveLength(1);
  });

  it("forces a fetch from Load configured backend grid inside the cached bbox",async()=>{
    await mountGrid();
    fireEvent.click(screen.getByRole("button",{name:"Load configured backend grid"}));
    await advance(249);expect(gridCalls()).toHaveLength(1);
    await advance(1);expect(gridCalls()).toHaveLength(2);
    expect(screen.getByText(/Published real-data snapshot.*1 cells.*test-model/)).toBeInTheDocument();
  });

  it("aborts stale grid requests and ignores their late responses",async()=>{
    await mountGrid();
    let release!:(response:unknown)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    pan(35.64,-120.83);await advance(250);
    const signal=gridCalls()[1][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    pan(35.7,-120.7);
    expect(signal.aborted).toBe(true);
    await advance(250);expect(gridCalls()).toHaveLength(3);
    await act(async()=>{release({ok:false,json:async()=>({error:"stale failure"})});});
    expect(screen.queryByText("stale failure")).not.toBeInTheDocument();
    expect(screen.getByText(/Published real-data snapshot.*1 cells.*test-model/)).toBeInTheDocument();
  });
});

type Lookup = { lat: number; lon: number; id: number } | null;
const mount = (lookup?: Lookup, onPoint?: (p: { lat: number; lon: number }) => void) => (
  <MapContainer center={CENTER} zoom={12} style={{ height: 400, width: 400 }}>
    <ParcelOverlay center={CENTER} lookup={lookup} onPoint={onPoint} />
  </MapContainer>
);
const parcelUrls = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/api/parcels"));
/** Parcel lookups only: his grid request is not one of them. */
const parcelCalls = () => parcelUrls().length;

describe("ParcelOverlay lookup", () => {
  it("skips duplicate automatic lookups, projection and hidden clipping when the main map owns parcels", async () => {
    const project=vi.spyOn(riskProjection,'projectGridToParcels');
    const clip=vi.spyOn(coverage,'gridOutsideParcels');
    const grid={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[-120.86,35.62],[-120.84,35.62],[-120.84,35.64],[-120.86,35.64],[-120.86,35.62]]]},properties:{layer:'relative_risk',cell_id:'a',risk_score:40,model_id:'test-model',as_of:'2026-11-14T00:00:00Z'}}]};
    fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes('/api/risk-grid')?grid:EMPTY}));
    render(<MapContainer center={CENTER} zoom={12} style={{height:400,width:400}}>
      <ParcelOverlay center={CENTER} lookup={{lat:CENTER[0],lon:CENTER[1],id:1}} parcelMask={[]} showGridByDefault={false}/>
    </MapContainer>);
    await screen.findByText(/1 cells.*test-model/);
    expect(parcelCalls()).toBe(0);
    expect(project).not.toHaveBeenCalled();expect(clip).not.toHaveBeenCalled();
    // An explicit control request is still supported, but must not score a hidden duplicate layer.
    fireEvent.click(screen.getByRole('button',{name:'Find at point'}));
    await screen.findByText('0 parcels.');
    expect(project).not.toHaveBeenCalled();expect(clip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox',{name:/Show underlying grid/}));
    expect(clip).toHaveBeenCalledTimes(1);
  });
  it("looks up the parcel at the point it is given, through his /api/parcels", async () => {
    render(mount({ lat: 35.6363, lon: -120.8597, id: 1 }));
    await waitFor(() => expect(parcelCalls()).toBe(1));
    const url = new URL(parcelUrls()[0], "http://localhost");
    expect(url.pathname).toBe("/api/parcels");
    expect(url.searchParams.get("lat")).toBe("35.6363");
    expect(url.searchParams.get("lon")).toBe("-120.8597");
    expect(await screen.findByText("0 parcels.")).toBeInTheDocument();
  });

  it("does not look anything up until it is given a point", () => {
    render(mount(null));
    expect(parcelCalls()).toBe(0);
  });

  it("reuses cached boundaries for a new search at the same point without extra requests", async () => {
    const { rerender } = render(mount({ lat: 35.6363, lon: -120.8597, id: 1 }));
    await waitFor(() => expect(parcelCalls()).toBe(1));
    rerender(mount({ lat: 35.6363, lon: -120.8597, id: 1 }));
    expect(parcelCalls()).toBe(1);
    rerender(mount({ lat: 35.6363, lon: -120.8597, id: 2 }));
    expect(await screen.findByText("0 parcels.")).toBeInTheDocument();
    expect(parcelCalls()).toBe(1);
  });

  it("does not call the API outside SLO County, and says why", async () => {
    render(mount({ lat: 36.6777, lon: -121.6555, id: 1 }));
    expect(await screen.findByText("Parcel lines cover SLO County only for now.")).toBeInTheDocument();
    expect(parcelCalls()).toBe(0);
  });

  it("applies the same rule to his own latitude and longitude fields", async () => {
    render(mount(null));
    fireEvent.change(screen.getByLabelText("Parcel latitude"), { target: { value: "36.6777" } });
    fireEvent.change(screen.getByLabelText("Parcel longitude"), { target: { value: "-121.6555" } });
    fireEvent.click(screen.getByRole("button", { name: "Find at point" }));
    expect(await screen.findByText("Parcel lines cover SLO County only for now.")).toBeInTheDocument();
    expect(parcelCalls()).toBe(0);
  });

  it("tells the page which point his latitude and longitude fields looked up", async () => {
    const onPoint = vi.fn();
    render(mount(null, onPoint));
    fireEvent.change(screen.getByLabelText("Parcel latitude"), { target: { value: "35.5" } });
    fireEvent.change(screen.getByLabelText("Parcel longitude"), { target: { value: "-120.7" } });
    fireEvent.click(screen.getByRole("button", { name: "Find at point" }));
    await waitFor(() => expect(onPoint).toHaveBeenCalledWith({ lat: 35.5, lon: -120.7 }));
  });

  it("also tells the page about a point outside the county, so it can say so", async () => {
    const onPoint = vi.fn();
    render(mount(null, onPoint));
    fireEvent.change(screen.getByLabelText("Parcel latitude"), { target: { value: "36.6777" } });
    fireEvent.change(screen.getByLabelText("Parcel longitude"), { target: { value: "-121.6555" } });
    fireEvent.click(screen.getByRole("button", { name: "Find at point" }));
    await waitFor(() => expect(onPoint).toHaveBeenCalledWith({ lat: 36.6777, lon: -121.6555 }));
  });

  it("does not tell the page about the visible-area search, which has no single point", async () => {
    const onPoint = vi.fn();
    render(mount(null, onPoint));
    fireEvent.click(screen.getByRole("button", { name: "Find in visible area" }));
    await waitFor(() => expect(parcelCalls()).toBeGreaterThan(0));
    expect(onPoint).not.toHaveBeenCalled();
  });

  it("starts with 'Show underlying grid' unchecked when asked, and keeps his checked default otherwise", () => {
    const grid = () => screen.getByRole("checkbox", { name: /Show underlying grid/ });
    const { unmount } = render(
      <MapContainer center={CENTER} zoom={12} style={{ height: 400, width: 400 }}>
        <ParcelOverlay center={CENTER} showGridByDefault={false} />
      </MapContainer>,
    );
    expect(grid()).not.toBeChecked();
    unmount();
    render(mount(null));
    expect(grid()).toBeChecked();
  });

  it("keeps his controls: latitude, longitude, Find at point, Pick on map, Find in visible area", () => {
    render(mount(null));
    expect(screen.getByLabelText("Parcel latitude")).toBeInTheDocument();
    expect(screen.getByLabelText("Parcel longitude")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find at point" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick on map" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find in visible area" })).toBeInTheDocument();
  });
});
