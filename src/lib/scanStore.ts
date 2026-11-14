import type { Property } from "@/data/types";
import { scanDelta, withScan } from "./scan";

export interface ScanResult {
  risks: number;
  clears: number;
  /** ISO timestamp of the scan. */
  at: string;
}

export const SCAN_STORAGE_KEY = "fireblock.scan.v1";

export const scanKey = (propertyId: string, blockId: string) => `${propertyId}:${blockId}`;

const isResult = (v: unknown): v is ScanResult =>
  typeof v === "object" &&
  v !== null &&
  Number.isFinite((v as ScanResult).risks) &&
  Number.isFinite((v as ScanResult).clears) &&
  typeof (v as ScanResult).at === "string";

/** Reads saved scans. Bad or missing data reads as no scans. */
export function loadScans(storage: Pick<Storage, "getItem">): Record<string, ScanResult> {
  try {
    const raw = storage.getItem(SCAN_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isResult(v)));
  } catch {
    return {};
  }
}

export function saveScan(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  result: ScanResult,
): void {
  storage.setItem(SCAN_STORAGE_KEY, JSON.stringify({ ...loadScans(storage), [key]: result }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A copy of the property where each scanned block carries its photo scan factor. */
export function applyScans(property: Property, scans: Record<string, ScanResult>): Property {
  return {
    ...property,
    blocks: property.blocks.map((block) => {
      const scan = scans[scanKey(property.id, block.id)];
      if (!scan || block.kind !== "vine") return block;
      const reason = `The scan found ${plural(scan.risks, "risk", "risks")} and ${plural(scan.clears, "cleared area", "cleared areas")} on the rows.`;
      return withScan(block, scanDelta(scan.risks, scan.clears), scan.at, reason);
    }),
  };
}
