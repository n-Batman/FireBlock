import { describe, expect, it } from "vitest";
import { CLEAR, NEUTRAL, RISK } from "@/lib/fuelMask";
import { paint } from "./FuelOverlay";

describe("paint", () => {
  it("washes clear green with a softer edge, fills risk red with a stronger edge, leaves neutral empty", () => {
    const w = 5;
    const labels = Uint8Array.from([
      CLEAR, CLEAR, NEUTRAL, NEUTRAL, NEUTRAL,
      CLEAR, CLEAR, RISK, RISK, RISK,
      NEUTRAL, NEUTRAL, RISK, RISK, RISK,
      NEUTRAL, NEUTRAL, RISK, RISK, RISK,
    ]);
    const out = new Uint8ClampedArray(labels.length * 4);
    paint({ w, h: 4, labels }, out);
    const at = (i: number) => [...out.slice(i * 4, i * 4 + 4)];
    expect(at(0)).toEqual([74, 222, 128, Math.round(0.32 * 255)]);
    expect(at(6)[3]).toBe(Math.round(0.18 * 255)); // clear next to risk: softer edge
    expect(at(2)).toEqual([0, 0, 0, 0]);
    expect(at(13)).toEqual([239, 68, 68, Math.round(0.38 * 255)]); // inside the risk patch
    expect(at(7)[3]).toBeGreaterThan(at(13)[3]); // on its edge
  });
});
