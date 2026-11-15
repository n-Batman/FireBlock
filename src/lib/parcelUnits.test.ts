import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Parcels } from "./parcels";
import { labelPoint, pointInPolygon } from "./geo";
import { toGeoJSON, toParcelUnits } from "./parcelUnits";

vi.mock("./geo", async importOriginal => {
  const actual = await importOriginal<typeof import("./geo")>();
  return { ...actual, labelPoint: vi.fn(actual.labelPoint) };
});
beforeEach(() => { vi.mocked(labelPoint).mockClear(); });

type Geometry = Parcels["features"][number]["geometry"];

const feature = (id: string, geometry: Geometry) => ({
  type: "Feature" as const,
  geometry,
  properties: { parcelId: id, source: "county", fetchedAt: "2026-11-14T00:00:00Z" },
});
const collection = (...features: ReturnType<typeof feature>[]): Parcels => ({
  type: "FeatureCollection",
  features,
  metadata: { source: "county", truncated: false, limit: 200, fetchedAt: "t", note: "n" },
});
/** A closed GeoJSON ring, [lon, lat], west-south corner first. */
const square = (lon: number, lat: number, w: number, h = w) => [
  [lon, lat],
  [lon + w, lat],
  [lon + w, lat + h],
  [lon, lat + h],
  [lon, lat],
];

describe("toParcelUnits: GeoJSON [lon, lat] becomes Leaflet [lat, lng]", () => {
  it("puts latitude first, and keeps the vertex order", () => {
    const [unit] = toParcelUnits(collection(feature("014-331-010", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.01)] })));
    const ring = unit.parts[0][0];
    expect(ring[0]).toEqual([35.63, -120.86]);
    expect(ring[1]).toEqual([35.63, -120.85]);
    expect(ring[2]).toEqual([35.64, -120.85]);
    // Every point reads as a Paso Robles latitude first, not a longitude first.
    for (const [lat, lng] of ring) {
      expect(lat).toBeGreaterThan(35);
      expect(lng).toBeLessThan(-120);
    }
  });

  it("keeps the parcel id and starts with no score", () => {
    const [unit] = toParcelUnits(collection(feature("014-331-010", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.01)] })));
    expect(unit.id).toBe("014-331-010");
    expect(unit.score).toBeNull();
  });

  it("returns nothing for an empty collection", () => {
    expect(toParcelUnits(collection())).toEqual([]);
  });
});

describe("MultiPolygon with a hole", () => {
  const multi: Geometry = {
    type: "MultiPolygon",
    coordinates: [
      [square(-120.86, 35.63, 0.04), square(-120.85, 35.64, 0.01)], // part one: outer ring and a hole
      [square(-120.8, 35.63, 0.01)], // part two
    ],
  };

  it("keeps every part and every hole, flipped", () => {
    const [unit] = toParcelUnits(collection(feature("m1", multi)));
    expect(unit.parts).toHaveLength(2);
    expect(unit.parts[0]).toHaveLength(2); // outer + hole
    expect(unit.parts[1]).toHaveLength(1);
    expect(unit.parts[0][1][0]).toEqual([35.64, -120.85]); // the hole's first vertex, lat first
  });

  it("measures acres without the hole", () => {
    const withHole = toParcelUnits(collection(feature("a", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.04), square(-120.85, 35.64, 0.01)] })))[0];
    const solid = toParcelUnits(collection(feature("b", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.04)] })))[0];
    // The hole is 1/16 of the outer square.
    expect(withHole.acres / solid.acres).toBeCloseTo(15 / 16, 2);
  });

  it("adds up the parts", () => {
    const [unit] = toParcelUnits(collection(feature("m1", multi)));
    const one = toParcelUnits(collection(feature("x", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.04), square(-120.85, 35.64, 0.01)] })))[0];
    const two = toParcelUnits(collection(feature("y", { type: "Polygon", coordinates: [square(-120.8, 35.63, 0.01)] })))[0];
    expect(unit.acres).toBeCloseTo(one.acres + two.acres, 3);
  });

  it("round-trips back to the same GeoJSON, longitude first", () => {
    const [unit] = toParcelUnits(collection(feature("m1", multi)));
    expect(toGeoJSON(unit)).toEqual(multi);
    const poly: Geometry = { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.01)] };
    expect(toGeoJSON(toParcelUnits(collection(feature("p", poly)))[0])).toEqual(poly);
  });
});

describe("acres", () => {
  it("computes about 248 acres for a 1 km square at Paso Robles latitude", () => {
    const [unit] = toParcelUnits(collection(feature("k", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.01)] })));
    // 0.01 degrees is about 1112 m north-south and 904 m east-west here.
    expect(Math.abs(unit.acres - 248.3) / 248.3).toBeLessThan(0.01);
  });
});

describe("parcel center cache", () => {
  const geometry: Geometry = { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.01)] };
  it("reuses centers across cloned responses without sharing mutable center arrays", () => {
    const input = collection(feature("cached-response", geometry));
    const first = toParcelUnits(input)[0];
    const center = [...first.center];
    first.center[0] = 0;
    const second = toParcelUnits(JSON.parse(JSON.stringify(input)))[0];
    expect(second.center).toEqual(center);
    expect(second.center).not.toBe(first.center);
    expect(labelPoint).toHaveBeenCalledTimes(1);
  });
  it("misses for different IDs, ring lengths, holes and multipart structure", () => {
    toParcelUnits(collection(feature("cache-key-a", geometry), feature("cache-key-b", geometry)));
    const ring = geometry.coordinates[0];
    const longer: Geometry = { type: "Polygon", coordinates: [[ring[0], [-120.855, 35.63], ...ring.slice(1)]] };
    toParcelUnits(collection(feature("cache-key-a", longer)));
    toParcelUnits(collection(feature("cache-key-a", { type: "Polygon", coordinates: [ring, square(-120.858, 35.632, 0.002)] })));
    toParcelUnits(collection(feature("cache-key-a", { type: "MultiPolygon", coordinates: [[ring], [square(-120.8, 35.63, 0.01)]] })));
    expect(labelPoint).toHaveBeenCalledTimes(5);
  });
  it("evicts the least recently used center after 256 entries", () => {
    const read = (id: string) => toParcelUnits(collection(feature(id, geometry)));
    for (let i = 0; i < 256; i++) read(`bounded-${i}`);
    vi.mocked(labelPoint).mockClear();
    read("bounded-0"); // Retain this entry while bounded-1 becomes the oldest.
    read("bounded-new");
    read("bounded-0");
    expect(labelPoint).toHaveBeenCalledTimes(1);
    read("bounded-1");
    expect(labelPoint).toHaveBeenCalledTimes(2);
  });
});

describe("label point", () => {
  it("is inside a concave parcel", () => {
    // A C shape: the middle of its bounding box is in the notch, outside the parcel.
    const c = [
      [-120.86, 35.63], [-120.84, 35.63], [-120.84, 35.632], [-120.858, 35.632],
      [-120.858, 35.638], [-120.84, 35.638], [-120.84, 35.64], [-120.86, 35.64], [-120.86, 35.63],
    ];
    const [unit] = toParcelUnits(collection(feature("c", { type: "Polygon", coordinates: [c] })));
    expect(pointInPolygon(unit.center, unit.parts[0][0])).toBe(true);
  });

  it("stays out of a hole in the middle of the parcel", () => {
    const [unit] = toParcelUnits(collection(feature("d", { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.04), square(-120.85, 35.64, 0.02)] })));
    const [outer, hole] = unit.parts[0];
    expect(pointInPolygon(unit.center, outer)).toBe(true);
    expect(pointInPolygon(unit.center, hole)).toBe(false);
  });
});
