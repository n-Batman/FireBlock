/** [latitude, longitude]. */
export type LatLng = [number, number];

/** Drops a repeated closing point, so a ring works whether or not it repeats its first point. */
function open(ring: LatLng[]): LatLng[] {
  const n = ring.length;
  return n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]
    ? ring.slice(0, -1)
    : ring;
}

/** Works for any simple polygon, convex or not. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  const ring = open(polygon);
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }
  return inside;
}

/** South-west and north-east corners. */
export function boundsOfPolygon(polygon: LatLng[]): [LatLng, LatLng] {
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

type XY = [number, number];

function insideXY(x: number, y: number, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function edgeDistance(x: number, y: number, ring: XY[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

/**
 * A point that is always inside the polygon and as far from its edges as it gets, for placing a
 * label. Unlike the centroid it stays inside concave shapes (an L, a U, a kinked block).
 * Searches a grid, then refines around the best cell.
 */
export function labelPoint(polygon: LatLng[]): LatLng {
  const ring = open(polygon);
  const kx = Math.cos((ring[0][0] * Math.PI) / 180) * 111320;
  const ky = 110540;
  const pts: XY[] = ring.map(([lat, lng]) => [lng * kx, lat * ky]);

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  let best = { x: cx, y: cy, d: -1, toCenter: Infinity };
  let step = Math.max(x1 - x0, y1 - y0) / 16;
  for (let round = 0; round < 3 && step > 0; round++) {
    for (let x = x0; x <= x1 + 1e-9; x += step) {
      for (let y = y0; y <= y1 + 1e-9; y += step) {
        if (!insideXY(x, y, pts)) continue;
        const d = edgeDistance(x, y, pts);
        const toCenter = Math.hypot(x - cx, y - cy);
        // Among points that are about equally far from the edges, prefer the one nearer the middle.
        if (d > best.d * 1.001 || (d >= best.d * 0.999 && toCenter < best.toCenter)) {
          best = { x, y, d, toCenter };
        }
      }
    }
    x0 = best.x - step;
    x1 = best.x + step;
    y0 = best.y - step;
    y1 = best.y + step;
    step /= 4;
  }
  if (best.d < 0) return ring[0];
  return [best.y / ky, best.x / kx];
}
