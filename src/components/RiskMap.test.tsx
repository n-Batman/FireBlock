import { describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { MapContainer, useMap } from "react-leaflet";
import type { ParcelUnit } from "@/data/types";
import { scaleColor } from "@/lib/riskScale";
import { ParcelPolygons, ViewWatcher } from "./RiskMap";

const SQUARE = (lat: number, lng: number, d: number): [number, number][] => [
  [lat, lng],
  [lat, lng + d],
  [lat + d, lng + d],
  [lat + d, lng],
  [lat, lng],
];
const unit = (id: string, over: Partial<ParcelUnit> = {}): ParcelUnit => ({
  id,
  parts: [[SQUARE(35.63, -120.86, 0.004)]],
  acres: 30,
  center: [35.632, -120.858],
  score: null,
  ...over,
});
const high = { score: 78, level: "high" as const, source: { kind: "scan" as const, at: "2026-11-14T10:00:00-08:00", risks: 4, clears: 1 } };

/** Collects the polygons and markers on the map, so the test can look at the real Leaflet layers. */
function mount(parcels: ParcelUnit[], selectedId: string | null = null, onSelect: (id: string) => void = () => {}) {
  const seen = { polygons: [] as L.Polygon[], markers: [] as L.Marker[] };
  // react-leaflet adds layers in effects, so the probe reads them in its own effect, which runs after.
  function Probe() {
    const map = useMap();
    useEffect(() => {
      map.eachLayer((layer) => {
        if (layer instanceof L.Polygon) seen.polygons.push(layer);
        else if (layer instanceof L.Marker) seen.markers.push(layer);
      });
    }, [map]);
    return null;
  }
  render(
    <MapContainer center={[35.63, -120.86]} zoom={15} style={{ height: 400, width: 400 }}>
      <ParcelPolygons parcels={parcels} selectedId={selectedId} onSelect={onSelect} />
      <Probe />
    </MapContainer>,
  );
  return seen;
}
const interactive = (polys: L.Polygon[]) => polys.filter((p) => p.options.interactive !== false);
const color = (p: L.Polygon) => p.options.color;

describe("ViewWatcher", () => {
  it("reports the map view once, 400 ms after it stops moving", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onView = vi.fn();
    let map: L.Map | null = null;
    function Grab() {
      map = useMap();
      return null;
    }
    render(
      <MapContainer center={[35.63, -120.86]} zoom={15} style={{ height: 400, width: 400 }}>
        <ViewWatcher onView={onView} />
        <Grab />
      </MapContainer>,
    );
    expect(onView).toHaveBeenCalledTimes(1);
    onView.mockClear();
    act(() => {
      map!.fire("moveend");
      vi.advanceTimersByTime(300);
      map!.fire("moveend"); // moved again: the wait starts over
      vi.advanceTimersByTime(399);
    });
    expect(onView).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView.mock.calls[0][0]).toEqual({
      west: expect.any(Number),
      south: expect.any(Number),
      east: expect.any(Number),
      north: expect.any(Number),
      zoom: 15,
    });
    act(()=>{map!.fire('zoomend');});
    expect(onView).toHaveBeenCalledTimes(2); // zoom changes bypass the pan debounce
    vi.useRealTimers();
  });
});

describe("ParcelPolygons", () => {
  it("draws one clickable polygon per parcel", () => {
    const seen = mount([unit("a"), unit("b", { parts: [[SQUARE(35.64, -120.86, 0.004)]] })]);
    expect(interactive(seen.polygons)).toHaveLength(2);
  });

  it("hands Leaflet [lat, lng], so the first number of every point is a latitude", () => {
    const [poly] = interactive(mount([unit("a")]).polygons);
    // Leaflet nests it as polygon, then ring, then point.
    const first = (poly.getLatLngs() as L.LatLng[][][])[0][0][0];
    expect(first.lat).toBeCloseTo(35.63, 6);
    expect(first.lng).toBeCloseTo(-120.86, 6);
  });

  it("keeps every part and every hole of a MultiPolygon", () => {
    const multi = unit("m", {
      parts: [
        [SQUARE(35.63, -120.86, 0.04), SQUARE(35.64, -120.85, 0.01)], // outer ring with a hole
        [SQUARE(35.63, -120.8, 0.01)],
      ],
    });
    const [poly] = interactive(mount([multi]).polygons);
    const parts = poly.getLatLngs() as L.LatLng[][][];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(2); // outer + hole
    expect(parts[0][1][0].lat).toBeCloseTo(35.64, 6); // the hole, lat first
    expect(parts[1]).toHaveLength(1);
  });

  it("draws an unscored parcel as a neutral outline, not in a risk colour", () => {
    const [poly] = interactive(mount([unit("a")]).polygons);
    expect(color(poly)).toBe("#b7c5bc");
    expect(["#5db67f", "#e0a83a", "#e5675a"]).not.toContain(color(poly));
  });

  it("draws a scored parcel's outline and fill on Nick's 0 to 100 scale, so they match his fill and the pill", () => {
    const [poly] = interactive(mount([unit("a", { score: high })]).polygons); // 78
    expect(color(poly)).toBe(scaleColor(78));
    expect(poly.options.fillColor).toBe(scaleColor(78));
    expect(poly.options.weight).toBe(2);
    expect(poly.options.fillOpacity).toBe(0.15);
  });

  it("gives two scores two different colours, not one colour per level", () => {
    const seen = mount([
      unit("a", { score: { ...high, score: 40, level: "medium" } }),
      unit("b", { score: { ...high, score: 50, level: "medium" }, parts: [[SQUARE(35.64, -120.86, 0.004)]] }),
    ]);
    const [a, b] = interactive(seen.polygons);
    expect(color(a)).toBe(scaleColor(40));
    expect(color(b)).toBe(scaleColor(50));
    expect(color(a)).not.toBe(color(b));
  });

  it("gives the selected parcel the heavier casing and a glow, and fades the others", () => {
    const seen = mount([unit("a", { score: high }), unit("b", { parts: [[SQUARE(35.64, -120.86, 0.004)]] })], "a");
    const [a, b] = interactive(seen.polygons);
    expect(a.options.weight).toBe(4);
    expect(a.options.fillOpacity).toBe(0.22);
    expect(b.options.opacity).toBe(0.45);
    const glow = seen.polygons.find((p) => p.options.weight === 14);
    expect(glow).toBeDefined();
    expect(glow!.options.interactive).toBe(false);
    expect(glow!.options.color).toBe(scaleColor(78)); // the glow matches its parcel
  });

  it("calls onSelect with the parcel id when a parcel is clicked", () => {
    const onSelect = vi.fn();
    const [poly] = interactive(mount([unit("014-331-010")], null, onSelect).polygons);
    poly.fire("click");
    expect(onSelect).toHaveBeenCalledWith("014-331-010");
  });

  it("colours a parcel's score pill on Nick's 0 to 100 scale, so it matches his parcel fill", () => {
    const [marker] = mount([unit("a", { score: { ...high, score: 12, level: "low" } })]).markers;
    const html = (marker.options.icon as L.DivIcon).options.html as string;
    expect(html).toContain(`color:${scaleColor(12)}`);
    expect(html).toContain(`border-color:${scaleColor(12)}`);
    expect(html).toContain(">12<");
  });

  it("puts a score pill only on a scored parcel", () => {
    expect(mount([unit("a")]).markers).toHaveLength(0);
    expect(mount([unit("a", { score: high })]).markers).toHaveLength(1);
  });
});
