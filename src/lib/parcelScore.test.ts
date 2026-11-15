import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import area from "@turf/area";
import intersect from "@turf/intersect";
import { featureCollection, feature } from "@turf/helpers";
import type { Parcels } from "./parcels";
import type { ParcelScan, ParcelScore, ParcelUnit } from "@/data/types";
import { cellsFromRiskMap, scoreFromCells, scoreFromScans, scoreParcel, type RiskCell } from "./parcelScore";
import { toParcelUnits, toGeoJSON } from "./parcelUnits";
import { levelOf } from "./score";
import sloParcels from "./fixtures/sloParcels.json";

type Geometry = Parcels["features"][number]["geometry"];

const unitOf = (geometry: Geometry, id = "p1") =>
  toParcelUnits({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry, properties: { parcelId: id, source: "county", fetchedAt: "t" } }],
    metadata: { source: "county", truncated: false, limit: 200, fetchedAt: "t", note: "n" },
  })[0];
const square = (lon: number, lat: number, w: number, h = w) => [
  [lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat],
];
/** One grid cell as the risk-map generator writes it. */
const cellFeature = (id: string, ring: number[][], score: number | null) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [ring] },
  properties: { layer: "relative_risk", cell_id: id, risk_score: score, as_of: "2026-11-13T00:00:00Z", model_id: "m1" },
});
const cellsOf = (...features: ReturnType<typeof cellFeature>[]) => cellsFromRiskMap({ type: "FeatureCollection", features });

// A 0.002 degree parcel. Cells are wider and taller than it unless a test says otherwise.
const LON = -120.86;
const LAT = 35.63;
const parcel = () => unitOf({ type: "Polygon", coordinates: [square(LON, LAT, 0.002)] });
const band = (lon0: number, lon1: number) => square(lon0, LAT - 0.001, lon1 - lon0, 0.004);

describe("cellsFromRiskMap", () => {
  it("keeps the relative-risk cells, with their score, date and model", () => {
    const cells = cellsOf(cellFeature("r0c0", band(LON - 0.001, LON + 0.003), 42));
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ cellId: "r0c0", score: 42, asOf: "2026-11-13T00:00:00Z", modelId: "m1" });
  });

  it("keeps cells with no data as null so they are never read as a low score", () => {
    expect(cellsOf(cellFeature("r0c0", band(LON, LON + 0.002), null))[0].score).toBeNull();
  });

  it("ignores thermal detections and anything malformed", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [LON, LAT] }, properties: { layer: "thermal_detection" } },
        { type: "Feature", geometry: null, properties: { layer: "relative_risk", cell_id: "x", risk_score: 5 } },
        cellFeature("ok", band(LON, LON + 0.002), 10),
      ],
    };
    expect(cellsFromRiskMap(data).map((c) => c.cellId)).toEqual(["ok"]);
  });

  it("returns no cells for garbage", () => {
    expect(cellsFromRiskMap(null)).toEqual([]);
    expect(cellsFromRiskMap({})).toEqual([]);
    expect(cellsFromRiskMap("nope")).toEqual([]);
  });
});

describe("scoreFromCells: area-weighted mean of the overlapping cells", () => {
  it("weights each cell by how much of the parcel it covers", () => {
    // Cell A (20) covers the west quarter of the parcel, cell B (80) the other three quarters.
    const cells = cellsOf(
      cellFeature("a", band(LON - 0.0015, LON + 0.0005), 20),
      cellFeature("b", band(LON + 0.0005, LON + 0.0035), 80),
    );
    const score = scoreFromCells(parcel(), cells)!;
    expect(score.score).toBe(65); // 0.25 * 20 + 0.75 * 80
    expect(score.level).toBe("high");
    expect(score.source).toMatchObject({ kind: "risk-map", asOf: "2026-11-13T00:00:00Z", modelId: "m1" });
    expect((score.source as { coverage: number }).coverage).toBeCloseTo(1, 2);
  });

  it("is not the plain mean of the cells", () => {
    const cells = cellsOf(
      cellFeature("a", band(LON - 0.0015, LON + 0.0005), 20),
      cellFeature("b", band(LON + 0.0005, LON + 0.0035), 80),
    );
    expect(scoreFromCells(parcel(), cells)!.score).not.toBe(50);
  });

  it("skips cells with no data, and reports how much of the parcel the scored cells cover", () => {
    // Scored cell over the west 70%, a no-data cell over the east 30%.
    const cells = cellsOf(
      cellFeature("a", band(LON - 0.001, LON + 0.0014), 40),
      cellFeature("n", band(LON + 0.0014, LON + 0.003), null),
    );
    const score = scoreFromCells(parcel(), cells)!;
    expect(score.score).toBe(40);
    expect((score.source as { coverage: number }).coverage).toBeCloseTo(0.7, 2);
  });

  it("gives no score when scored cells cover less than 60% of the parcel, the same rule as Nick's display", () => {
    const cells = cellsOf(
      cellFeature("a", band(LON - 0.001, LON + 0.0011), 40), // 55% of the parcel
      cellFeature("n", band(LON + 0.0011, LON + 0.003), null),
    );
    expect(scoreFromCells(parcel(), cells)).toBeNull();
    // 40% is no better.
    expect(scoreFromCells(parcel(), cellsOf(cellFeature("a", band(LON - 0.001, LON + 0.0008), 40)))).toBeNull();
  });

  it("gives no score when no cell touches the parcel", () => {
    expect(scoreFromCells(parcel(), cellsOf(cellFeature("far", band(LON + 0.01, LON + 0.012), 70)))).toBeNull();
    expect(scoreFromCells(parcel(), [])).toBeNull();
  });

  it("ignores edge-only contact without changing the first contributing source", () => {
    const cells = cellsOf(
      cellFeature("edge", band(LON - 0.002, LON), 90),
      cellFeature("inside", band(LON, LON + 0.002), 30),
    );
    cells[0].modelId = "edge-only";
    const score = scoreFromCells(parcel(), cells)!;
    expect(score.score).toBe(30);
    expect(score.source).toMatchObject({ kind: "risk-map", modelId: "m1", coverage: 1 });
  });

  it("keeps shoelace coverage independent of ring winding and repeated closure", () => {
    const unit = parcel();
    const cells = cellsOf(cellFeature("a", band(LON, LON + 0.0014), 40));
    const expected = scoreFromCells(unit, cells);
    unit.parts[0][0] = unit.parts[0][0].slice(0, -1).reverse();
    expect(scoreFromCells(unit, cells)).toEqual(expected);
  });

  it("does not count a cell that sits in a hole of the parcel", () => {
    const withHole = unitOf({ type: "Polygon", coordinates: [square(LON, LAT, 0.004), square(LON + 0.001, LAT + 0.001, 0.002)] });
    const cells = cellsOf(
      cellFeature("hole", square(LON + 0.001, LAT + 0.001, 0.002), 90), // exactly the hole
      cellFeature("all", square(LON - 0.001, LAT - 0.001, 0.006), 30),
    );
    const score = scoreFromCells(withHole, cells)!;
    expect(score.score).toBe(30); // a hole counted in would pull it above 30
    expect((score.source as { coverage: number }).coverage).toBeCloseTo(1, 2);
  });

  it("handles a MultiPolygon: a cell over two of three equal parts covers two thirds", () => {
    const parts = [0, 0.01, 0.02].map((dx) => [square(LON + dx, LAT, 0.002)]);
    const multi = unitOf({ type: "MultiPolygon", coordinates: parts });
    // One cell wide enough to cover the first two parts only.
    const score = scoreFromCells(multi, cellsOf(cellFeature("a", square(LON - 0.001, LAT - 0.001, 0.0145, 0.004), 55)))!;
    expect(score.score).toBe(55);
    expect((score.source as { coverage: number }).coverage).toBeCloseTo(2 / 3, 2);
  });

  it("gives a MultiPolygon no score when the cell covers only one of two parts", () => {
    const multi = unitOf({ type: "MultiPolygon", coordinates: [[square(LON, LAT, 0.002)], [square(LON + 0.01, LAT, 0.002)]] });
    expect(scoreFromCells(multi, cellsOf(cellFeature("a", square(LON - 0.001, LAT - 0.001, 0.004), 55)))).toBeNull();
  });
});

/** The original Turf implementation, kept in the test as an independent reference. */
function turfScoreFromCells(unit: ParcelUnit, cells: RiskCell[]): ParcelScore | null {
  const geometry = toGeoJSON(unit);
  const parcelArea = area(geometry);
  if (!(parcelArea > 0)) return null;
  const lons = unit.parts.flatMap(rings => rings[0].map(p => p[1]));
  const lats = unit.parts.flatMap(rings => rings[0].map(p => p[0]));
  const [w, s, e, n] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  let weighted = 0;
  let covered = 0;
  let first: RiskCell | null = null;
  for (const cell of cells) {
    if (cell.score === null) continue;
    if (cell.bbox[2] < w || cell.bbox[0] > e || cell.bbox[3] < s || cell.bbox[1] > n) continue;
    const shared = intersect(featureCollection([feature(geometry), feature(cell.geometry)]));
    const overlap = shared ? area(shared) : 0;
    if (overlap <= 0) continue;
    weighted += overlap * cell.score;
    covered += overlap;
    first ??= cell;
  }
  const coverage = Math.min(1, covered / parcelArea);
  if (!first || covered === 0 || coverage < 0.6) return null;
  const score = Math.round(weighted / covered);
  return { score, level: levelOf(score), source: { kind: "risk-map", asOf: first.asOf, modelId: first.modelId, coverage } };
}

describe("real SLO parcels against the published rectangular risk map", () => {
  const parcels = sloParcels as ParcelUnit[];
  const cells = cellsFromRiskMap(JSON.parse(readFileSync("public/data/risk_map.geojson", "utf8")));

  it("includes 40 parcels, a real hole and a MultiPolygon built from two real parcels", () => {
    expect(parcels).toHaveLength(40);
    expect(parcels.find(p => p.id === "003-501-013")!.parts.some(part => part.length > 1)).toBe(true);
    const multi = parcels.find(p => p.id === "multipart:002-509-009+002-509-014")!;
    expect(multi.parts).toEqual([parcels.find(p => p.id === "002-509-009")!.parts[0], parcels.find(p => p.id === "002-509-014")!.parts[0]]);
    expect(cells).toHaveLength(1476);
    for (const cell of cells) {
      const [w, s, e, n] = cell.bbox;
      expect(cell.geometry.coordinates).toHaveLength(1);
      const ring = cell.geometry.coordinates[0];
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[4]);
      expect(new Set(ring.slice(0, 4).map(p => p.join(",")))).toEqual(new Set([[w,s],[e,s],[e,n],[w,n]].map(p => p.join(","))));
    }
  });

  it.each(parcels)("matches Turf coverage within 1% and the score, level and provenance for $id", parcel => {
    const expected = turfScoreFromCells(parcel, cells);
    const actual = scoreFromCells(parcel, cells);
    // The fixture is within scored SLO coverage, including its hole and multipart cases.
    expect(expected).not.toBeNull();
    expect(actual).not.toBeNull();
    if (expected?.source.kind !== "risk-map" || actual?.source.kind !== "risk-map") throw new Error("Expected risk-map scores");
    expect(Math.abs(actual.source.coverage - expected.source.coverage) / expected.source.coverage).toBeLessThan(0.01);
    // Coverage is the permitted approximation; all other return fields are identical.
    expect(actual).toEqual({ ...expected, source: { ...expected.source, coverage: actual.source.coverage } });
  });

  it("logs old Turf vs new clipping milliseconds for all 40 parcels", () => {
    const measure = (score: typeof scoreFromCells) => {
      parcels.forEach(parcel => score(parcel, cells)); // Warm both implementations.
      const times: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        const results = parcels.map(parcel => score(parcel, cells));
        times.push(performance.now() - start);
        expect(results).toHaveLength(40);
      }
      return times.sort((a, b) => a - b)[2];
    };
    const oldMs = measure(turfScoreFromCells);
    const newMs = measure(scoreFromCells);
    process.stdout.write(`40 SLO parcels, 1476 cells (median of 5 warm runs): old Turf ${oldMs.toFixed(2)} ms; new clipping ${newMs.toFixed(2)} ms\n`);
    // Timings are reported, not a flaky machine-dependent pass/fail threshold.
    expect(Number.isFinite(oldMs) && Number.isFinite(newMs)).toBe(true);
  });
});

describe("scoreFromScans: an AI scan saved inside the parcel", () => {
  const scan = (over: Partial<ParcelScan> = {}): ParcelScan => ({
    lat: LAT + 0.001,
    lon: LON + 0.001,
    risks: 3,
    clears: 1,
    at: "2026-11-14T10:00:00-08:00",
    ...over,
  });

  it("scores the share of scanned areas that were flagged, and says it came from the scan", () => {
    const score = scoreFromScans(parcel(), [scan()])!;
    expect(score.score).toBe(75); // 3 of 4
    expect(score.level).toBe("high");
    expect(score.source).toEqual({ kind: "scan", at: "2026-11-14T10:00:00-08:00", risks: 3, clears: 1 });
  });

  it("ignores a scan whose GPS is outside the parcel", () => {
    expect(scoreFromScans(parcel(), [scan({ lat: LAT + 0.01 })])).toBeNull();
  });

  it("ignores a scan whose GPS is inside a hole of the parcel", () => {
    const withHole = unitOf({ type: "Polygon", coordinates: [square(LON, LAT, 0.004), square(LON + 0.001, LAT + 0.001, 0.002)] });
    expect(scoreFromScans(withHole, [scan({ lat: LAT + 0.002, lon: LON + 0.002 })])).toBeNull();
    expect(scoreFromScans(withHole, [scan({ lat: LAT + 0.0005, lon: LON + 0.0005 })])).not.toBeNull();
  });

  it("uses the newest scan when there are several inside", () => {
    const old = scan({ risks: 4, clears: 0, at: "2026-11-10T10:00:00-08:00" });
    const recent = scan({ risks: 0, clears: 4, at: "2026-11-14T10:00:00-08:00" });
    expect(scoreFromScans(parcel(), [recent, old])!.score).toBe(0);
  });

  it("ignores a scan that found nothing either way", () => {
    expect(scoreFromScans(parcel(), [scan({ risks: 0, clears: 0 })])).toBeNull();
  });

  it("finds a scan inside any part of a MultiPolygon", () => {
    const multi = unitOf({ type: "MultiPolygon", coordinates: [[square(LON, LAT, 0.002)], [square(LON + 0.01, LAT, 0.002)]] });
    expect(scoreFromScans(multi, [scan({ lon: LON + 0.011 })])).not.toBeNull();
  });
});

describe("scoreParcel: the unscored state and the order of sources", () => {
  const cells = () => cellsOf(cellFeature("a", band(LON - 0.001, LON + 0.003), 30));
  const scan: ParcelScan = { lat: LAT + 0.001, lon: LON + 0.001, risks: 2, clears: 2, at: "2026-11-14T10:00:00-08:00" };

  it("is null, never a guess, when there is no scan and no risk map", () => {
    expect(scoreParcel(parcel(), [], [])).toBeNull();
  });

  it("uses the risk map when there is no scan inside the parcel", () => {
    expect(scoreParcel(parcel(), [], cells())!.source.kind).toBe("risk-map");
  });

  it("prefers the scan over the risk map and names the scan as the source", () => {
    const score = scoreParcel(parcel(), [scan], cells())!;
    expect(score.source.kind).toBe("scan");
    expect(score.score).toBe(50);
  });
});
