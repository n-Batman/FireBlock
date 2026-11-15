import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RISK_STOPS, scaleColor } from "./riskScale";

function rgbAt(score: number) {
  return scaleColor(score).match(/\d+/g)!.map(Number);
}

function luminance(score: number) {
  const [r, g, b] = rgbAt(score).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("scaleColor", () => {
  it("uses the exact stop colours and gets darker as risk increases", () => {
    RISK_STOPS.forEach(({ score, rgb }, index) => {
      expect(rgbAt(score)).toEqual(rgb);
      if (index > 0) expect(luminance(score)).toBeLessThan(luminance(RISK_STOPS[index - 1].score));
    });
  });

  it("interpolates between stops and clearly separates scores of 12 and 24", () => {
    expect(rgbAt(12)).toEqual(rgbAt(8).map((channel, i) => Math.round((channel + rgbAt(16)[i]) / 2)));
    expect(rgbAt(12)[1] - rgbAt(24)[1]).toBeGreaterThan(60);
  });

  it("can be made see-through for a chip background", () => {
    expect(scaleColor(50, 0.18)).toBe(`rgba(${rgbAt(50).join(", ")}, 0.18)`);
  });

  it("keeps a score outside 0 to 100 on the scale", () => {
    expect(scaleColor(-5)).toBe(scaleColor(0));
    expect(scaleColor(140)).toBe(scaleColor(100));
    expect(scaleColor(100)).toBe(scaleColor(90));
  });
});

it("uses the shared scale for both overlay fills without an inline HSL formula", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/ParcelOverlay.tsx"), "utf8");
  expect(source).toMatch(/import\s+\{\s*scaleColor\s*\}\s+from\s+["']\.\/riskScale["']/);
  expect(source.match(/fillColor:[^\n]*\bscaleColor\(score\)/g)).toHaveLength(2);
  expect(source).not.toMatch(/\bhsl\(\$\{/);
});
