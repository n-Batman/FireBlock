import { describe, it, expect } from "vitest";
import { DEMO_DURATION, demoFindingsAt } from "./demoFindings";

describe("demoFindingsAt", () => {
  it("finds nothing before the first marked moment", () => {
    expect(demoFindingsAt(0)).toEqual([]);
  });

  it("moves a box smoothly while it is on screen", () => {
    const early = demoFindingsAt(3).find((f) => f.label === "Dry growth")!;
    const later = demoFindingsAt(7).find((f) => f.label === "Dry growth")!;
    expect(early.severity).toBe("risk");
    expect(later.bbox[0]).toBeGreaterThan(early.bbox[0]);
  });

  it("can show a risk and a second risk at once", () => {
    const labels = demoFindingsAt(6).map((f) => f.label);
    expect(labels).toContain("Dry growth");
    expect(labels).toContain("Brush touching barn");
  });

  it("ends with a cleared area", () => {
    expect(demoFindingsAt(18).some((f) => f.severity === "clear")).toBe(true);
  });

  it("loops with the video", () => {
    expect(demoFindingsAt(DEMO_DURATION + 3)).toEqual(demoFindingsAt(3));
  });

  it("keeps every box inside 0 to 999", () => {
    for (let t = 0; t < DEMO_DURATION; t += 0.5) {
      for (const f of demoFindingsAt(t)) {
        for (const v of f.bbox) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(999);
        }
        expect(f.bbox[2]).toBeGreaterThan(f.bbox[0]);
        expect(f.bbox[3]).toBeGreaterThan(f.bbox[1]);
      }
    }
  });
});
