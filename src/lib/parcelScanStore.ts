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
export const PARCEL_FIX_KEY = "fireblock.parcelFixes.v1";
/** Fired on this window after a reset or fix mark is written, so every component reading marks updates (the storage event only reaches other tabs). */
export const PARCEL_MARKS_EVENT = "fireblock:parcel-marks";
const announce = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PARCEL_MARKS_EVENT));
};

/** A parcel marked as mowed: when, and an optional short note such as "Mowed to 4 in". */
export interface ParcelFix {
  apn: string;
  at: string;
  note?: string;
}
const MAX_NOTE = 80;

function readMap(storage: Pick<Storage, "getItem">, key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The mowed mark for a parcel, or null. Bad or missing data reads as not marked. */
export function loadParcelFix(storage: Pick<Storage, "getItem">, apn: string): ParcelFix | null {
  const v = readMap(storage, PARCEL_FIX_KEY)[apn] as Partial<ParcelFix> | undefined;
  if (!v || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at))) return null;
  return { apn, at: v.at, ...(typeof v.note === "string" && v.note ? { note: v.note } : {}) };
}

/** Marks a parcel as mowed at `at`. The note is trimmed and cut to 80 characters; an empty note is left out. */
export function saveParcelFix(storage: Pick<Storage, "getItem" | "setItem">, fix: ParcelFix): void {
  const note = fix.note?.trim().slice(0, MAX_NOTE);
  storage.setItem(PARCEL_FIX_KEY, JSON.stringify({ ...readMap(storage, PARCEL_FIX_KEY), [fix.apn]: { apn: fix.apn, at: fix.at, ...(note ? { note } : {}) } }));
  announce();
}

/** Removes a parcel's mowed mark. */
export function clearParcelFix(storage: Pick<Storage, "getItem" | "setItem">, apn: string): void {
  const { [apn]: _gone, ...rest } = readMap(storage, PARCEL_FIX_KEY);
  storage.setItem(PARCEL_FIX_KEY, JSON.stringify(rest));
  announce();
}

export const RESCAN_SPOT_KEY = "fireblock.rescanSpot.v1";

/**
 * Hands the first scan's spot from the parcel panel to the scanner for one tab (session storage), so the spot never goes
 * in the page address. Read once per rescan.
 */
export function saveRescanSpot(storage: Pick<Storage, "setItem">, apn: string, spot: { lat: number; lon: number }): void {
  storage.setItem(RESCAN_SPOT_KEY, JSON.stringify({ apn, lat: spot.lat, lon: spot.lon }));
}

/** The spot handed over for this parcel, or null (a spot for another parcel is not used). */
export function loadRescanSpot(storage: Pick<Storage, "getItem">, apn: string): { lat: number; lon: number } | null {
  try {
    const v = JSON.parse(storage.getItem(RESCAN_SPOT_KEY) ?? "null") as { apn?: unknown; lat?: unknown; lon?: unknown } | null;
    return v && v.apn === apn && typeof v.lat === "number" && typeof v.lon === "number" && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? { lat: v.lat, lon: v.lon } : null;
  } catch {
    return null;
  }
}

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
  announce();
}

/** Adds a scan, keeping the newest 200. */
export function saveParcelScan(storage: Pick<Storage, "getItem" | "setItem">, scan: ParcelScan): void {
  storage.setItem(PARCEL_SCAN_KEY, JSON.stringify([...loadParcelScans(storage), scan].slice(-KEEP)));
}
