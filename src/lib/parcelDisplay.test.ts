import { describe, expect, it } from "vitest";
import type { ParcelUnit } from "@/data/types";
import { parcelDisplay } from "./parcelDisplay";

// Fixture coordinates sit inside the same 192 m Mercator cell near downtown SLO.
const R = 6378137;
const project = (lat: number, lon: number) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const xy = project(35.28, -120.66).map(v => Math.floor(v / 192) * 192);
const ll = (x: number, y: number): [number, number] => [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI];
function lot(id: string, offset = 0, acres = .1, value: number | null = 20): ParcelUnit {
  const x = xy[0] + 20 + offset, y = xy[1] + 20;
  return { id, acres, center: ll(x + 5, y + 5),
    parts: [[[ll(x, y), ll(x + 10, y), ll(x + 10, y + 10), ll(x, y + 10), ll(x, y)]]],
    score: value === null ? null : { score: value, level: "low", source: { kind: "risk-map", modelId: "test", asOf: "2026-11-14", coverage: 1 } },
  };
}
const lots = () => [lot("a"), lot("b", 20), lot("c", 40), lot("d", 60)];

describe("parcelDisplay", () => {
  it("reduces dense small lots to one display tile and restores the exact original units at zoom 17", () => {
    const parcels = lots();
    const before = JSON.stringify(parcels);
    const out = parcelDisplay(parcels, 16);
    expect(out.individuals).toHaveLength(0);
    expect(out.areas).toHaveLength(1);
    expect(out.areas[0]).toMatchObject({ count: 4, scoredCount: 4, score: 20, coverage: 1 });
    expect(out.areas[0].ring).toHaveLength(5);
    expect(parcelDisplay(parcels, 17)).toEqual({ individuals: parcels, areas: [] });
    expect(parcelDisplay(parcels, 18).individuals).toBe(parcels);
    expect(JSON.stringify(parcels)).toBe(before);
  });
  it("keeps the selected parcel individually selectable and its original score intact", () => {
    const parcels = lots();
    const out = parcelDisplay(parcels, 16, "b");
    expect(out.individuals).toEqual([parcels[1]]);
    expect(out.individuals[0]).toBe(parcels[1]);
    expect(out.areas[0].count).toBe(3);
  });
  it("does not group sparse lots, farms or lots crossing a tile boundary", () => {
    expect(parcelDisplay(lots().slice(0, 2), 16).areas).toHaveLength(0);
    const farm = lot("farm", 0, 30);
    const crossing = lot("long");
    crossing.parts[0][0][1] = ll(xy[0] + 300, xy[1] + 20);
    const out = parcelDisplay([...lots(), farm, crossing], 16);
    expect(out.individuals).toEqual([farm, crossing]);
    expect(out.areas[0].count).toBe(4);
  });
  it("weights by parcel area and reports missing ratings without substituting zero", () => {
    const out = parcelDisplay([lot("a", 0, .3, 80), lot("b", 20, .1, 20), lot("c", 40, .1, null)], 16);
    expect(out.areas[0]).toMatchObject({ count: 3, scoredCount: 2, score: 65, coverage: .8 });
    expect(parcelDisplay([lot("a", 0, .1, 80), lot("b", 20, .4, null), lot("c", 40, .1, null)], 16).areas[0].score).toBeNull();
    expect(parcelDisplay(lots().map(p => ({ ...p, score: null })), 16).areas[0]).toMatchObject({ score: null, scoredCount: 0, coverage: 0 });
  });
  it("uses stable cells independent of input order and has separate geographic buckets", () => {
    expect(parcelDisplay(lots(), 16).areas).toEqual(parcelDisplay(lots().reverse(), 16).areas);
    const shift = 192 * 5 / R * 180 / Math.PI;
    const remote = lots().map(p => ({ ...p, id: `remote-${p.id}`, center: [p.center[0], p.center[1] + shift] as [number, number],
      parts: p.parts.map(part => part.map(ring => ring.map(([lat, lon]) => [lat, lon + shift] as [number, number]))) }));
    expect(parcelDisplay([...lots(), ...remote], 16).areas).toHaveLength(2);
  });
  it("retains no prior place, selection, or scan score when called with new evidence", () => {
    const parcels = lots();
    expect(parcelDisplay(parcels, 16).areas[0].score).toBe(20);
    expect(parcelDisplay(parcels.map(p => ({ ...p, score: { ...p.score!, score: 90 } })), 16).areas[0].score).toBe(90);
    expect(parcelDisplay([], 16)).toEqual({ individuals: [], areas: [] });
    expect(parcelDisplay(parcels, Number.NaN).areas).toEqual([]);
  });
});
