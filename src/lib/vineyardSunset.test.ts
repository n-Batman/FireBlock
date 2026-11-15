import { describe, expect, it } from "vitest";
import { RISK, scan } from "./fuelMask";
import { SUNSET, SUNSET_PARTS, sunsetVineyard } from "./fixtures/vineyardSunset";

/** RISK share of the columns [x0, x1) below the sky. */
function riskShare(labels: Uint8Array, x0: number, x1: number): number {
  const { w, h } = SUNSET;
  let n = 0;
  for (let y = SUNSET_PARTS.sky; y < h; y++) for (let x = x0; x < x1; x++) if (labels[y * w + x] === RISK) n++;
  return n / ((h - SUNSET_PARTS.sky) * (x1 - x0));
}

describe("sunset vineyard regression", () => {
  const { w, h, srcW, dryPct, vegFrac } = SUNSET;
  const { rgba, masks, grid } = sunsetVineyard();
  const map = scan(rgba, w, h, srcW, masks, grid, dryPct, vegFrac);

  it("marks the straw strips on both sides of the road", () => {
    expect(riskShare(map.labels, ...SUNSET_PARTS.leftStrip)).toBeGreaterThan(0.6);
    expect(riskShare(map.labels, ...SUNSET_PARTS.rightStrip)).toBeGreaterThan(0.6);
  });

  it("keeps the dirt road under 3% risk", () => {
    expect(riskShare(map.labels, ...SUNSET_PARTS.road)).toBeLessThan(0.03);
  });

  it("covers about the area the estimate implies", () => {
    const risk = map.labels.reduce((n, l) => n + (l === RISK ? 1 : 0), 0) / (w * h);
    expect(Math.abs(risk - (dryPct / 100) * vegFrac)).toBeLessThan(0.05);
  });
});
