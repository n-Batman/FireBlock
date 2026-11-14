import area from "@turf/area";
import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { gridOutsideParcels } from "./gridCoverage";

const square = (lon: number, lat: number, w: number, h = w): Polygon => ({
  type: "Polygon",
  coordinates: [[[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]],
});
const cell = (id: string, lon: number, lat: number) => ({
  type: "Feature" as const,
  geometry: square(lon, lat, 2),
  properties: { cell_id: id, risk_score: 10 },
});
const grid = (...features: ReturnType<typeof cell>[]) => ({ type: "FeatureCollection" as const, features });

describe("gridOutsideParcels", () => {
  it("drops a cell a parcel covers, trims one it half covers, and keeps an untouched one as is", () => {
    const g = grid(cell("a", 0, 0), cell("b", 10, 10), cell("c", 20, 20));
    const parcels = [square(-1, -1, 4), square(9, 9, 2, 4)]; // covers all of a, the west half of b
    const out = gridOutsideParcels(g as never, parcels);

    expect(out.features.map((f) => f.properties.cell_id)).toEqual(["b", "c"]);
    const b = out.features[0];
    expect(area(b) / area(g.features[1])).toBeCloseTo(0.5, 1);
    expect(out.features[1].geometry).toEqual(g.features[2].geometry);
    expect(b.properties).toEqual(g.features[1].properties); // the score and id are kept
  });

  it("returns the grid unchanged when no parcel is on the map", () => {
    const g = grid(cell("a", 0, 0));
    expect(gridOutsideParcels(g as never, []).features).toHaveLength(1);
  });
});
