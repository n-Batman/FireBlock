import { describe, expect, it } from "vitest";
import { classify, CLEAR, colourOf, NEUTRAL, RISK, riskAreas, smooth, verdict } from "./fuelMask";

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

describe("classify", () => {
  it("rates by colour inside the mask; outside it, straw is neutral and only green counts (as clear)", () => {
    const rgba = px(STRAW, GREEN, STRAW, GREEN);
    expect([...classify(rgba, 4, 1, [1, 1, 0, 0])]).toEqual([RISK, CLEAR, NEUTRAL, CLEAR]);
    expect([...classify(rgba, 4, 1, null)]).toEqual([RISK, CLEAR, RISK, CLEAR]); // colour-only fallback
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

  it("never says all clear above 3%, and says it at 3% or less", () => {
    expect(of(4, 96).level).toBe("low");
    expect(of(4, 96).text).not.toMatch(/all clear/i);
    expect(of(3, 97).level).toBe("clear");
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
  it("fills a polygon scaled to the working size", async () => {
    const { rasterise, scan } = await import("./fuelMask");
    const m = rasterise([[[0, 0], [20, 0], [20, 10], [0, 10]]], 20, 10, 10); // left-top half of a 20x20 frame at 10x10
    expect([...m].reduce((a, b) => a + b, 0)).toBe(50);
    const rgba = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    for (let i = 0; i < 100; i++) [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] = STRAW;
    const r = scan(rgba, 10, 10, 20, [[[0, 0], [20, 0], [20, 10], [0, 10]]]);
    expect(r.verdict.risk).toBeGreaterThan(30); // smoothing trims the edge, so not exactly 50
    expect(r.verdict.risk).toBeLessThan(100); // straw outside the mask stays neutral
    expect(r.colourOnly).toBe(false);
  });
});
