import { describe, it, expect } from "vitest";
import {
  createTracker,
  isVisible,
  iou,
  mapBoxToRect,
  scanDelta,
  summarize,
  updateTracker,
  withScan,
  type BBox,
  type TrackerState,
} from "./scan";
import { scoreOf } from "./score";
import { properties } from "@/data/properties";
import type { Block, Finding } from "@/data/types";

const risk = (label: string, bbox: BBox): Finding => ({
  label,
  severity: "risk",
  action: "Mow by June 1",
  bbox,
});
const clear = (label: string, bbox: BBox): Finding => ({
  label,
  severity: "clear",
  action: "Keep it this way",
  bbox,
});
const A: BBox = [100, 100, 300, 300];
const B: BBox = [500, 500, 700, 700];

function run(...frames: Finding[][]): TrackerState {
  let state = createTracker();
  for (const f of frames) state = updateTracker(state, f).state;
  return state;
}

describe("mapBoxToRect", () => {
  it("scales a box when video and screen have the same shape", () => {
    expect(mapBoxToRect([100, 200, 300, 400], { w: 1000, h: 1000 }, { w: 500, h: 500 })).toEqual({
      x: 50,
      y: 100,
      width: 100,
      height: 100,
    });
  });

  it("accounts for the sides cropped by object-fit cover", () => {
    // 2000x1000 video in a 1000x1000 box: scale 1, 500px cropped off each side.
    expect(mapBoxToRect([500, 0, 750, 500], { w: 2000, h: 1000 }, { w: 1000, h: 1000 })).toEqual({
      x: 500,
      y: 0,
      width: 500,
      height: 500,
    });
  });

  it("accounts for the top and bottom cropped by object-fit cover", () => {
    // 1000x2000 video in a 1000x1000 box: scale 1, 500px cropped off top and bottom.
    expect(mapBoxToRect([0, 500, 500, 750], { w: 1000, h: 2000 }, { w: 1000, h: 1000 })).toEqual({
      x: 0,
      y: 500,
      width: 500,
      height: 500,
    });
  });
});

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint boxes", () => {
    expect(iou(A, A)).toBe(1);
    expect(iou(A, B)).toBe(0);
  });
  it("is one third for boxes overlapping by half", () => {
    expect(iou([0, 0, 100, 100], [50, 0, 150, 100])).toBeCloseTo(1 / 3, 5);
  });
});

describe("tracker status", () => {
  it("stays 'scanning' after one frame and flips after two consistent frames", () => {
    expect(run([risk("Dry growth", A)]).status).toBe("scanning");
    expect(run([risk("Dry growth", A)], [risk("Dry growth", A)]).status).toBe("risks");
    expect(run([], []).status).toBe("clear");
  });

  it("ignores one stray frame", () => {
    expect(run([], [], [risk("Dry growth", A)], []).status).toBe("clear");
  });

  it("needs two clean frames to go from risks back to clear", () => {
    const r = [risk("Dry growth", A)];
    expect(run(r, r, []).status).toBe("risks");
    expect(run(r, r, [], []).status).toBe("clear");
  });
});

describe("tracker boxes", () => {
  it("keeps one id for the same label on an overlapping box", () => {
    const first = run([risk("Dry growth", A)]);
    const second = updateTracker(first, [risk("Dry growth", A)]).state;
    expect(second.tracks).toHaveLength(1);
    expect(second.tracks[0].id).toBe(first.tracks[0].id);
  });

  it("starts a new track for a new label or a far-away box", () => {
    const first = run([risk("Dry growth", A)]);
    expect(updateTracker(first, [risk("Dry growth", A), risk("Brush on barn", B)]).state.tracks).toHaveLength(2);
    expect(updateTracker(first, [risk("Dry growth", B)]).state.tracks).toHaveLength(2);
  });

  it("eases a moved box part of the way toward the new position", () => {
    const first = run([risk("Dry growth", A)]);
    const moved = updateTracker(first, [risk("Dry growth", [110, 100, 310, 300])]).state;
    expect(moved.tracks[0].bbox[0]).toBeCloseTo(106, 5);
  });

  it("reports a risk as new only the first time it appears", () => {
    const first = updateTracker(createTracker(), [risk("Dry growth", A)]);
    expect(first.newRisks).toHaveLength(1);
    expect(updateTracker(first.state, [risk("Dry growth", A)]).newRisks).toHaveLength(0);
    expect(updateTracker(createTracker(), [clear("Cleared row", A)]).newRisks).toHaveLength(0);
  });

  it("keeps a vanished box for 2 missed frames, hides it on the 3rd, removes it after 5", () => {
    const seen = run([risk("Dry growth", A)], [risk("Dry growth", A)]);
    const after = (n: number) => {
      let s = seen;
      for (let i = 0; i < n; i++) s = updateTracker(s, []).state;
      return s;
    };
    expect(isVisible(after(2).tracks[0])).toBe(true);
    expect(isVisible(after(3).tracks[0])).toBe(false);
    expect(after(4).tracks).toHaveLength(1);
    expect(after(5).tracks).toHaveLength(0);
  });
});

describe("score feed", () => {
  it("counts only visible tracks", () => {
    const s = run([risk("Dry growth", A)], [risk("Dry growth", A), clear("Cleared row", B)]);
    expect(summarize(s.tracks)).toEqual({ risks: 1, clears: 1 });
    let gone = s;
    for (let i = 0; i < 3; i++) gone = updateTracker(gone, []).state;
    expect(summarize(gone.tracks)).toEqual({ risks: 0, clears: 0 });
  });

  it("adds 6 per risk and takes off 3 per cleared area, within -15 and +25", () => {
    expect(scanDelta(3, 0)).toBe(25); // all risk
    expect(scanDelta(0, 10)).toBe(-15); // all clear
    expect(scanDelta(1, 1)).toBe(5); // half
    expect(scanDelta(22, 42)).toBe(Math.round((22 / 64) * 40 - 15)); // cell counts work the same way
    expect(scanDelta(0, 0)).toBe(0);
  });
});

describe("withScan", () => {
  const ridgeTop = properties[0].blocks.find((b) => b.id === "adelaida-3")!;
  const asOf = "2026-11-14T10:00:00-08:00";

  it("adds a photo scan factor that moves the score by the delta", () => {
    const scanned = withScan(ridgeTop, 10, asOf);
    expect(scanned.factors).toHaveLength(6);
    const last = scanned.factors[5];
    expect(last.key).toBe("photoScan");
    expect(last.label).toBe("Photo scan");
    expect(last.points).toBe(10);
    expect(last.asOf).toBe(asOf);
    expect(scoreOf(scanned)).toBe(88);
    expect(scoreOf(ridgeTop)).toBe(78);
  });

  it("never pushes a score past 100 or below 0", () => {
    expect(scoreOf(withScan(ridgeTop, 25, asOf))).toBe(100);
    const tiny: Block = { ...ridgeTop, factors: [{ ...ridgeTop.factors[0], points: 5 }] };
    expect(scoreOf(withScan(tiny, -15, asOf))).toBe(0);
  });

  it("returns the block unchanged when the delta is zero", () => {
    expect(withScan(ridgeTop, 0, asOf)).toBe(ridgeTop);
  });
});
