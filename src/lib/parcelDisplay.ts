import type { ParcelUnit, Ring } from "@/data/types";

export const INDIVIDUAL_PARCEL_ZOOM = 17;
const RADIUS = 6378137;
const project = ([lat, lon]: [number, number]): [number, number] => [
  RADIUS * lon * Math.PI / 180,
  RADIUS * Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360)),
];
const unproject = (x: number, y: number): [number, number] => [
  (2 * Math.atan(Math.exp(y / RADIUS)) - Math.PI / 2) * 180 / Math.PI,
  x / RADIUS * 180 / Math.PI,
];

export interface ParcelAreaSummary {
  id: string;
  ring: Ring;
  count: number;
  scoredCount: number;
  /** Area-weighted score of known parcels, shown only with >=60% scored area. */
  score: number | null;
  coverage: number;
}

/** Display-only grid summaries, never used as property boundaries or model inputs.
 * Stable Mercator cells avoid reshuffling when the camera pans. No retained/global cache.
 */
export function parcelDisplay(parcels: ParcelUnit[], zoom: number, selectedId: string | null = null): {
  individuals: ParcelUnit[]; areas: ParcelAreaSummary[];
} {
  if (!Number.isFinite(zoom) || zoom >= INDIVIDUAL_PARCEL_ZOOM) return { individuals: parcels, areas: [] };
  const size = 192 * 2 ** (16 - Math.max(12, Math.floor(zoom)));
  const individuals: ParcelUnit[] = [];
  const buckets = new Map<string, { x: number; y: number; members: ParcelUnit[] }>();
  for (const parcel of parcels) {
    // Keep farms, selected properties and unusually elongated lots at their actual boundaries.
    if (parcel.id === selectedId || !Number.isFinite(parcel.acres) || parcel.acres <= 0 || parcel.acres > 2) {
      individuals.push(parcel); continue;
    }
    const center = project(parcel.center);
    const x = Math.floor(center[0] / size), y = Math.floor(center[1] / size);
    // A whole parcel must fit its summary cell: summaries cannot cover a retained neighbour
    // merely because a long lot's label happens to fall in another cell.
    const fits = parcel.parts.every(part => part[0].every(p => {
      const [px, py] = project(p);
      return px >= x * size && px <= (x + 1) * size && py >= y * size && py <= (y + 1) * size;
    }));
    if (!fits) { individuals.push(parcel); continue; }
    const id = `${size}:${x}:${y}`;
    const bucket = buckets.get(id) ?? { x, y, members: [] };
    bucket.members.push(parcel); buckets.set(id, bucket);
  }
  const areas: ParcelAreaSummary[] = [];
  for (const [id, { x, y, members }] of buckets) {
    if (members.length < 3) { individuals.push(...members); continue; }
    let total = 0, known = 0, weighted = 0, scoredCount = 0;
    for (const p of members) {
      total += p.acres;
      if (p.score && Number.isFinite(p.score.score) && p.score.score >= 0 && p.score.score <= 100) {
        known += p.acres; weighted += p.acres * p.score.score; scoredCount++;
      }
    }
    const coverage = known / total;
    areas.push({ id, count: members.length, scoredCount, coverage,
      score: coverage >= .6 && known > 0 ? weighted / known : null,
      ring: [unproject(x * size, y * size), unproject((x + 1) * size, y * size),
        unproject((x + 1) * size, (y + 1) * size), unproject(x * size, (y + 1) * size), unproject(x * size, y * size)],
    });
  }
  return { individuals, areas };
}
