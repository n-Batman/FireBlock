import { describe, it, expect } from "vitest";
import { applyScans, loadScans, saveScan, scanKey } from "./scanStore";
import { scoreOf } from "./score";
import { properties } from "@/data/properties";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const at = "2026-11-14T10:00:00-08:00";
const adelaida = properties[0];
const scoreById = (p: typeof adelaida, id: string) => scoreOf(p.blocks.find((b) => b.id === id)!);

describe("scanKey", () => {
  it("joins property and block", () => {
    expect(scanKey("adelaida-hills", "adelaida-3")).toBe("adelaida-hills:adelaida-3");
  });
});

describe("loadScans and saveScan", () => {
  it("starts empty, and survives bad data", () => {
    const s = new MemoryStorage();
    expect(loadScans(s)).toEqual({});
    s.setItem("fireblock.scan.v1", "not json");
    expect(loadScans(s)).toEqual({});
    s.setItem("fireblock.scan.v1", "[1,2,3]");
    expect(loadScans(s)).toEqual({});
  });

  it("drops entries with the wrong shape", () => {
    const s = new MemoryStorage();
    s.setItem(
      "fireblock.scan.v1",
      JSON.stringify({ good: { risks: 1, clears: 0, at }, bad: { risks: "x" } }),
    );
    expect(Object.keys(loadScans(s))).toEqual(["good"]);
  });

  it("keeps earlier scans when saving a new one", () => {
    const s = new MemoryStorage();
    saveScan(s, "a:1", { risks: 3, clears: 1, at });
    saveScan(s, "a:2", { risks: 0, clears: 2, at });
    expect(loadScans(s)).toEqual({
      "a:1": { risks: 3, clears: 1, at },
      "a:2": { risks: 0, clears: 2, at },
    });
  });
});

describe("applyScans", () => {
  it("moves only the scanned block's score, without changing the original", () => {
    const scanned = applyScans(adelaida, { "adelaida-hills:adelaida-5": { risks: 2, clears: 0, at } });
    expect(scoreById(scanned, "adelaida-5")).toBe(96); // all risk: +25
    expect(scoreById(scanned, "adelaida-3")).toBe(78);
    expect(scoreById(adelaida, "adelaida-5")).toBe(71);
  });

  it("ignores scans that belong to another property", () => {
    const scanned = applyScans(properties[1], { "adelaida-hills:adelaida-5": { risks: 2, clears: 0, at } });
    expect(scanned.blocks).toEqual(properties[1].blocks);
  });

  it("caps a score at 100", () => {
    const scanned = applyScans(adelaida, { "adelaida-hills:adelaida-3": { risks: 9, clears: 0, at } });
    expect(scoreById(scanned, "adelaida-3")).toBe(100);
  });
});
