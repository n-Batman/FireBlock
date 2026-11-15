import { describe, expect, it } from "vitest";
import { classify, CLEAR, colourOf, liveColourOf, NEUTRAL, RISK, riskAreas, smooth, verdict } from "./fuelMask";

const px = (...rgb: [number, number, number][]) => Uint8ClampedArray.from(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
const STRAW: [number, number, number] = [200, 170, 110]; // cured grass
const GREEN: [number, number, number] = [80, 150, 60];
const SKY: [number, number, number] = [90, 140, 210];
const DIRT: [number, number, number] = [170, 120, 90]; // redder brown
const TRUNK: [number, number, number] = [90, 70, 50]; // dark brown
const POST: [number, number, number] = [150, 150, 150];

describe("colourOf", () => {
  it("rates straw as risk and green as clear", () => {
    expect(colourOf(...STRAW)).toBe(RISK);
    expect(colourOf(...GREEN)).toBe(CLEAR);
  });

  it("keeps sky, posts, dark trunks and reddish dirt neutral", () => {
    expect([SKY, POST, TRUNK, DIRT].map((c) => colourOf(...c))).toEqual([NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL]);
  });
});

const LAWN: [number, number, number] = [190, 180, 90]; // sunlit yellow-green grass, hue 54

describe("liveColourOf", () => {
  it("rates sunlit yellow-green lawn as clear and straw as risk", () => {
    expect(colourOf(...LAWN)).toBe(RISK); // the strict band alone would call it fuel
    expect(liveColourOf(...LAWN)).toBe(CLEAR);
    expect(liveColourOf(...STRAW)).toBe(RISK);
    expect([...classify(px(LAWN, STRAW), 2, 1, masks([0, 0], [1, 1], [0, 0]))]).toEqual([CLEAR, RISK]);
  });
});

const PALE: [number, number, number] = [205, 185, 180]; // pinkish dead grass
const masks = (dry: number[], live: number[], exclude: number[]) => ({ dry: Uint8Array.from(dry), live: Uint8Array.from(live), exclude: Uint8Array.from(exclude) });

describe("classify", () => {
  it("exclude wins; dry masks use the wide band (pale pink counts); live masks the strict band", () => {
    const rgba = px(PALE, PALE, STRAW, GREEN);
    const m = masks([1, 1, 0, 1], [0, 0, 1, 0], [0, 1, 0, 0]);
    expect([...classify(rgba, 4, 1, m)]).toEqual([RISK, NEUTRAL, RISK, CLEAR]);
    expect([...classify(px(PALE), 1, 1, masks([0], [1], [0]))]).toEqual([NEUTRAL]); // pale in a live mask is not fuel
  });

  it("inside a dry mask a risk colour needs grassy texture; flat pale ground (smooth soil) stays neutral", () => {
    const dry = masks([1, 1], [0, 0], [0, 0]);
    expect([...classify(px(PALE, PALE), 2, 1, dry)]).toEqual([NEUTRAL, NEUTRAL]);
    expect([...classify(px(PALE, [120, 100, 60]), 2, 1, dry)]).toEqual([RISK, RISK]);
  });

  it("outside every mask green is clear, tan is risk only with grassy texture, and no masks means colour alone", () => {
    const none = masks([0, 0], [0, 0], [0, 0]);
    expect([...classify(px(STRAW, STRAW), 2, 1, none)]).toEqual([NEUTRAL, NEUTRAL]); // flat tan = smooth dirt
    expect([...classify(px(STRAW, [120, 100, 60]), 2, 1, none)]).toEqual([RISK, NEUTRAL]); // textured tan
    expect([...classify(px(STRAW, GREEN), 2, 1, null)]).toEqual([RISK, CLEAR]);
  });
});

describe("smooth", () => {
  it("removes a lone speck and keeps a solid patch", () => {
    const w = 9;
    const labels = new Uint8Array(w * w).fill(CLEAR);
    labels[4 * w + 4] = RISK; // one speck
    expect(smooth(labels, w, w)[4 * w + 4]).toBe(CLEAR);
    const block = new Uint8Array(w * w).fill(RISK);
    expect(smooth(block, w, w).every((l) => l === RISK)).toBe(true);
  });
});

describe("verdict", () => {
  const of = (risk: number, clear: number, neutral = 0) =>
    verdict([...Array(risk).fill(RISK), ...Array(clear).fill(CLEAR), ...Array(neutral).fill(NEUTRAL)]);

  it("scores risk / (risk + clear); sky and dirt (neutral) are not in the denominator", () => {
    expect(of(25, 75, 900).share).toBe(0.25);
  });

  it("says all clear only with zero risk pixels, and shows <1% for tiny shares", () => {
    expect(of(0, 100).level).toBe("clear");
    expect(of(1, 999).level).toBe("low");
    expect(of(1, 999).text).toMatch(/<1%/);
    expect(of(3, 97).text).not.toMatch(/all clear/i);
    expect(of(0, 0, 10).level).toBe("none");
  });

  it("steps to moderate at 15% and high at 40%", () => {
    expect([of(14, 86).level, of(15, 85).level, of(40, 60).level]).toEqual(["low", "moderate", "high"]);
  });
});

describe("riskAreas", () => {
  it("groups touching risk pixels, biggest first, with boxes, shares and location words; drops specks", () => {
    const w = 20;
    const h = 20;
    const labels = new Uint8Array(w * h);
    for (let y = 14; y < 20; y++) for (let x = 12; x < 20; x++) labels[y * w + x] = RISK; // 48 px, bottom right
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) labels[y * w + x] = RISK; // 16 px, top left
    const areas = riskAreas(labels, w, h);
    expect(areas.map((a) => [a.id, a.where, a.pctOfRisk])).toEqual([
      [1, "bottom right", 75],
      [2, "top left", 25],
    ]);
    expect(areas[0].box).toEqual([0.6, 0.7, 1, 1]);
  });
});

describe("rasterise / scan", () => {
  const square = (a: number, b: number): [number, number][] => [[a, a], [b, a], [b, b], [a, b]];
  it("fills a mask scaled to the working size and keeps holes as holes (even-odd)", async () => {
    const { rasterise } = await import("./fuelMask");
    const m = rasterise([{ group: "dry", polys: [[[0, 0], [20, 0], [20, 10], [0, 10]]] }], 20, 10, 10);
    expect([...m.dry].reduce((a, b) => a + b, 0)).toBe(50);
    const holed = rasterise([{ group: "dry", polys: [square(0, 20), square(5, 15)] }], 20, 20, 20);
    expect(holed.dry[10 * 20 + 10]).toBe(0);
    expect(holed.dry[2 * 20 + 2]).toBe(1);
  });

  it("drops risk specks from the map itself and never says all clear while red is drawn", async () => {
    const { scan } = await import("./fuelMask");
    const w = 40;
    const rgba = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let i = 0; i < w * w; i++) [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] = GREEN;
    for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) [rgba[(y * w + x) * 4], rgba[(y * w + x) * 4 + 1], rgba[(y * w + x) * 4 + 2]] = STRAW; // 4 px speck
    const all = [{ group: "dry" as const, polys: [square(0, 40)] }];
    const r = scan(rgba, w, w, w, all);
    expect(r.labels.includes(RISK)).toBe(false);
    expect(r.verdict.level).toBe("clear");
    for (let y = 20; y < 40; y++) for (let x = 0; x < 40; x++) [rgba[(y * w + x) * 4], rgba[(y * w + x) * 4 + 1], rgba[(y * w + x) * 4 + 2]] = STRAW;
    const big = scan(rgba, w, w, w, all);
    expect(big.verdict.level).not.toBe("clear");
    expect(big.areas.length).toBeGreaterThan(0);
    expect(big.colourOnly).toBe(false);
  });

  describe("grid gate", () => {
    // 40x40 all straw (every pixel RISK by colour alone), split into a 2x2 tile grid.
    const w = 40;
    const rgba = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let i = 0; i < w * w; i++) [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] = STRAW;
    const at = (r: { labels: Uint8Array }, x: number, y: number) => r.labels[y * w + x];

    it("turns RISK pixels in soil and other tiles neutral and keeps them in dry tiles", async () => {
      const { scan } = await import("./fuelMask");
      const r = scan(rgba, w, w, w, null, [["dry", "soil"], ["other", "dry"]]);
      expect(at(r, 5, 5)).toBe(RISK); // dry tile
      expect(at(r, 35, 35)).toBe(RISK); // dry tile
      expect(at(r, 30, 5)).toBe(NEUTRAL); // soil tile
      expect(at(r, 5, 30)).toBe(NEUTRAL); // other tile
    });

    it("keeps live tiles as they are and leaves the output identical without a grid", async () => {
      const { scan } = await import("./fuelMask");
      const none = scan(rgba, w, w, w, null);
      expect(none.labels.every((l) => l === RISK)).toBe(true);
      expect(scan(rgba, w, w, w, null, undefined)).toEqual(none);
      expect(scan(rgba, w, w, w, null, [["live", "live"], ["live", "live"]]).labels).toEqual(none.labels);
    });
  });
});
