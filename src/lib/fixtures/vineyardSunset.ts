import type { EstimateGrid, Mask } from "../fuelMask";

/**
 * A synthetic copy of the sunset vineyard photo the scanner failed on: a dirt road up the middle, a thin straw strip on
 * each side of it, vine rows outside those, sky on top, all under a warm cast. It stands in for
 * eval/data/own/vineyard-sunset.jpg until that photo and its cached SAM and estimate replies are checked in.
 * SAM finds the sky and the vines but misses both strips; the estimate's 6x8 grid calls the road columns "soil" (each strip
 * is a third of a cell wide, so it never wins one) and gives a single "dry" cell at the bottom left.
 */
export const SUNSET = { w: 384, h: 288, srcW: 384, dryPct: 25, vegFrac: 0.45 };
/** Pixel columns [from, to) of each part, below the sky. */
export const SUNSET_PARTS = { sky: 96, leftStrip: [128, 160], road: [160, 224], rightStrip: [224, 256] } as const;

/** The light: neutral straw (hue 44, Lab hue 90) lands at hue 34 / Lab 75, right at the old h >= 31 cut-off. */
const CAST = [1.13, 0.955, 0.83];
const STRAW = [200, 176, 112];
const DIRT = [166, 134, 100];
const VINE = [70, 112, 52];
const SKY = [235, 190, 150];

export function sunsetVineyard(): { rgba: Uint8ClampedArray; masks: Mask[]; grid: EstimateGrid } {
  const { w, h } = SUNSET;
  const { sky, leftStrip, road, rightStrip } = SUNSET_PARTS;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1; // -1 to 1, the same every run
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inStrip = (x >= leftStrip[0] && x < leftStrip[1]) || (x >= rightStrip[0] && x < rightStrip[1]);
      const [base, rough] = y < sky ? [SKY, 2] : x >= road[0] && x < road[1] ? [DIRT, 3] : inStrip ? [STRAW, 26] : [VINE, 22]; // grass and leaves are rough, dirt is smooth
      const n = noise() * rough;
      for (let c = 0; c < 3; c++) rgba[(y * w + x) * 4 + c] = (base[c] + n) * CAST[c];
    }
  }
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const masks: Mask[] = [
    { group: "exclude", polys: [rect(0, 0, w, sky)] },
    { group: "live", polys: [rect(0, sky, leftStrip[0], h)] },
    { group: "live", polys: [rect(rightStrip[1], sky, w, h)] },
  ];
  const row = (cells: string) => cells.split(" ");
  const grid = [
    row("other other other other other other other other"),
    row("other other other other other other other other"),
    row("other other other soil soil other other other"),
    row("other other other soil soil other other other"),
    row("other other other soil soil other other other"),
    row("other other dry soil soil other other other"),
  ];
  return { rgba, masks, grid };
}
