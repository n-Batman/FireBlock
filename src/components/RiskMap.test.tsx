import { describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { useEffect } from "react";
import { render } from "@testing-library/react";
import { MapContainer, useMap } from "react-leaflet";
import type { ParcelUnit } from "@/data/types";
import { scaleColor } from "@/lib/riskScale";
import { ParcelPolygons } from "./RiskMap";

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

  it("colours a scored parcel with its risk colour, as the sample blocks are", () => {
    const [poly] = interactive(mount([unit("a", { score: high })]).polygons);
    expect(color(poly)).toBe("#e5675a");
    expect(poly.options.weight).toBe(2);
    expect(poly.options.fillOpacity).toBe(0.15);
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
