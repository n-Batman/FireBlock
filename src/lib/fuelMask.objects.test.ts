// @vitest-environment node
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAP_WIDTH, RISK, scan, type Mask } from "./fuelMask";

/**
 * A frame of textured straw (the green channel jitters by a fixed pattern so local texture clears TEXTURE_MIN) with a grey
 * strip on the right, so white balance has something to balance against and does not grey the straw.
 */
function straw(w: number, h: number) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const jitter = ((i * 7919) % 41) - 20;
    out.set(i % w >= w - 24 ? [128, 128, 128, 255] : [225 + jitter / 2, 185 + jitter, 105, 255], i * 4);
  }
  return out;
}
const box = (x0: number, x1: number, h: number): [number, number][] => [[x0, 0], [x1, 0], [x1, h], [x0, h]];
const share = (labels: Uint8Array, w: number, x0: number, x1: number, h: number) => {
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (labels[y * w + x] === RISK) n++;
  return n / ((x1 - x0) * h);
};

describe("object excludes", () => {
  const w = 80;
  const h = 60;
  const grid = [Array(8).fill("dry")];
  const dry: Mask = { group: "dry", polys: [box(0, 40, h)] };

  it("hold against straw colour in a dry tile, where a soft exclude (bare or plowed soil) is overridden by grassy straw", () => {
    const run = (right: Mask) => scan(straw(w, h), w, h, w, [dry, right], grid, 100, 1).labels;
    const hard = run({ group: "exclude", polys: [box(40, 80, h)], hard: true });
    const soft = run({ group: "exclude", polys: [box(40, 80, h)] });
    expect(share(hard, w, 46, 56, h)).toBe(0);
    expect(share(soft, w, 46, 56, h)).toBeGreaterThan(0.5);
  });
});

describe("agreement and reasons", () => {
  it("counts SAM dry mask, straw colour and a dry tile, and names them per area", () => {
    const w = 80;
    const h = 60;
    const both = scan(straw(w, h), w, h, w, [{ group: "dry", polys: [box(0, 80, h)] }], [Array(8).fill("dry")]);
    expect(both.agree![30 * w + 40]).toBe(3);
    expect(both.areas[0].reasons).toEqual(["SAM: dry grass", "colour: straw", "GPT: dry tile"]);
    const colourOnly = scan(straw(w, h), w, h, w, null);
    expect(colourOnly.agree![30 * w + 40]).toBe(1);
    expect(colourOnly.areas[0].reasons).toEqual(["colour: straw"]);
    expect(colourOnly.agree![0]).toBeLessThanOrEqual(1);
  });
});

/** The real Silver River photo (eval/data/own/vineyard-dog.jpg at 384 px) with its saved SAM replies (both calls) and estimate; regenerate with scripts/eval/fixture.ts. */
describe("vineyard-dog photo", () => {
  const dir = "src/lib/fixtures/vineyard-dog";
  it("leaves the road and the dog alone and marks the tall grass beside the fence", async () => {
    const { data, info } = await sharp(`${dir}/photo.jpg`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { srcW, masks, estimate } = JSON.parse(readFileSync(`${dir}/replies.json`, "utf8"));
    expect(info.width).toBe(MAP_WIDTH);
    const { w, h, labels } = scan(data, info.width, info.height, srcW, masks, estimate.grid, estimate.dryPct, estimate.vegFrac);
    const region = ([x0, y0, x1, y1]: number[]) => {
      let n = 0;
      let t = 0;
      for (let y = Math.floor(y0 * h); y < y1 * h; y++) {
        for (let x = Math.floor(x0 * w); x < x1 * w; x++) {
          t++;
          if (labels[y * w + x] === RISK) n++;
        }
      }
      return n / t;
    };
    expect(region([0.1, 0.7, 0.55, 0.97])).toBeLessThan(0.02); // dirt road
    expect(region([0.43, 0.43, 0.49, 0.52])).toBeLessThan(0.02); // the dog
    expect(region([0.82, 0.5, 1, 0.72])).toBeGreaterThan(0.4); // tall grass along the fence
  });
});
