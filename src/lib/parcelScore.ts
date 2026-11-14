import area from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { featureCollection, feature, point } from "@turf/helpers";
import intersect from "@turf/intersect";
import type { Polygon } from "geojson";
import type { ParcelScan, ParcelScore, ParcelUnit } from "@/data/types";
import type { Fetcher } from "./geocode";
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

/** Reads public/data/risk_map.geojson. A missing or unreadable file means no cells, never an error. */
export async function loadRiskCells(fetcher: Fetcher = fetch): Promise<RiskCell[]> {
  try {
    const res = await fetcher("/data/risk_map.geojson");
    return res.ok ? cellsFromRiskMap(await res.json()) : [];
  } catch {
    return [];
  }
}

const scoreOfValue = (score: number) => ({ score, level: levelOf(score) });

/**
 * Area-weighted mean of the risk-map cells that overlap the parcel. Cells with no data are skipped.
 * No score when scored cells cover under 60% of the parcel.
 */
export function scoreFromCells(unit: ParcelUnit, cells: RiskCell[]): ParcelScore | null {
  const geometry = toGeoJSON(unit);
  const parcelArea = area(geometry);
  if (!(parcelArea > 0)) return null;
  const lons = unit.parts.flatMap((rings) => rings[0].map((p) => p[1]));
  const lats = unit.parts.flatMap((rings) => rings[0].map((p) => p[0]));
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
  if (!first || covered === 0 || coverage < MIN_COVERAGE) return null;
  return {
    ...scoreOfValue(Math.round(weighted / covered)),
    source: { kind: "risk-map", asOf: first.asOf, modelId: first.modelId, coverage },
  };
}

/** The share of scanned areas flagged as a risk, from the newest scan saved inside the parcel. */
export function scoreFromScans(unit: ParcelUnit, scans: ParcelScan[]): ParcelScore | null {
  const geometry = toGeoJSON(unit);
  const inside = scans
    .filter((s) => s.risks + s.clears > 0 && booleanPointInPolygon(point([s.lon, s.lat]), geometry))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const scan = inside[0];
  if (!scan) return null;
  return {
    ...scoreOfValue(Math.round((100 * scan.risks) / (scan.risks + scan.clears))),
    source: { kind: "scan", at: scan.at, risks: scan.risks, clears: scan.clears },
  };
}

/** A scan saved inside the parcel wins over the risk map. With neither, there is no score. */
export function scoreParcel(unit: ParcelUnit, scans: ParcelScan[], cells: RiskCell[]): ParcelScore | null {
  return scoreFromScans(unit, scans) ?? scoreFromCells(unit, cells);
}
