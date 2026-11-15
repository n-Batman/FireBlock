import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Home from "./page";
import type { View } from "@/lib/parcelApi";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), parcels: vi.fn(), weather: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next/dynamic", () => ({ default: () => (props: { place: { lat: number; lon: number }; parcels: unknown[]; onGridChange: (grid:unknown)=>void; onView: (view: View) => void }) => <div data-testid="map" data-lat={props.place.lat} data-lon={props.place.lon} data-parcels={props.parcels.length}>
  <button onClick={()=>props.onGridChange({type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[[[-120.66,35.28],[-120.65,35.28],[-120.65,35.29],[-120.66,35.29],[-120.66,35.28]]]},properties:{layer:"relative_risk",cell_id:"regional",risk_score:62,model_id:"regional-model",as_of:"2026-11-14T00:00:00Z"}}]})}>Loaded regional grid</button>
  <button onClick={()=>props.onGridChange(null)}>Grid unavailable</button>
  <button onClick={() => props.onView({ south: 35.401, north: 35.421, west: -120.73, east: -120.696 })}>Pan map</button>
</div> }));
vi.mock("@/lib/useParcels", () => ({ useParcels: (...args: unknown[]) => { state.parcels(...args); return { units: [], phase: "loading", truncated: false }; } }));
vi.mock("@/lib/useWide", () => ({ useWide: () => true }));
vi.mock("@/components/AddressSearch", () => ({ AddressSearch: ({ onSelect }: { onSelect: (p: unknown) => void }) => <button onClick={() => onSelect({ lat: 35.6, lon: -120.7, label: "Searched address" })}>Search address</button> }));
vi.mock("@/components/BlockRail", () => ({ BlockRail: () => null }));
vi.mock("@/components/WeatherStrip", () => ({ WeatherStrip: (props: { lat: number; lon: number }) => { state.weather(props); return null; } }));
vi.mock("@/components/Legend", () => ({ Legend: () => null }));
vi.mock("@/components/ParcelPanel", () => ({ ParcelPanel: () => null }));

it("shows the landing screen without map parameters", () => {
  state.params = new URLSearchParams();
  render(<Home />);
  expect(screen.getByRole("heading", { name: "FireBlock" })).toBeInTheDocument();
  expect(screen.queryByTestId("map")).not.toBeInTheDocument();
});

describe("map starting place", () => {
  it("passes the overlay's regional cells into parcel scoring and clears them on grid failure",()=>{
    state.params=new URLSearchParams("map=1");
    render(<Home/>);
    fireEvent.click(screen.getByRole("button",{name:"Loaded regional grid"}));
    expect(state.parcels.mock.lastCall![2]).toMatchObject([{cellId:"regional",score:62,modelId:"regional-model"}]);
    fireEvent.click(screen.getByRole("button",{name:"Grid unavailable"}));
    expect(state.parcels.mock.lastCall![2]).toEqual([]);
  });
  it("opens real parcels in Downtown SLO even with an old demo property link", () => {
    state.params = new URLSearchParams("property=adelaida-hills");
    render(<Home />);
    expect(screen.getByText("Downtown SLO")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-lat", "35.2828");
    expect(screen.getByTestId("map")).toHaveAttribute("data-parcels", "0");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("link", { name: "Scan" })).toHaveAttribute("href", "/scan");
    fireEvent.click(screen.getByText("Search address"));
    expect(screen.getByText("Searched address")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-lat", "35.6");
  });

  it("preserves scan location links", () => {
    state.params = new URLSearchParams("lat=35.4&lon=-120.8");
    render(<Home />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-lat", "35.4");
    expect(screen.getByTestId("map")).toHaveAttribute("data-lon", "-120.8");
  });

  it("uses the starting place for weather until the map reports its center", () => {
    state.params = new URLSearchParams("lat=35.284&lon=-120.664");
    render(<Home />);
    expect(state.weather).toHaveBeenLastCalledWith({ lat: 35.284, lon: -120.664 });
    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));
    expect(state.weather).toHaveBeenLastCalledWith({ lat: 35.41, lon: -120.71 });
  });
});
