import { describe, it, expect } from "vitest";
import { boundsOfPolygon, labelPoint, pointInPolygon, type LatLng } from "./geo";
import { properties } from "@/data/properties";

// Shapes are drawn on a grid and placed near San Luis Obispo (1 grid unit = 0.001 degrees).
const at = (pts: [number, number][]): LatLng[] => pts.map(([x, y]) => [35 + y * 0.001, -120 + x * 0.001]);
const rect = at([[0, 0], [4, 0], [4, 2], [0, 2]]);
const lShape = at([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]);
const uShape = at([[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]]);
const triangle = at([[0, 0], [4, 0], [2, 3]]);

describe("pointInPolygon", () => {
  it("tells inside from outside, including for a concave shape", () => {
    expect(pointInPolygon([35.001, -119.998], rect)).toBe(true);
    expect(pointInPolygon([35.005, -119.998], rect)).toBe(false);
    // The notch of the U is outside the U.
    expect(pointInPolygon([35.002, -119.9985], uShape)).toBe(false);
    expect(pointInPolygon([35.002, -119.9995], uShape)).toBe(true);
  });
});

describe("labelPoint", () => {
  it("sits near the middle of a rectangle", () => {
    const [lat, lng] = labelPoint(rect);
    expect(lat).toBeCloseTo(35.001, 4);
    expect(Math.abs(lng - -119.998)).toBeLessThan(0.0011);
  });

  it("stays inside an L shape, a U shape and a triangle", () => {
    for (const shape of [lShape, uShape, triangle]) {
      const p = labelPoint(shape);
      expect(pointInPolygon(p, shape)).toBe(true);
    }
  });

  it("does not use the centroid when the centroid falls outside the shape", () => {
    // The centroid of this U lies in its notch.
    expect(pointInPolygon([35 + 1.357 * 0.001, -120 + 1.5 * 0.001], uShape)).toBe(false);
    expect(pointInPolygon(labelPoint(uShape), uShape)).toBe(true);
  });

  it("gives the same answer whether or not the ring repeats its first point", () => {
    expect(labelPoint([...rect, rect[0]])).toEqual(labelPoint(rect));
  });

  it("lands inside every block outline in the demo data", () => {
    for (const p of properties)
      for (const b of p.blocks) expect(pointInPolygon(labelPoint(b.polygon), b.polygon)).toBe(true);
  });
});

describe("boundsOfPolygon", () => {
  it("returns the south-west and north-east corners", () => {
    const [[south, west], [north, east]] = boundsOfPolygon(rect);
    expect(south).toBeCloseTo(35, 6);
    expect(west).toBeCloseTo(-120, 6);
    expect(north).toBeCloseTo(35.002, 6);
    expect(east).toBeCloseTo(-119.996, 6);
  });
});
