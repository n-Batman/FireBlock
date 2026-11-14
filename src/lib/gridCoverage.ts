import { difference } from "polyclip-ts";
import type { MultiPolygon, Polygon } from "geojson";
import type { RiskGrid } from "./parcelRisk";

type Shape = Polygon | MultiPolygon;
type Box = [number, number, number, number];

function boxOf(shape: Shape): Box {
  const points = (shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates).flat(2);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
const touch = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** A cheap fingerprint of the drawn cells, so the map layer is rebuilt when the cut-outs change. */
export const gridSignature = (grid: RiskGrid) =>
  grid.features
    .reduce((sum, cell) => sum + boxOf(cell.geometry).reduce((a, b) => a + b, 0), grid.features.length)
    .toString();

/**
 * The risk grid with the parts under parcels cut away: a cell a parcel covers completely is dropped,
 * a cell it partly covers keeps only the uncovered part, and a cell no parcel touches is left as it
 * is. Scores and ids stay on each cell. Used only to draw the grid, never to score a parcel.
 */
export function gridOutsideParcels(grid: RiskGrid, parcels: Shape[]): RiskGrid {
  if (parcels.length === 0) return grid;
  const boxes = parcels.map(boxOf);
  const features = [];
  for (const cell of grid.features) {
    const cellBox = boxOf(cell.geometry);
    const near = parcels.filter((_, i) => touch(boxes[i], cellBox));
    if (near.length === 0) {
      features.push(cell);
      continue;
    }
    // GeoJSON positions are number[]; polyclip-ts types them as [number, number] pairs.
    const rest = difference(cell.geometry.coordinates as never, ...(near.map((p) => p.coordinates) as never[]));
    if (rest.length === 0) continue;
    const geometry: Shape = rest.length === 1 ? { type: "Polygon", coordinates: rest[0] } : { type: "MultiPolygon", coordinates: rest };
    features.push({ ...cell, geometry });
  }
  return { ...grid, features } as RiskGrid;
}
