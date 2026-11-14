import { describe, it, expect } from "vitest";
import type { Finding } from "@/data/types";
import type { Track } from "./scan";
import { findingLine, layoutLabels, PILL_H, selectFindings, shownTracks, toneOf, type LabelItem } from "./scanView";

const f = (over: Partial<Finding> = {}): Finding => ({
  label: "Dry grass",
  severity: "risk",
  action: "Mow by June 1",
  bbox: [100, 100, 500, 500],
  confidence: 0.9,
  ...over,
});

describe("selectFindings", () => {
  it("hides findings below 0.6 confidence and keeps ones with no score (demo clip)", () => {
    const out = selectFindings([
      f({ confidence: 0.59 }),
      f({ label: "A", confidence: 0.6 }),
      f({ label: "B", confidence: undefined, bbox: [600, 600, 900, 900] }),
    ]);
    // B has no score, which counts as fully confident, so it sorts first.
    expect(out.map((x) => x.label)).toEqual(["B", "A"]);
  });

  it("drops boxes under 4% of the frame", () => {
    const tiny = f({ label: "Tiny", bbox: [0, 0, 150, 150] }); // 2.25%
    const fine = f({ label: "Fine", bbox: [0, 0, 250, 250] }); // 6.25%
    expect(selectFindings([tiny, fine]).map((x) => x.label)).toEqual(["Fine"]);
  });

  it("merges boxes that overlap by more than 40% into one covering both", () => {
    // Intersection 300x400 = 120000. Union 400x400 + 400x400 - 120000 = 200000. IoU 0.6.
    const a = f({ label: "Dry grass", bbox: [100, 100, 500, 500], confidence: 0.7 });
    const b = f({ label: "Dry weeds", bbox: [200, 100, 600, 500], confidence: 0.9 });
    const out = selectFindings([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].bbox).toEqual([100, 100, 600, 500]);
    expect(out[0].label).toBe("Dry weeds");
    expect(out[0].confidence).toBe(0.9);
  });

  it("keeps boxes that overlap by 40% or less apart", () => {
    // Intersection 200x400 = 80000. Union 240000. IoU one third.
    const a = f({ label: "A", bbox: [100, 100, 500, 500] });
    const b = f({ label: "B", bbox: [300, 100, 700, 500] });
    expect(selectFindings([a, b])).toHaveLength(2);
  });

  it("lets risk win when a risk box and a clear box merge", () => {
    const clear = f({ label: "Green cover", severity: "clear", action: "Keep it trimmed", confidence: 0.95 });
    const risk = f({ label: "Dry patch", severity: "risk", confidence: 0.7 });
    const [one] = selectFindings([clear, risk]);
    expect(one.severity).toBe("risk");
    expect(one.label).toBe("Dry patch");
  });

  it("sorts risk first, then by confidence, and keeps at most 3", () => {
    const out = selectFindings([
      f({ label: "Clear hi", severity: "clear", confidence: 0.99, bbox: [0, 0, 300, 300] }),
      f({ label: "Risk lo", confidence: 0.65, bbox: [350, 0, 650, 300] }),
      f({ label: "Risk hi", confidence: 0.95, bbox: [700, 0, 999, 300] }),
      f({ label: "Clear lo", severity: "clear", confidence: 0.7, bbox: [0, 400, 300, 700] }),
    ]);
    expect(out.map((x) => x.label)).toEqual(["Risk hi", "Risk lo", "Clear hi"]);
  });

  it("returns nothing for nothing", () => {
    expect(selectFindings([])).toEqual([]);
  });
});

describe("shownTracks", () => {
  const track = (id: number, over: Partial<Track> = {}): Track => ({ ...f(), id, missed: 0, ...over });

  it("keeps only tracks seen recently, risk first, at most 3", () => {
    const out = shownTracks([
      track(1, { severity: "clear", confidence: 0.99 }),
      track(2, { confidence: 0.7 }),
      track(3, { confidence: 0.95 }),
      track(4, { confidence: 0.9 }),
      track(5, { confidence: 0.99, missed: 3 }), // gone from the last frames
    ]);
    expect(out.map((t) => t.id)).toEqual([3, 4, 2]);
  });
});

describe("toneOf", () => {
  it("is clear for clear, risk for a confident risk, and watch for a shaky one", () => {
    expect(toneOf(f({ severity: "clear" }))).toBe("clear");
    expect(toneOf(f({ confidence: 0.9 }))).toBe("risk");
    expect(toneOf(f({ confidence: 0.7 }))).toBe("watch");
    expect(toneOf(f({ confidence: undefined }))).toBe("risk");
  });
});

describe("findingLine", () => {
  it("joins the name and the action: 'Dry grass, mow by June 1'", () => {
    expect(findingLine(f())).toBe("Dry grass, mow by June 1");
    expect(findingLine(f({ action: "Keep it trimmed." }))).toBe("Dry grass, keep it trimmed");
  });
});

describe("layoutLabels", () => {
  const area = { w: 390, h: 844 };
  const safe = { top: 64, right: 12, bottom: 232, left: 12 };
  const item = (key: number, x: number, y: number, width: number, height: number, label = "Dry grass"): LabelItem => ({
    key,
    rect: { x, y, width, height },
    label,
  });
  type P = { x: number; y: number; w: number; h: number };
  const inside = (p: P) =>
    p.x >= safe.left && p.y >= safe.top && p.x + p.w <= area.w - safe.right && p.y + p.h <= area.h - safe.bottom;
  const overlap = (a: P, b: P) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("puts the pill just above the box when there is room", () => {
    const p = layoutLabels([item(1, 100, 300, 120, 100)], area, safe).get(1)!;
    expect(p.y + p.h).toBeLessThanOrEqual(300);
    expect(inside(p)).toBe(true);
  });

  it("puts the pill below the box when there is no room above", () => {
    const p = layoutLabels([item(1, 100, 70, 120, 100)], area, safe).get(1)!;
    expect(p.y).toBeGreaterThanOrEqual(170);
    expect(inside(p)).toBe(true);
  });

  it("clamps pills inside the safe area at the left and right edges", () => {
    const left = layoutLabels([item(1, -30, 300, 100, 100)], area, safe).get(1)!;
    const right = layoutLabels([item(1, 360, 300, 100, 100, "Brush near the barn wall")], area, safe).get(1)!;
    expect(inside(left)).toBe(true);
    expect(inside(right)).toBe(true);
  });

  it("keeps a pill inside the safe area even when the box fills the screen", () => {
    const p = layoutLabels([item(1, 0, 0, 390, 844)], area, safe).get(1)!;
    expect(inside(p)).toBe(true);
  });

  it("keeps pills from colliding when boxes share the same spot", () => {
    const items = [
      item(1, 100, 300, 120, 100),
      item(2, 100, 300, 120, 100, "Dry brush"),
      item(3, 110, 310, 120, 100, "Leaf litter"),
    ];
    const out = layoutLabels(items, area, safe);
    const ps = items.map((i) => out.get(i.key)!);
    for (let i = 0; i < ps.length; i++) {
      expect(inside(ps[i])).toBe(true);
      for (let j = i + 1; j < ps.length; j++) expect(overlap(ps[i], ps[j])).toBe(false);
    }
    expect(ps[0].h).toBe(PILL_H);
  });
});
