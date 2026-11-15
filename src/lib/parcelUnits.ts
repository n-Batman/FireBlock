import area from "@turf/area";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { ParcelUnit, PolygonRings, Ring } from "@/data/types";
import { labelPoint, pointInPolygon, type LatLng } from "./geo";
import type { Parcels } from "./parcels";

const ACRES_PER_M2 = 1 / 4046.8564224;
const CENTER_CACHE_LIMIT = 512;
const centers = new Map<string, LatLng>();

// GeoJSON is [lon, lat]. Leaflet is [lat, lng]. These two functions are the only place that flips.
const flip = ([lon, lat]: Position): LatLng => [lat, lon];
const unflip = ([lat, lng]: LatLng): Position => [lng, lat];

const bboxArea = (ring: Ring) => {
  const lats = ring.map((p) => p[0]);
  const lngs = ring.map((p) => p[1]);
  return (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
};

/** A point inside the parcel and outside its holes, for the label. Uses the biggest part. */
function centerOf(parts: PolygonRings[]): LatLng {
  const [outer, ...holes] = parts.reduce((big, p) => (bboxArea(p[0]) > bboxArea(big[0]) ? p : big));
  const ok = (p: LatLng) => pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
  const middle = labelPoint(outer);
  if (ok(middle)) return middle;
  // The middle fell in a hole: step out past each hole's edge at its mid height or width.
  for (const hole of holes) {
    const lats = hole.map((p) => p[0]);
    const lngs = hole.map((p) => p[1]);
    const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const [dLat, dLng] = [(n - s) / 4, (e - w) / 4];
    const tries: LatLng[] = [
      [(s + n) / 2, e + dLng],
      [(s + n) / 2, w - dLng],
      [n + dLat, (w + e) / 2],
      [s - dLat, (w + e) / 2],
    ];
    const found = tries.find(ok);
    if (found) return found;
  }
  return middle;
}

function cachedCenterOf(id: string, parts: PolygonRings[]): LatLng {
  // Preserve the part/ring structure so holes and multipart changes miss too.
  const key = JSON.stringify([id, parts.map((rings) => rings.map((ring) => ring.length))]);
  let center = centers.get(key);
  if (center) centers.delete(key); // Refresh insertion order for LRU eviction.
  else center = centerOf(parts);
  centers.set(key, center);
  if (centers.size > CENTER_CACHE_LIMIT) centers.delete(centers.keys().next().value!);
  // Callers own their unit; mutating its center must not poison later responses.
  return [...center];
}

/** The county's GeoJSON parcels as map units: [lat, lng] rings, acres from the geometry, no score yet. */
export function toParcelUnits(parcels: Parcels): ParcelUnit[] {
  return parcels.features.map((f) => {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const parts: PolygonRings[] = polygons.map((rings) => rings.map((ring) => ring.map(flip)));
    return { id: f.properties.parcelId, parts, acres: area(f.geometry) * ACRES_PER_M2, center: cachedCenterOf(f.properties.parcelId, parts), score: null };
  });
}

/** The unit's geometry back in GeoJSON order, for turf. */
export function toGeoJSON(unit: ParcelUnit): Polygon | MultiPolygon {
  const polygons = unit.parts.map((rings) => rings.map((ring) => ring.map(unflip)));
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}
