import { describe, expect, it, vi } from "vitest";
import type { ParcelScan } from "@/data/types";
import { clearParcelFix, loadParcelFix, loadParcelReset, loadParcelScans, loadRescanSpot, PARCEL_FIX_KEY, PARCEL_MARKS_EVENT, PARCEL_RESET_KEY, PARCEL_SCAN_KEY, saveParcelFix, saveParcelReset, saveParcelScan, saveRescanSpot } from "./parcelScanStore";

const memory = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    peek: () => value,
  };
};
const scan = (over: Partial<ParcelScan> = {}): ParcelScan => ({
  lat: 35.6363,
  lon: -120.8597,
  risks: 3,
  clears: 1,
  at: "2026-11-14T10:00:00-08:00",
  ...over,
});

describe("parcel scan store", () => {
  it("reads nothing as no scans", () => {
    expect(loadParcelScans(memory())).toEqual([]);
  });

  it("saves a scan with its location and reads it back", () => {
    const storage = memory();
    saveParcelScan(storage, scan());
    expect(loadParcelScans(storage)).toEqual([scan()]);
  });

  it("keeps the earlier scans when a new one is saved", () => {
    const storage = memory();
    saveParcelScan(storage, scan({ at: "2026-11-13T10:00:00-08:00" }));
    saveParcelScan(storage, scan({ at: "2026-11-14T10:00:00-08:00" }));
    expect(loadParcelScans(storage).map((s) => s.at)).toEqual(["2026-11-13T10:00:00-08:00", "2026-11-14T10:00:00-08:00"]);
  });

  it("drops entries that are broken or have an impossible location", () => {
    const raw = JSON.stringify([scan(), { risks: 1 }, scan({ lat: 123 }), scan({ lon: Number.NaN }), "x", null]);
    expect(loadParcelScans(memory(raw))).toEqual([scan()]);
  });

  it("reads corrupt storage as no scans, and does not throw", () => {
    expect(loadParcelScans(memory("{not json"))).toEqual([]);
    expect(loadParcelScans(memory('{"a":1}'))).toEqual([]);
  });

  it("uses its own key, apart from the block scans", () => {
    const storage = memory();
    saveParcelScan(storage, scan());
    expect(PARCEL_SCAN_KEY).not.toBe("fireblock.scan.v1");
    expect(storage.peek()).toContain("35.6363");
  });

  it("keeps at most the 200 newest scans", () => {
    const storage = memory();
    for (let i = 0; i < 205; i++) saveParcelScan(storage, scan({ risks: i + 1 }));
    const all = loadParcelScans(storage);
    expect(all).toHaveLength(200);
    expect(all[0].risks).toBe(6);
    expect(all.at(-1)!.risks).toBe(205);
  });
});

describe("parcel reset marker", () => {
  it("reads nothing, bad data and other parcels as never reset", () => {
    expect(loadParcelReset(memory(), "a")).toBeNull();
    expect(loadParcelReset(memory("not json"), "a")).toBeNull();
    expect(loadParcelReset(memory(JSON.stringify({ b: "2026-11-15T00:00:00Z", a: 5 })), "a")).toBeNull();
  });

  it("saves one marker per parcel without touching the others or the scans", () => {
    const store = memory();
    saveParcelReset(store, "a", "2026-11-15T00:00:00Z");
    saveParcelReset(store, "b", "2026-11-16T00:00:00Z");
    saveParcelReset(store, "a", "2026-11-17T00:00:00Z");
    expect(loadParcelReset(store, "a")).toBe("2026-11-17T00:00:00Z");
    expect(loadParcelReset(store, "b")).toBe("2026-11-16T00:00:00Z");
    expect(JSON.parse(store.peek()!)).toEqual({ a: "2026-11-17T00:00:00Z", b: "2026-11-16T00:00:00Z" });
    expect(PARCEL_RESET_KEY).not.toBe(PARCEL_SCAN_KEY);
  });

  it("starts a fresh marker over unreadable data", () => {
    const store = memory("{broken");
    saveParcelReset(store, "a", "2026-11-15T00:00:00Z");
    expect(loadParcelReset(store, "a")).toBe("2026-11-15T00:00:00Z");
  });
});

describe("parcel mowed mark", () => {
  it("reads nothing, bad data and other parcels as not marked", () => {
    expect(loadParcelFix(memory(), "a")).toBeNull();
    expect(loadParcelFix(memory("nope"), "a")).toBeNull();
    expect(loadParcelFix(memory(JSON.stringify({ a: { apn: "a", at: "yesterday" }, b: { apn: "b", at: "2026-11-15T00:00:00Z" } })), "a")).toBeNull();
  });

  it("saves a mark with its note per parcel, under its own key, and removes only that parcel's", () => {
    const store = memory();
    saveParcelFix(store, { apn: "a", at: "2026-11-15T18:00:00Z", note: "Mowed to 4 in" });
    saveParcelFix(store, { apn: "b", at: "2026-11-16T18:00:00Z" });
    expect(loadParcelFix(store, "a")).toEqual({ apn: "a", at: "2026-11-15T18:00:00Z", note: "Mowed to 4 in" });
    expect(loadParcelFix(store, "b")).toEqual({ apn: "b", at: "2026-11-16T18:00:00Z" });
    clearParcelFix(store, "a");
    expect(loadParcelFix(store, "a")).toBeNull();
    expect(loadParcelFix(store, "b")).not.toBeNull();
    expect(PARCEL_FIX_KEY).toBe("fireblock.parcelFixes.v1");
  });

  it("trims the note, cuts it at 80 characters and leaves out an empty one", () => {
    const store = memory();
    saveParcelFix(store, { apn: "a", at: "2026-11-15T18:00:00Z", note: "   " });
    expect(loadParcelFix(store, "a")).toEqual({ apn: "a", at: "2026-11-15T18:00:00Z" });
    saveParcelFix(store, { apn: "a", at: "2026-11-15T18:00:00Z", note: `  ${"x".repeat(120)}  ` });
    expect(loadParcelFix(store, "a")!.note).toHaveLength(80);
  });

  it("announces fix and reset writes on the window, so open panels and the map update together", () => {
    const heard = vi.fn();
    window.addEventListener(PARCEL_MARKS_EVENT, heard);
    const store = memory();
    saveParcelFix(store, { apn: "a", at: "2026-11-15T18:00:00Z" });
    clearParcelFix(store, "a");
    saveParcelReset(store, "a", "2026-11-15T18:00:00Z");
    window.removeEventListener(PARCEL_MARKS_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(3);
  });
});

describe("rescan spot handoff", () => {
  it("returns the spot only for the parcel it was saved for, and nothing for bad data", () => {
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_k: string, v: string) => void (raw = v) };
    expect(loadRescanSpot(storage, "a")).toBeNull();
    saveRescanSpot(storage, "a", { lat: 35.632, lon: -120.853 });
    expect(loadRescanSpot(storage, "a")).toEqual({ lat: 35.632, lon: -120.853 });
    expect(loadRescanSpot(storage, "b")).toBeNull();
    raw = "{broken";
    expect(loadRescanSpot(storage, "a")).toBeNull();
  });
});
