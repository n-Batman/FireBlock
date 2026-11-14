import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scaleColor } from "./riskScale";

describe("scaleColor", () => {
  it("is yellow at 0 and red at 100, on Nick's 0 to 100 scale", () => {
    expect(scaleColor(0)).toBe("hsl(45 75% 75%)");
    expect(scaleColor(100)).toBe("hsl(0 75% 37%)");
  });

  it("moves smoothly between: hue falls 0.45 and lightness 0.38 per point", () => {
    expect(scaleColor(12)).toBe(`hsl(${45 - 12 * 0.45} 75% ${75 - 12 * 0.38}%)`);
    expect(scaleColor(50)).toBe("hsl(22.5 75% 56%)");
  });

  it("can be made see-through for a chip background", () => {
    expect(scaleColor(50, 0.18)).toBe("hsl(22.5 75% 56% / 0.18)");
  });

  it("keeps a score outside 0 to 100 on the scale", () => {
    expect(scaleColor(-5)).toBe(scaleColor(0));
    expect(scaleColor(140)).toBe(scaleColor(100));
  });
});

describe("the same colours as Nick's parcel fill", () => {
  // His overlay builds the fill inline: hsl(${45-score*.45} 75% ${75-score*.38}%). It is not exported
  // and is not mine to change, so this reads his source and checks my function against his formula.
  const source = readFileSync(resolve(process.cwd(), "src/lib/ParcelOverlay.tsx"), "utf8");
  const formulas = [...source.matchAll(/hsl\(\$\{([^}]+)\} 75% \$\{([^}]+)\}%\)/g)];

  it("finds his formula in his overlay (if this fails, his colour scale moved)", () => {
    expect(formulas.length).toBeGreaterThanOrEqual(1);
  });

  it.each([0, 4, 12, 24.6, 40, 67, 100])("gives the same colour for a score of %s", (score) => {
    for (const [, hue, light] of formulas) {
      const his = new Function("score", `return \`hsl(\${${hue}} 75% \${${light}}%)\`;`)(score) as string;
      expect(scaleColor(score)).toBe(his);
    }
  });
});
