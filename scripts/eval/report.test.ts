import { describe, expect, it } from "vitest";
import { gapSummary, overlaySummary } from "./report";
import type { Result } from "./run";

const r = (id: string, ours: number, overlay: number | null): Result =>
  ({ item: { id, category: "b" }, ours, overlay, gap: overlay == null ? null : Math.abs(ours - overlay) }) as unknown as Result;

describe("gapSummary", () => {
  it("counts gaps over 15, averages them and skips frames where a side failed", () => {
    const out = gapSummary([r("a", 50, 30), r("b", 40, 45), r("c", 10, null)]);
    expect(out[0]).toBe("- Headline vs overlay gap >15 pts: 1/2 (target 0); mean |gap| 12.5 pts; skipped (a side failed): 1");
    expect(out.filter((l) => l.startsWith("| a ")).length).toBe(1);
    expect(out.some((l) => l.startsWith("| c "))).toBe(false);
    expect(out.findIndex((l) => l.startsWith("| a "))).toBeLessThan(out.findIndex((l) => l.startsWith("| b ")));
  });

  it("lists at most 10 frames and prints nothing when no frame has both sides", () => {
    const many = Array.from({ length: 12 }, (_, i) => r(`f${i}`, 50, i));
    expect(gapSummary(many).filter((l) => l.startsWith("| f")).length).toBe(10);
    expect(gapSummary([r("x", 5, null)])).toEqual([]);
  });
});

describe("overlaySummary", () => {
  const o = (over: Partial<Result>): Result => ({ item: { id: "a", category: "b" }, expected: 20, dirt: false, overlay: 30, overlayRisk: 0.1, gridShare: 60, gridRisk: 0.3, target: 0.15, ...over }) as unknown as Result;

  it("scores the grid and scan() maps against the human label, the dirt rule and the estimate's area", () => {
    const out = overlaySummary([o({}), o({ dirt: true, expected: 0, overlay: 0, overlayRisk: 0.01, gridShare: 100, gridRisk: 0.5, target: 0 })]);
    expect(out.find((l) => l.startsWith("| GPT only"))).toBe("| GPT only (grid) | 70.0 | 1/1 | 32.5 | 2/2 |");
    expect(out.find((l) => l.startsWith("| Ours"))).toBe("| Ours (scan) | 5.0 | 0/1 | 3.0 | 0/2 |");
  });

  it("prints nothing without an overlay", () => {
    expect(overlaySummary([o({ overlay: null })])).toEqual([]);
  });
});
