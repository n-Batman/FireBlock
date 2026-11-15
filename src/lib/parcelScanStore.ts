import type { ParcelScan } from "@/data/types";

export const PARCEL_SCAN_KEY = "fireblock.parcelScans.v1";
const KEEP = 200;

const isScan = (v: unknown): v is ParcelScan => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as ParcelScan;
  return (
    Number.isFinite(s.lat) &&
    Math.abs(s.lat) <= 90 &&
    Number.isFinite(s.lon) &&
    Math.abs(s.lon) <= 180 &&
    Number.isFinite(s.risks) &&
    s.risks >= 0 &&
    Number.isFinite(s.clears) &&
    s.clears >= 0 &&
    typeof s.at === "string"
  );
};

/** Reads the scans saved with a location. Bad or missing data reads as no scans. */
export function loadParcelScans(storage: Pick<Storage, "getItem">): ParcelScan[] {
  try {
    const raw = storage.getItem(PARCEL_SCAN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isScan) : [];
  } catch {
    return [];
  }
}

export const PARCEL_RESET_KEY = "fireblock.parcelResets.v1";

/** When a parcel's before/after was last restarted (an ISO time), or null. Bad or missing data reads as never. */
export function loadParcelReset(storage: Pick<Storage, "getItem">, parcelId: string): string | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PARCEL_RESET_KEY) ?? "{}");
    const at = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[parcelId] : null;
    return typeof at === "string" ? at : null;
  } catch {
    return null;
  }
}

/** Restarts a parcel's before/after: scans saved at or before `at` no longer count. The scans themselves are kept. */
export function saveParcelReset(storage: Pick<Storage, "getItem" | "setItem">, parcelId: string, at: string): void {
  let all: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PARCEL_RESET_KEY) ?? "{}");
    if (typeof parsed === "object" && parsed !== null) all = parsed as Record<string, unknown>;
  } catch {
    /* unreadable marker: start a fresh one */
  }
  storage.setItem(PARCEL_RESET_KEY, JSON.stringify({ ...all, [parcelId]: at }));
}

/** Adds a scan, keeping the newest 200. */
export function saveParcelScan(storage: Pick<Storage, "getItem" | "setItem">, scan: ParcelScan): void {
  storage.setItem(PARCEL_SCAN_KEY, JSON.stringify([...loadParcelScans(storage), scan].slice(-KEEP)));
}
