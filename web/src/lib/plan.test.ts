import { describe, it, expect } from "vitest";
import { actionsFor, buildPlan, parseRate, HOURS_PER_ACRE } from "./plan";
import { withScan } from "./scan";
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
