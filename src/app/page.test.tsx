import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Home from "./page";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), parcels: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next/dynamic", () => ({ default: () => (props: { place: { lat: number; lon: number }; parcels: unknown[] }) => <div data-testid="map" data-lat={props.place.lat} data-lon={props.place.lon} data-parcels={props.parcels.length} /> }));
vi.mock("@/lib/useParcels", () => ({ useParcels: (...args: unknown[]) => { state.parcels(...args); return { units: [], phase: "loading", truncated: false }; } }));
vi.mock("@/lib/useWide", () => ({ useWide: () => true }));
vi.mock("@/components/AddressSearch", () => ({ AddressSearch: ({ onSelect }: { onSelect: (p: unknown) => void }) => <button onClick={() => onSelect({ lat: 35.6, lon: -120.7, label: "Searched address" })}>Search address</button> }));
vi.mock("@/components/BlockRail", () => ({ BlockRail: () => null }));
vi.mock("@/components/WeatherStrip", () => ({ WeatherStrip: () => null }));
vi.mock("@/components/Legend", () => ({ Legend: () => null }));
vi.mock("@/components/ParcelPanel", () => ({ ParcelPanel: () => null }));

describe("map starting place", () => {
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
});
