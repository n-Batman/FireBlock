import type { GridScan } from "@/data/types";

const KEY = "fireblock.scancache.v1";
const MAX_ENTRIES = 12;
const memory = new Map<string, GridScan>();

/**
 * A key for the image text: two 32-bit FNV-1a hashes with different seeds plus the length, so the same
 * photo always maps to the same key. ponytail: 64 bits, not cryptographic; fine for a few cached scans.
 * It is synchronous on purpose, so a scan starts in the same tick as before.
 */
export function hashImage(image: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < image.length; i++) {
    const c = image.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
  }
  return `${image.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

function readStore(storage: Pick<Storage, "getItem"> | undefined): [string, GridScan][] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as [string, GridScan][]).filter((e) => Array.isArray(e) && Array.isArray(e[1]?.cells)) : [];
  } catch {
    return [];
  }
}

/** A cached grid for this image hash: memory first, then localStorage. Bad or missing storage reads as a miss. */
export function getCached(hash: string, storage?: Pick<Storage, "getItem">): GridScan | null {
  const hit = memory.get(hash) ?? readStore(storage).find(([k]) => k === hash)?.[1] ?? null;
  if (hit) memory.set(hash, hit);
  return hit;
}

/** Remembers a grid in memory and in localStorage (the newest 12). A full or blocked storage is ignored. */
export function putCached(hash: string, grid: GridScan, storage?: Pick<Storage, "getItem" | "setItem">): void {
  memory.set(hash, grid);
  try {
    const rest = readStore(storage).filter(([k]) => k !== hash);
    storage?.setItem(KEY, JSON.stringify([...rest, [hash, grid]].slice(-MAX_ENTRIES)));
  } catch {
    // The scan still works without the saved copy.
  }
}

/** For tests: forget the in-memory copies. */
export const clearMemoryCache = () => memory.clear();
