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

/** Adds a scan, keeping the newest 200. */
export function saveParcelScan(storage: Pick<Storage, "getItem" | "setItem">, scan: ParcelScan): void {
  storage.setItem(PARCEL_SCAN_KEY, JSON.stringify([...loadParcelScans(storage), scan].slice(-KEEP)));
}
