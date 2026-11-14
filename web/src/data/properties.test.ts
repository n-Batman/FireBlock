import { describe, it, expect } from "vitest";
import { properties } from "./properties";
import { scoreOf, levelOf, rankBlocks } from "@/lib/score";

const byId = (id: string) => properties.find((p) => p.id === id)!;
const topLevel = (id: string) => levelOf(scoreOf(rankBlocks(byId(id).blocks)[0]));

describe("demo properties", () => {
  it("has exactly the three demo properties", () => {
    expect(properties.map((p) => p.id)).toEqual([
      "adelaida-hills",
      "paso-hwy-46-east",
      "edna-valley",
    ]);
  });

  it("scores Adelaida high, Paso medium, Edna low at the worst block", () => {
    expect(topLevel("adelaida-hills")).toBe("high");
    expect(topLevel("paso-hwy-46-east")).toBe("medium");
    expect(topLevel("edna-valley")).toBe("low");
  });

  it("gives Adelaida block 3 a score of 78", () => {
    const b3 = byId("adelaida-hills").blocks.find((b) => b.id === "adelaida-3")!;
    expect(scoreOf(b3)).toBe(78);
  });

  it("keeps every vine block's five factors within their max, summing to 100 max", () => {
    for (const p of properties)
      for (const b of p.blocks.filter((b) => b.kind === "vine")) {
        expect(b.factors.map((f) => f.key)).toEqual([
          "fireWeather",
          "fuelDryness",
          "slope",
          "hazardZone",
          "fireHistory",
        ]);
        expect(b.factors.reduce((s, f) => s + f.max, 0)).toBe(100);
        for (const f of b.factors) expect(f.points).toBeLessThanOrEqual(f.max);
        expect(b.reason.length).toBeGreaterThan(10);
        expect(b.summary.length).toBeGreaterThan(10);
      }
  });

  it("never scores habitat blocks and reports 0 active fires everywhere", () => {
    for (const p of properties) {
      expect(p.activeFires25mi).toBe(0);
      for (const b of p.blocks.filter((b) => b.kind === "habitat")) expect(b.factors).toEqual([]);
    }
  });

  it("cites a past fire in Adelaida's history factor while active fires stay 0", () => {
    const adel = byId("adelaida-hills");
    const hist = adel.blocks.flatMap((b) => b.factors).find((f) => f.key === "fireHistory")!;
    expect(hist.reason).toMatch(/4 miles/);
    expect(adel.activeFires25mi).toBe(0);
  });

  it("gives every property weather that matches its weather factor text", () => {
    for (const p of properties) {
      const w = p.weather;
      expect(w.windMph).toBeGreaterThan(0);
      expect(w.humidityPct).toBeGreaterThan(0);
      expect(w.humidityPct).toBeLessThanOrEqual(100);
      expect(w.windDir).toMatch(/^[NSEW]{1,3}$/);
      expect(w.updatedAt.startsWith("2026-11-13")).toBe(true);
      const reason = p.blocks.flatMap((b) => b.factors).find((f) => f.key === "fireWeather")!.reason;
      expect(reason).toContain(`${w.windMph} mph`);
      expect(reason).toContain(`${w.humidityPct}%`);
    }
  });

  it("flags a Red Flag Warning only for Adelaida Hills", () => {
    expect(properties.map((p) => p.weather.redFlag)).toEqual([true, false, false]);
  });

  it("gives every block a real name, not 'Block N'", () => {
    for (const p of properties)
      for (const b of p.blocks) expect(b.name).not.toMatch(/^Block \d+$/);
  });

  it("is cached on Nov 13, 2026", () => {
    for (const p of properties) expect(p.cachedAt.startsWith("2026-11-13")).toBe(true);
  });
});
