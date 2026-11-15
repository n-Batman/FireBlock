import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Polygon } from "geojson";
import type { ParcelScan, ParcelScore, ParcelUnit } from "@/data/types";
import { levelOf } from "./score";
import { toGeoJSON } from "./parcelUnits";

/** Scored cells must cover at least this share of a parcel, or it stays unscored. Same cutoff as Nick's display (docs/parcel-risk-display.md). */
const MIN_COVERAGE = 0.6;

/** One grid cell of risk_map.geojson. A null score means no data, which is not a low score. */
export interface RiskCell {
  cellId: string;
  score: number | null;
  asOf: string;
  modelId: string;
  geometry: Polygon;
  /** [west, south, east, north], to skip cells far from a parcel. */
  bbox: [number, number, number, number];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Reads the cells out of a risk_map.geojson. Thermal detections and anything malformed are left out. */
export function cellsFromRiskMap(data: unknown): RiskCell[] {
  if (!isObject(data) || !Array.isArray(data.features)) return [];
  const cells: RiskCell[] = [];
  for (const f of data.features as unknown[]) {
    if (!isObject(f) || !isObject(f.properties) || !isObject(f.geometry)) continue;
    const p = f.properties;
    const g = f.geometry as { type?: unknown; coordinates?: unknown };
    if (p.layer !== "relative_risk" || typeof p.cell_id !== "string") continue;
    if (g.type !== "Polygon" || !Array.isArray(g.coordinates) || !Array.isArray(g.coordinates[0])) continue;
    const score = p.risk_score;
    if (score !== null && !(typeof score === "number" && Number.isFinite(score))) continue;
    const ring = g.coordinates[0] as number[][];
    const lons = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    cells.push({
      cellId: p.cell_id,
      score,
      asOf: typeof p.as_of === "string" ? p.as_of : "",
      modelId: typeof p.model_id === "string" ? p.model_id : "",
      geometry: g as unknown as Polygon,
      bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    });
  }
  return cells;
}

const scoreOfValue = (score: number) => ({ score, level: levelOf(score) });

type XY = [number, number];

/** Shoelace with a local origin to preserve precision for small parcels. */
function ringArea(ring: XY[]): number {
  if (ring.length < 3) return 0;
  const [x, y] = ring[0];
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - x) * (ring[i][1] - y) - (ring[i][0] - x) * (ring[j][1] - y);
  }
  return Math.abs(sum) / 2;
}

/** Sutherland-Hodgman clipping against the four axis-aligned cell edges. */
function clipRing(ring: XY[], box: RiskCell["bbox"]): XY[] {
  let clipped = ring;
  for (let edge = 0; edge < 4 && clipped.length; edge++) {
    const axis = edge % 2;
    const boundary = box[edge];
    const inside = (p: XY) => edge < 2 ? p[axis] >= boundary : p[axis] <= boundary;
    const input = clipped;
    clipped = [];
    let previous = input[input.length - 1];
    let previousInside = inside(previous);
    for (const current of input) {
      const currentInside = inside(current);
      if (currentInside !== previousInside) {
        const t = (boundary - previous[axis]) / (current[axis] - previous[axis]);
        clipped.push(axis === 0
          ? [boundary, previous[1] + t * (current[1] - previous[1])]
          : [previous[0] + t * (current[0] - previous[0]), boundary]);
      }
      if (currentInside) clipped.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  return clipped;
}

const partArea = (rings: XY[][]) => ringArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);

/**
 * Area-weighted mean of the risk-map cells that overlap the parcel. Cells with no data are skipped.
 * No score when scored cells cover under 60% of the parcel.
 */
export function scoreFromCells(unit: ParcelUnit, cells: RiskCell[]): ParcelScore | null {
  const lons = unit.parts.flatMap((rings) => rings[0].map((p) => p[1]));
  const lats = unit.parts.flatMap((rings) => rings[0].map((p) => p[0]));
  const [w, s, e, n] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  const scale = Math.cos(((s + n) / 2) * Math.PI / 180);
  const parts = unit.parts.map(rings => rings.map(ring => ring.map(([lat, lon]): XY => [lon * scale, lat])));
  const parcelArea = parts.reduce((sum, rings) => sum + partArea(rings), 0);
  if (!(parcelArea > 0)) return null;

  let weighted = 0;
  let covered = 0;
  let first: RiskCell | null = null;
  for (const cell of cells) {
    if (cell.score === null) continue;
    if (cell.bbox[2] < w || cell.bbox[0] > e || cell.bbox[3] < s || cell.bbox[1] > n) continue;
    const box: RiskCell["bbox"] = [cell.bbox[0] * scale, cell.bbox[1], cell.bbox[2] * scale, cell.bbox[3]];
    const overlap = parts.reduce((sum, rings) => sum + Math.max(0, partArea(rings.map(ring => clipRing(ring, box)))), 0);
    if (overlap <= 0) continue;
    weighted += overlap * cell.score;
    covered += overlap;
    first ??= cell;
  }
  const coverage = Math.min(1, covered / parcelArea);
  if (!first || covered === 0 || coverage < MIN_COVERAGE) return null;
  return {
    ...scoreOfValue(Math.round(weighted / covered)),
    source: { kind: "risk-map", asOf: first.asOf, modelId: first.modelId, coverage },
  };
}

/** The scans with something rated that were saved inside the parcel, newest first. */
function scansInside(unit: ParcelUnit, scans: ParcelScan[]): ParcelScan[] {
  const geometry = toGeoJSON(unit);
  return scans
    .filter((s) => s.risks + s.clears > 0 && booleanPointInPolygon(point([s.lon, s.lat]), geometry))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const percent = (s: ParcelScan) => Math.round((100 * s.risks) / (s.risks + s.clears));

/** The share of scanned areas flagged as a risk, from the newest scan saved inside the parcel. */
export function scoreFromScans(unit: ParcelUnit, scans: ParcelScan[]): ParcelScore | null {
  const scan = scansInside(unit, scans)[0];
  if (!scan) return null;
  return {
    ...scoreOfValue(percent(scan)),
    source: { kind: "scan", at: scan.at, risks: scan.risks, clears: scan.clears },
  };
}

/** One end of a before/after: the scan's score and when it was saved. */
export interface ScanPoint {
  score: number;
  at: string;
}

/**
 * The first and the newest scan saved inside the parcel, from the same scans `scoreFromScans` reads. Scans at or before
 * `since` (the parcel's reset marker) are ignored. Null until there are two. Scores are dry-fuel percents, and `improvement`
 * is before minus after in points (positive = less dry fuel), the same convention as the backend archive's comparison
 * (docs/parcel-scan-archive.md), which the browser cannot read: it needs the server's token.
 */
export function beforeAfter(unit: ParcelUnit, scans: ParcelScan[], since?: string | null): { before: ScanPoint; after: ScanPoint; improvement: number } | null {
  const floor = since ? Date.parse(since) : -Infinity;
  const inside = scansInside(unit, scans).filter((s) => Date.parse(s.at) > floor);
  if (inside.length < 2) return null;
  const point = (s: ParcelScan): ScanPoint => ({ score: percent(s), at: s.at });
  const [before, after] = [point(inside[inside.length - 1]), point(inside[0])];
  return { before, after, improvement: before.score - after.score };
}

/** A scan saved inside the parcel wins over the risk map. With neither, there is no score. */
export function scoreParcel(unit: ParcelUnit, scans: ParcelScan[], cells: RiskCell[]): ParcelScore | null {
  return scoreFromScans(unit, scans) ?? scoreFromCells(unit, cells);
}
