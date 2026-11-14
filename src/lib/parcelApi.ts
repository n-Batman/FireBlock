import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { ParcelUnit } from "@/data/types";
import { insideSlo, type Fetcher } from "./geocode";
import type { Parcels } from "./parcels";
import { toGeoJSON, toParcelUnits } from "./parcelUnits";

export type ParcelLookup =
  | { kind: "ok"; units: ParcelUnit[]; truncated: boolean }
  | { kind: "outside" }
  | { kind: "error"; message: string };

const SERVICE_DOWN = "The county parcel service is not answering. Try again in a moment.";
const UNREACHABLE = "Could not reach the parcel service. Check your connection.";
const UNEXPECTED = "The county parcel service sent something we could not read. Try again in a moment.";

interface Options {
  fetcher?: Fetcher;
  signal?: AbortSignal;
}

/**
 * The parcels within 300 m of a point, through the app's /api/parcels, as map units.
 * Outside SLO County it does not call the API. Errors come back in plain words, not as raw statuses.
 * An abort is thrown so a stale lookup can be dropped.
 */
export async function lookupParcels(
  lat: number,
  lon: number,
  { fetcher = fetch, signal }: Options = {},
): Promise<ParcelLookup> {
  if (!insideSlo(lat, lon)) return { kind: "outside" };

  const query = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: "300" });
  let res;
  try {
    res = await fetcher(`/api/parcels?${query}`, { signal });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    return { kind: "error", message: UNREACHABLE };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "error", message: res.ok ? UNEXPECTED : SERVICE_DOWN };
  }

  if (!res.ok) {
    if (res.status >= 500) return { kind: "error", message: SERVICE_DOWN };
    const message = (body as { error?: unknown } | null)?.error;
    return { kind: "error", message: typeof message === "string" ? message : "The parcel lookup was not accepted." };
  }
  const parcels = body as Parcels | null;
  if (!parcels || !Array.isArray(parcels.features)) return { kind: "error", message: UNEXPECTED };
  let units = toParcelUnits(parcels);
  const truncated = parcels.metadata?.truncated === true;
  if (truncated) {
    // The county orders by record, not distance, so a cut-off list may leave out the parcel at the point.
    const exact = await parcelsAtPoint(lat, lon, fetcher, signal);
    const ids = new Set(exact.map((u) => u.id));
    units = [...exact, ...units.filter((u) => !ids.has(u.id))];
  }
  const here = point([lon, lat]);
  return { kind: "ok", units: units.map((u) => ({ ...u, atPoint: booleanPointInPolygon(here, toGeoJSON(u)) })), truncated };
}

/** The parcel(s) at the exact point. Any failure but an abort gives none, and the 300 m list stands. */
async function parcelsAtPoint(lat: number, lon: number, fetcher: Fetcher, signal?: AbortSignal): Promise<ParcelUnit[]> {
  try {
    const res = await fetcher(`/api/parcels?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`, { signal });
    if (!res.ok) return [];
    const parcels = (await res.json()) as Parcels | null;
    return parcels && Array.isArray(parcels.features) ? toParcelUnits(parcels) : [];
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    return [];
  }
}
