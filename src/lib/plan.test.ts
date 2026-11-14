import { describe, it, expect } from "vitest";
import { DEFAULT_RATE, actionsFor, buildPlan, parseRate, savingsFor, HOURS_PER_ACRE } from "./plan";
import { withScan } from "./scan";
import { applyScans } from "./scanStore";
import { scoreOf } from "./score";
import { properties } from "@/data/properties";

const byId = (id: string) => properties.find((p) => p.id === id)!;

describe("parseRate", () => {
  it("keeps the previous rate for empty, non-numeric, negative or zero input", () => {
    expect(parseRate("", 90)).toBe(90);
    expect(parseRate("abc", 90)).toBe(90);
    expect(parseRate("-5", 90)).toBe(90);
    expect(parseRate("0", 90)).toBe(90);
  });
  it("accepts a valid positive rate", () => {
    expect(parseRate("75", 90)).toBe(75);
  });
});

describe("buildPlan", () => {
  const adelaida = byId("adelaida-hills");

  it("orders blocks by score descending and numbers them from 1", () => {
    const plan = buildPlan(adelaida, 90);
    const scores = plan.items.map((i) => scoreOf(i.block));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(plan.items.map((i) => i.order)).toEqual(plan.items.map((_, i) => i + 1));
  });

  it("never includes habitat blocks", () => {
    expect(adelaida.blocks.some((b) => b.kind === "habitat")).toBe(true);
    const plan = buildPlan(adelaida, 90);
    expect(plan.items.every((i) => i.block.kind === "vine")).toBe(true);
  });

  it("computes hours from acres and totals equal the sum of items", () => {
    const plan = buildPlan(adelaida, 90);
    for (const i of plan.items) {
      expect(i.hours).toBeCloseTo(i.block.acres * HOURS_PER_ACRE, 1);
      expect(i.cost).toBe(Math.round(i.hours * 90));
    }
    expect(plan.totalCost).toBe(plan.items.reduce((s, i) => s + i.cost, 0));
    expect(plan.totalHours).toBeCloseTo(plan.items.reduce((s, i) => s + i.hours, 0), 5);
  });

  it("rescales cost when the rate changes", () => {
    const cheap = buildPlan(adelaida, 60);
    const dear = buildPlan(adelaida, 120);
    expect(dear.totalCost).toBeGreaterThan(cheap.totalCost);
    for (const i of dear.items) expect(i.cost).toBe(Math.round(i.hours * 120));
  });

  it("is urgent for Adelaida Hills and Paso Hwy 46 East, not for Edna Valley", () => {
    expect(buildPlan(adelaida, 90).urgent).toBe(true);
    expect(buildPlan(byId("paso-hwy-46-east"), 90).urgent).toBe(true);
    expect(buildPlan(byId("edna-valley"), 90).urgent).toBe(false);
  });

  it("carries each block's actions on its plan item", () => {
    for (const item of buildPlan(adelaida, 90).items) expect(item.actions).toEqual(actionsFor(item.block));
  });
});

describe("actionsFor", () => {
  const block = (id: string) => properties.flatMap((p) => p.blocks).find((b) => b.id === id)!;
  const asOf = "2026-11-14T10:00:00-08:00";

  it("gives a high-risk block three concrete actions from its biggest factors", () => {
    const actions = actionsFor(block("adelaida-3"));
    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatch(/^Mow/);
    expect(actions[0]).toMatch(/June 1/);
    expect(actions[1]).toMatch(/upslope/i);
    expect(actions[2]).toMatch(/firebreak/i);
  });

  it("says there is no urgent mowing for a low-risk block", () => {
    const actions = actionsFor(block("adelaida-2"));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/no urgent mowing/i);
  });

  it("always gives 1 to 3 short actions with no em-dashes", () => {
    for (const b of properties.flatMap((p) => p.blocks).filter((b) => b.kind === "vine")) {
      const actions = actionsFor(b);
      expect(actions.length).toBeGreaterThanOrEqual(1);
      expect(actions.length).toBeLessThanOrEqual(3);
      for (const a of actions) {
        expect(a.length).toBeLessThanOrEqual(120);
        expect(a).not.toMatch(/—/);
      }
    }
  });

  it("puts the scan's findings in the actions when the scan is a top factor", () => {
    expect(actionsFor(withScan(block("adelaida-4"), 20, asOf)).some((a) => /scan/i.test(a))).toBe(true);
  });

  it("gives habitat nothing to mow", () => {
    expect(actionsFor(block("adelaida-habitat"))).toEqual([]);
  });
});

describe("savingsFor", () => {
  const adelaida = byId("adelaida-hills");

  it("totals every vine block with the same numbers /plan shows", () => {
    const all = savingsFor(adelaida, DEFAULT_RATE).all;
    const plan = buildPlan(adelaida, DEFAULT_RATE);
    expect(all.blocks).toBe(5);
    expect(all.cost).toBe(plan.totalCost);
    expect(all.hours).toBe(plan.totalHours);
    expect(all.cost).toBe(plan.items.reduce((sum, i) => sum + i.cost, 0));
  });

  it("targets only the High blocks: 2 of 5 at Adelaida Hills", () => {
    const { high } = savingsFor(adelaida, DEFAULT_RATE);
    expect(high.blocks).toBe(2);
    // Ridge Top (6 ac) and South Slope (5 ac) at 1.2 hr per acre and $90 an hour.
    expect(high.hours).toBeCloseTo(7.2 + 6, 5);
    expect(high.cost).toBe(648 + 540);
  });

  it("saves the difference between mowing everything and mowing only High", () => {
    const s = savingsFor(adelaida, DEFAULT_RATE);
    expect(s.saved.cost).toBe(s.all.cost - s.high.cost);
    expect(s.saved.cost).toBe(2916 - 1188);
    expect(s.saved.hours).toBeCloseTo(32.4 - 13.2, 5);
  });

  it("never counts habitat as mowable, and reports the acres it skips", () => {
    expect(savingsFor(adelaida, DEFAULT_RATE).habitatAcres).toBe(5.5);
    expect(savingsFor(byId("edna-valley"), DEFAULT_RATE).habitatAcres).toBe(0);
    const vineBlocks = adelaida.blocks.filter((b) => b.kind === "vine").length;
    expect(savingsFor(adelaida, DEFAULT_RATE).all.blocks).toBe(vineBlocks);
  });

  it("never saves a negative amount, at any rate or for any property", () => {
    for (const property of properties)
      for (const rate of [1, 37.5, 90, 250]) {
        const s = savingsFor(property, rate);
        expect(s.saved.cost).toBeGreaterThanOrEqual(0);
        expect(s.saved.hours).toBeGreaterThanOrEqual(0);
        expect(s.high.cost).toBeLessThanOrEqual(s.all.cost);
        expect(s.high.hours).toBeLessThanOrEqual(s.all.hours);
        expect(s.high.blocks).toBeLessThanOrEqual(s.all.blocks);
      }
  });

  it("has nothing to target when no block is High (Paso and Edna)", () => {
    for (const id of ["paso-hwy-46-east", "edna-valley"]) {
      const s = savingsFor(byId(id), DEFAULT_RATE);
      expect(s.high).toEqual({ blocks: 0, hours: 0, cost: 0 });
      expect(s.saved.cost).toBe(s.all.cost);
    }
  });

  it("follows the crew rate", () => {
    expect(savingsFor(adelaida, 120).all.cost).toBeGreaterThan(savingsFor(adelaida, 60).all.cost);
  });

  it("moves a block into the targeted set when a scan pushes it to High", () => {
    const at = "2026-11-14T10:00:00-08:00";
    // Old Vine Row is 58 (medium). Three risks add 18 points: 76 is High.
    const scanned = applyScans(adelaida, { "adelaida-hills:adelaida-4": { risks: 3, clears: 0, at } });
    expect(savingsFor(scanned, DEFAULT_RATE).high.blocks).toBe(3);
  });
});
