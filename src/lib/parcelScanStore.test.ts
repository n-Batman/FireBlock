import { describe, expect, it } from "vitest";
import type { ParcelScan } from "@/data/types";
import { loadParcelScans, PARCEL_SCAN_KEY, saveParcelScan } from "./parcelScanStore";

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
