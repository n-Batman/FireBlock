import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { ParcelOverlay } from "./ParcelOverlay";

const CENTER: [number, number] = [35.63, -120.85];
const EMPTY = { type: "FeatureCollection", features: [], metadata: { truncated: false, source: "https://example.test", fetchedAt: "t1" } };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => EMPTY });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

type Lookup = { lat: number; lon: number; id: number } | null;
const mount = (lookup?: Lookup, onPoint?: (p: { lat: number; lon: number }) => void) => (
  <MapContainer center={CENTER} zoom={12} style={{ height: 400, width: 400 }}>
    <ParcelOverlay center={CENTER} lookup={lookup} onPoint={onPoint} />
  </MapContainer>
);
const parcelUrls = () => fetchMock.mock.calls.map(([u]) => String(u));

describe("ParcelOverlay lookup", () => {
  it("looks up the parcel at the point it is given, through his /api/parcels", async () => {
    render(mount({ lat: 35.6363, lon: -120.8597, id: 1 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(parcelUrls()[0], "http://localhost");
    expect(url.pathname).toBe("/api/parcels");
    expect(url.searchParams.get("lat")).toBe("35.6363");
    expect(url.searchParams.get("lon")).toBe("-120.8597");
    expect(await screen.findByText("0 parcels.")).toBeInTheDocument();
  });

  it("does not look anything up until it is given a point", () => {
    render(mount(null));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up again for a new search at the same point, but not on an unrelated re-render", async () => {
    const { rerender } = render(mount({ lat: 35.6363, lon: -120.8597, id: 1 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(mount({ lat: 35.6363, lon: -120.8597, id: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(mount({ lat: 35.6363, lon: -120.8597, id: 2 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not call the API outside SLO County, and says why", async () => {
    render(mount({ lat: 36.6777, lon: -121.6555, id: 1 }));
    expect(await screen.findByText("Parcel lines cover SLO County only for now.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies the same rule to his own latitude and longitude fields", async () => {
    render(mount(null));
    fireEvent.change(screen.getByLabelText("Parcel latitude"), { target: { value: "36.6777" } });
    fireEvent.change(screen.getByLabelText("Parcel longitude"), { target: { value: "-121.6555" } });
    fireEvent.click(screen.getByRole("button", { name: "Find at point" }));
    expect(await screen.findByText("Parcel lines cover SLO County only for now.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(onPoint).not.toHaveBeenCalled();
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
