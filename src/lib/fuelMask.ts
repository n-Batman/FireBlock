/**
 * Turns a frame (and, when Roboflow answers, its vegetation masks) into a per-pixel fuel map:
 * the pixel's colour decides risk, not the mask's label. Tan, straw and brown = risk, green = clear,
 * everything else (sky, posts, shadows, and dirt when there are masks) = neutral and out of the score.
 */

/** Which kind of thing a segmentation mask says it is. Dry = fuel, live = living plants, exclude = never fuel (soil, trunks, posts, sky, snow, autumn leaves). */
export type Group = "dry" | "live" | "exclude";
/** Polygons in pixels of the sent frame. */
export type Polygon = [number, number][];
/** One segmentation result: its rings are filled even-odd together, so a ring inside another is a hole. */
export interface Mask {
  group: Group;
  polys: Polygon[];
}
/** Per-group 0/1 pixel masks at working size. */
export interface Masks {
  dry: Uint8Array;
  live: Uint8Array;
  exclude: Uint8Array;
}

export const NEUTRAL = 0;
export const CLEAR = 1;
export const RISK = 2;
export type Label = typeof NEUTRAL | typeof CLEAR | typeof RISK;

/** Width of the working map. The overlay is this map scaled up and softened, so it reads as smooth shapes. */
export const MAP_WIDTH = 384;
/** Luminance spread (0..255, 5x5 window) above which an unmasked tan pixel looks like grass, not smooth dirt. ponytail: tuned on the eval set. */
export const TEXTURE_MIN = 7;

/** Hue 0..360, saturation and value 0..1. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/** Pixels brighter than this (sky, glare) or darker than WB_DARK (shade) say little about the light and are left out of the estimate. */
const WB_BRIGHT = 0.92;
const WB_DARK = 0.15;
/** Minkowski norm of Shades-of-Grey; 6 is the value Finlayson & Trezzi (2004) found best. */
const WB_P = 6;
/** Per-channel gain limits. */
const WB_GAIN: [number, number] = [0.6, 1.6];
/**
 * How much of the correction is applied (gain ** WB_STRENGTH). At 1 a frame that really is all golden grass or all lawn
 * turns grey; 0.5 was the best of 0, 0.35, 0.5, 0.65 and 1 on the v2 eval's training split.
 */
const WB_STRENGTH = 0.5;

/**
 * A white-balanced copy of the frame: the scene illuminant is estimated with Shades-of-Grey (Finlayson & Trezzi 2004,
 * p = 6) from pixels that are not sky-bright, dark or clipped, and each channel is scaled part of the way to making
 * that illuminant grey (WB_STRENGTH).
 * Only classify and reconcile read the copy; the overlay is still drawn on the real photo.
 */
export function whiteBalance(rgba: ArrayLike<number>, w: number, h: number): Uint8ClampedArray {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const max = Math.max(r, g, b);
    if (max > WB_BRIGHT * 255 || max < WB_DARK * 255 || Math.min(r, g, b) === 0) continue;
    sum[0] += r ** WB_P;
    sum[1] += g ** WB_P;
    sum[2] += b ** WB_P;
    n++;
  }
  const out = Uint8ClampedArray.from(rgba);
  if (n === 0) return out;
  const e = sum.map((v) => (v / n) ** (1 / WB_P));
  const grey = (e[0] + e[1] + e[2]) / 3;
  const gain = e.map((v) => Math.min(WB_GAIN[1], Math.max(WB_GAIN[0], grey / v)) ** WB_STRENGTH);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = rgba[i * 4 + c] * gain[c];
  return out;
}

const lin = (c: number) => (c <= 10.31475 ? c / 3294.6 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** CIE Lab (D65) of an sRGB pixel as [L*, a*, b*]. */
export function lab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The same as [L*, chroma, hue angle in degrees 0..360]: straw sits near 85-95, red-brown soil lower. */
export function lch(r: number, g: number, b: number): [number, number, number] {
  const [l, a, bb] = lab(r, g, b);
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return [l, Math.hypot(a, bb), hue < 0 ? hue + 360 : hue];
}

/*
 * Colour thresholds, all on the white-balanced frame. Fitted by coordinate descent on the v2 eval's training 70% (fixed
 * split by id, `heldOut` in scripts/eval/common.ts) against overlay MAE, area gap and dirt false positives; the
 * held-out 30% went from overlay MAE 15.4 to 13.8 with dirt false positives still 0/11.
 */
/** Darker (shade, trunks) or greyer (posts, wire, haze) than this is never rated. CIE L* and chroma. */
const MIN_L = 20;
const MIN_CHROMA = 8;
/** Canopeo's green test (Patrignani & Ochsner 2015): R/G and B/G under a ratio and 2G - R - B over 20. The paper's ratio is 0.95; 1.05 fitted better here, and a live mask allows 1.1 (sunlit yellow-green grass). */
const GREEN_RATIO = 1.05;
const LIVE_GREEN_RATIO = 1.1;
const GREEN_BG = 0.95;
const GREEN_EXCESS = 20;
/** Straw by CIE Lab hue angle: cured grass is yellow (76 to 105 degrees), bare dirt is redder (lower), green is higher. */
const STRAW_HUE: [number, number] = [76, 105];
const STRAW_CHROMA: [number, number] = [18, 60];
const STRAW_L = 50;
/** Inside a dry mask: redder dead grass counts from 50 degrees, from L* 30, and anything pale (chroma 2 to 12: bleached or pinkish) whatever its hue. */
const DRY_HUE = 50;
const DRY_L = 30;
const DRY_CHROMA = 2;
const PALE_CHROMA = 12;
/** Inside a live mask only yellower-than-lawn straw is risk (up to 95 degrees). */
const LIVE_STRAW_HUE = 95;

/** Green by Canopeo's ratios on the raw channels. ExGR > 0 (Meyer & Neto 2008) was tried on top and cost 1.8 pts of overlay MAE on the training split, so it is not used. */
function isGreen(r: number, g: number, b: number, ratio: number): boolean {
  return r < ratio * g && b < GREEN_BG * g && 2 * g - r - b > GREEN_EXCESS;
}

const inBand = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

/**
 * One pixel's colour class. Dark pixels (shade, trunks) and greys (posts, wire, sky haze) stay neutral. Cured grass
 * and straw are told from soil by the CIE Lab hue angle: straw is yellower (higher angle), bare dirt redder (lower).
 */
export function colourOf(r: number, g: number, b: number): Label {
  const [l, c, h] = lch(r, g, b);
  if (l < MIN_L || c < MIN_CHROMA) return NEUTRAL;
  if (isGreen(r, g, b, GREEN_RATIO)) return CLEAR;
  return inBand(h, STRAW_HUE) && inBand(c, STRAW_CHROMA) && l >= STRAW_L ? RISK : NEUTRAL;
}

/** Inside a dry mask the risk band is wider: redder, pale, pinkish and shaded dead grass counts. Clearly green is clear. */
export function dryColourOf(r: number, g: number, b: number): Label {
  const [l, c, h] = lch(r, g, b);
  if (l < DRY_L) return NEUTRAL;
  if (isGreen(r, g, b, GREEN_RATIO)) return c >= MIN_CHROMA ? CLEAR : NEUTRAL;
  if (c < DRY_CHROMA) return NEUTRAL;
  return c <= PALE_CHROMA || (h >= DRY_HUE && h <= STRAW_HUE[1]) ? RISK : NEUTRAL;
}

/** Inside a live mask sunlit yellow-green grass is clear (a looser R/G); only truly tan/straw pixels are risk. */
export function liveColourOf(r: number, g: number, b: number): Label {
  const [l, c, h] = lch(r, g, b);
  if (isGreen(r, g, b, LIVE_GREEN_RATIO) && c >= MIN_CHROMA && l >= MIN_L) return CLEAR;
  return h >= STRAW_HUE[0] && h <= LIVE_STRAW_HUE && inBand(c, STRAW_CHROMA) && l >= STRAW_L ? RISK : NEUTRAL;
}

/** Luminance standard deviation in a (2r+1)² window around every pixel (summed-area tables). */
export function texture(rgba: ArrayLike<number>, w: number, h: number, r = 2): Float32Array {
  const W = w + 1;
  const s1 = new Float64Array(W * (h + 1));
  const s2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i4 = (y * w + x) * 4;
      const l = 0.299 * rgba[i4] + 0.587 * rgba[i4 + 1] + 0.114 * rgba[i4 + 2];
      const i = (y + 1) * W + x + 1;
      s1[i] = l + s1[i - 1] + s1[i - W] - s1[i - W - 1];
      s2[i] = l * l + s2[i - 1] + s2[i - W] - s2[i - W - 1];
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const y0 = Math.max(0, y - r);
      const x1 = Math.min(w, x + r + 1);
      const y1 = Math.min(h, y + r + 1);
      const n = (x1 - x0) * (y1 - y0);
      const a = s1[y1 * W + x1] - s1[y0 * W + x1] - s1[y1 * W + x0] + s1[y0 * W + x0];
      const q = s2[y1 * W + x1] - s2[y0 * W + x1] - s2[y1 * W + x0] + s2[y0 * W + x0];
      out[y * w + x] = Math.sqrt(Math.max(0, q / n - (a / n) ** 2));
    }
  }
  return out;
}

/**
 * Labels every pixel. Exclude masks win (neutral). Inside a dry mask the wide dry band decides, but a risk pixel there needs grassy texture (smooth soil stays neutral). Inside a live
 * mask the strict colour band decides. Outside every mask, green is clear and tan is risk only where the local
 * texture is grassy (smooth dirt stays neutral). Without masks (Roboflow failed) the strict colour band alone decides.
 */
export function classify(rgba: ArrayLike<number>, w: number, h: number, masks: Masks | null): Uint8Array {
  const out = new Uint8Array(w * h);
  const tex = masks ? texture(rgba, w, h) : null;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (!masks) out[i] = colourOf(r, g, b);
    else if (masks.exclude[i]) out[i] = NEUTRAL;
    else if (masks.dry[i]) {
      const l = dryColourOf(r, g, b);
      out[i] = l === RISK ? (tex![i] >= TEXTURE_MIN ? RISK : NEUTRAL) : l;
    }
    else if (masks.live[i]) out[i] = liveColourOf(r, g, b);
    else {
      const l = colourOf(r, g, b);
      out[i] = l === RISK ? (tex![i] >= TEXTURE_MIN ? RISK : NEUTRAL) : l;
    }
  }
  return out;
}

/** Majority vote in a (2r+1)² window: removes speckle so regions read as clean shapes. Neutral wins ties. */
export function smooth(labels: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  // Summed-area tables for clear and risk counts.
  const W = w + 1;
  const sc = new Int32Array(W * (h + 1));
  const sr = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      const i = (y + 1) * W + x + 1;
      sc[i] = (l === CLEAR ? 1 : 0) + sc[i - 1] + sc[i - W] - sc[i - W - 1];
      sr[i] = (l === RISK ? 1 : 0) + sr[i - 1] + sr[i - W] - sr[i - W - 1];
    }
  }
  const sum = (t: Int32Array, x0: number, y0: number, x1: number, y1: number) =>
    t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const y0 = Math.max(0, y - r);
      const x1 = Math.min(w, x + r + 1);
      const y1 = Math.min(h, y + r + 1);
      const n = (x1 - x0) * (y1 - y0);
      const c = sum(sc, x0, y0, x1, y1);
      const k = sum(sr, x0, y0, x1, y1);
      out[y * w + x] = k > n / 2 ? RISK : c > n / 2 ? CLEAR : k > c && k > n / 3 ? RISK : c > k && c > n / 3 ? CLEAR : NEUTRAL;
    }
  }
  return out;
}

export interface Verdict {
  risk: number;
  clear: number;
  /** risk / (risk + clear). Null when nothing in the frame could be rated. */
  share: number | null;
  level: "none" | "clear" | "low" | "moderate" | "high";
  text: string;
}

/** Score = risk pixels / (risk + clear pixels). "All clear" only when no risk pixel is left; tiny shares read "<1%". */
export function verdict(labels: ArrayLike<number>): Verdict {
  let risk = 0;
  let clear = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === RISK) risk++;
    else if (labels[i] === CLEAR) clear++;
  }
  if (risk + clear === 0) return { risk, clear, share: null, level: "none", text: "No vegetation to rate in this frame." };
  const share = risk / (risk + clear);
  if (risk === 0) return { risk, clear, share, level: "clear", text: "All clear: no dry vegetation found." };
  const pct = share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;
  const level = share >= 0.4 ? "high" : share >= 0.15 ? "moderate" : "low";
  const word = { high: "High risk", moderate: "Moderate risk", low: "Some risk" }[level];
  return { risk, clear, share, level, text: `${word}: ${pct} of the vegetation looks dry.` };
}

export interface RiskArea {
  id: number;
  /** [xmin, ymin, xmax, ymax], 0 to 1 of the frame. */
  box: [number, number, number, number];
  /** This area's share of all risk pixels, 0 to 100. */
  pctOfRisk: number;
  /** This area's share of the whole frame, 0 to 100. */
  pctOfFrame: number;
  where: string;
}

const MIN_AREA = 0.0015;
const MAX_AREAS = 6;

/** Location words from a point in the frame (0 to 1). */
export function whereOf(cx: number, cy: number): string {
  const v = cy < 1 / 3 ? "top" : cy < 2 / 3 ? "middle" : "bottom";
  const h = cx < 1 / 3 ? "left" : cx < 2 / 3 ? "centre" : "right";
  return `${v} ${h}`;
}

interface Blob {
  n: number;
  sx: number;
  sy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: number[];
}

/** Touching (8-way) risk pixels grouped into blobs. */
function blobs(labels: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== RISK || seen[start]) continue;
    const b: Blob = { n: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, pixels: [] };
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      b.n++;
      b.sx += x;
      b.sy += y;
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
      b.pixels.push(i);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!seen[j] && labels[j] === RISK) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    out.push(b);
  }
  return out;
}

/** Turns risk specks under 0.15% of the frame neutral, so verdict, overlay and areas all see the same map. */
export function dropSpecks(labels: Uint8Array, w: number, h: number): Uint8Array {
  const out = labels.slice();
  for (const b of blobs(labels, w, h)) if (b.n / (w * h) < MIN_AREA) for (const i of b.pixels) out[i] = NEUTRAL;
  return out;
}

/** Touching risk pixels grouped into areas, the biggest first. Call on a map that went through `dropSpecks`. */
export function riskAreas(labels: Uint8Array, w: number, h: number): RiskArea[] {
  const total = labels.reduce((n, l) => n + (l === RISK ? 1 : 0), 0);
  return blobs(labels, w, h)
    .filter((b) => b.n / (w * h) >= MIN_AREA)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_AREAS)
    .map((b, i) => ({
      id: i + 1,
      box: [b.x0 / w, b.y0 / h, (b.x1 + 1) / w, (b.y1 + 1) / h] as [number, number, number, number],
      pctOfRisk: Math.round((b.n / total) * 100),
      pctOfFrame: Math.round((b.n / (w * h)) * 1000) / 10,
      where: whereOf(b.sx / b.n / w, b.sy / b.n / h),
    }));
}

export interface FuelMap {
  w: number;
  h: number;
  labels: Uint8Array;
  verdict: Verdict;
  areas: RiskArea[];
  /** True when there were no vegetation masks and colour alone was used. */
  colourOnly: boolean;
}

/**
 * Fills each group's masks into a w x h 0/1 map. A mask's rings are filled even-odd together (holes stay holes);
 * masks of the same group are unioned.
 */
export function rasterise(masks: Mask[], srcW: number, w: number, h: number): Masks {
  const out: Masks = { dry: new Uint8Array(w * h), live: new Uint8Array(w * h), exclude: new Uint8Array(w * h) };
  const k = w / srcW;
  for (const m of masks) {
    const target = out[m.group];
    const rings = m.polys.filter((p) => p.length >= 3);
    for (let y = 0; y < h; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [ax, ay] = ring[i];
          const [bx, by] = ring[(i + 1) % ring.length];
          if (ay * k > yc !== by * k > yc) xs.push(ax * k + ((yc - ay * k) / ((by - ay) * k)) * ((bx - ax) * k));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.round(xs[i]));
        const to = Math.min(w, Math.round(xs[i + 1]));
        for (let x = from; x < to; x++) target[y * w + x] = 1;
      }
    }
  }
  return out;
}

/** The estimate's rows x cols tile labels ("dry" | "live" | "soil" | "other") over the frame, as /api/estimate returns them. */
export type EstimateGrid = ReadonlyArray<ReadonlyArray<string>>;

/** Turns every risk pixel inside a "soil" or "other" tile neutral: the model says there is no ground vegetation there. */
export function gateByGrid(labels: Uint8Array, w: number, h: number, grid: EstimateGrid): Uint8Array {
  const rows = grid.length;
  const out = labels.slice();
  for (let y = 0; y < h; y++) {
    const row = grid[Math.min(rows - 1, Math.floor((y / h) * rows))];
    for (let x = 0; x < w; x++) {
      const cell = row[Math.min(row.length - 1, Math.floor((x / w) * row.length))];
      if (out[y * w + x] === RISK && (cell === "soil" || cell === "other")) out[y * w + x] = NEUTRAL;
    }
  }
  return out;
}

/*
 * Reconcile settings, fitted the same way as the colour thresholds (training 70% of the v2 eval, coordinate descent).
 */
/** The overlay's RISK (or CLEAR) area may be this many times over or under the area the estimate implies, and at least AREA_FLOOR of the frame apart, before reconcile grows or trims it. */
export const AREA_FACTOR = 1.25;
const AREA_FLOOR = 0.01;
/** Texture (see TEXTURE_MIN) that counts as strong evidence of grass: what RISK needs to survive a soil/other tile, and what a pixel outside a "dry" tile needs to be grown into. */
const STRONG_TEXTURE = 10;
/** Growing: a pixel joins when its colour is within the seeds' own spread (their GROW_QUANTILE distance to the seed mean, times GROW_SLACK, never under GROW_MIN). Lab units, L* weighted GROW_L because shade changes it far more than hue. */
const GROW_QUANTILE = 0.9;
const GROW_SLACK = 1.5;
const GROW_MIN = 12;
const GROW_L = 0.15;
/** Colour distances are bucketed in steps of this for the flood's queue. */
const GROW_STEP = 0.25;

/** Each pixel's tile label from the estimate's grid. */
function cellsOf(w: number, h: number, grid: EstimateGrid): string[] {
  const rows = grid.length;
  const cells = new Array<string>(w * h);
  for (let y = 0; y < h; y++) {
    const row = grid[Math.min(rows - 1, Math.floor((y / h) * rows))];
    for (let x = 0; x < w; x++) cells[y * w + x] = row[Math.min(row.length - 1, Math.floor((x / w) * row.length))];
  }
  return cells;
}

/** Distance of every pixel's colour from the mean colour of the RISK pixels (Lab, L* down-weighted). Null when there are none. */
function distanceFromRisk(labels: Uint8Array, rgba: ArrayLike<number>, n: number): Float32Array | null {
  const px = new Float32Array(n * 3);
  const mean = [0, 0, 0];
  let seeds = 0;
  for (let i = 0; i < n; i++) {
    const c = lab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    c[0] *= GROW_L;
    px.set(c, i * 3);
    if (labels[i] !== RISK) continue;
    seeds++;
    for (let k = 0; k < 3; k++) mean[k] += c[k];
  }
  if (seeds === 0) return null;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.hypot(px[i * 3] - mean[0] / seeds, px[i * 3 + 1] - mean[1] / seeds, px[i * 3 + 2] - mean[2] / seeds);
  return d;
}

/**
 * Region growing: spreads RISK from the pixels that already are RISK into touching (8-way) pixels whose balanced colour
 * is close to the seeds' mean, closest colours first, until `target` pixels are RISK or nothing close enough is left.
 * `open` says which pixels may join (never exclude masks, never green). This is what carries a correct seed along a
 * thin strip without crossing onto the road next to it.
 */
function grow(labels: Uint8Array, rgba: ArrayLike<number>, w: number, h: number, target: number, open: (i: number) => boolean): void {
  const d = distanceFromRisk(labels, rgba, w * h);
  if (!d) return;
  const seeds: number[] = [];
  for (let i = 0; i < w * h; i++) if (labels[i] === RISK) seeds.push(i);
  const own = seeds.map((i) => d[i]).sort((a, b) => a - b);
  const reach = Math.max(GROW_MIN, own[Math.floor(GROW_QUANTILE * (own.length - 1))] * GROW_SLACK);
  const buckets: number[][] = Array.from({ length: Math.floor(reach / GROW_STEP) + 1 }, () => []);
  const queued = new Uint8Array(w * h);
  const push = (i: number, level: number) => {
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (queued[j] || labels[j] === RISK || d[j] > reach || !open(j)) continue;
        queued[j] = 1;
        buckets[Math.max(level, Math.floor(d[j] / GROW_STEP))].push(j);
      }
    }
  };
  for (const i of seeds) push(i, 0);
  let risk = seeds.length;
  for (let level = 0; level < buckets.length && risk < target; level++) {
    const bucket = buckets[level];
    for (let k = 0; k < bucket.length && risk < target; k++) {
      labels[bucket[k]] = RISK;
      risk++;
      push(bucket[k], level);
    }
  }
}

/** Takes RISK pixels away until `target` are left: first the ones `weak` names (lower rank first), and among equals the colours furthest from the RISK mean. */
function trim(labels: Uint8Array, rgba: ArrayLike<number>, n: number, target: number, rank: (i: number) => number): void {
  const d = distanceFromRisk(labels, rgba, n);
  if (!d) return;
  const risk: number[] = [];
  for (let i = 0; i < n; i++) if (labels[i] === RISK) risk.push(i);
  risk.sort((a, b) => rank(a) - rank(b) || d[b] - d[a]);
  for (let k = 0; k < risk.length - target; k++) labels[risk[k]] = NEUTRAL;
}

/**
 * Pulls the classified map toward the estimate, using its grid as a prior and not a gate. In soil/other tiles CLEAR goes
 * neutral and so does weak RISK, but strong evidence stays: a SAM dry-mask pixel, or straw colour with grassy texture
 * outside every exclude mask (a strip of dry grass along a road is too thin to win a tile). Then the RISK area is compared
 * with the area the estimate implies, dryPct / 100 x vegFrac of the frame. Far under it (AREA_FACTOR), RISK grows from the
 * pixels that are RISK into touching pixels of the same colour, flat ones only in "dry" tiles; with no RISK at all the
 * "dry" tiles' dry-coloured pixels are the seeds. Far over it, RISK is trimmed back to it: soil/other tiles first, then
 * "live" tiles, SAM dry-mask pixels last. CLEAR is then held to (100 - dryPct) / 100 x vegFrac the same way, so the share
 * the verdict reports is not a ratio of two tiny areas.
 */
export function reconcile(labels: Uint8Array, rgba: ArrayLike<number>, w: number, h: number, grid: EstimateGrid, dryPct: number, vegFrac: number, raster: Masks | null): Uint8Array {
  const n = w * h;
  const cells = cellsOf(w, h, grid);
  const tex = texture(rgba, w, h);
  const off = (i: number) => cells[i] === "soil" || cells[i] === "other";
  const straw = (i: number) => colourOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) === RISK;
  // An exclude mask stops RISK, except straw colour in a "dry" tile: SAM's "bare soil" often covers a mown straw aisle, and there the estimate and the colour both say fuel.
  const blocked = (i: number) => !!raster?.exclude[i] && !(cells[i] === "dry" && straw(i));
  const out = labels.slice();
  let risk = 0;
  let clear = 0;
  for (let i = 0; i < n; i++) {
    if (off(i)) {
      const strong = out[i] === RISK && (raster?.dry[i] || (tex[i] >= STRONG_TEXTURE && !raster?.exclude[i] && straw(i)));
      if (!strong) out[i] = NEUTRAL;
    }
    if (out[i] === RISK) risk++;
    else if (out[i] === CLEAR) clear++;
  }
  const floor = AREA_FLOOR * n;
  const target = Math.round((dryPct / 100) * vegFrac * n);
  if (Math.abs(target - risk) > floor && risk * AREA_FACTOR < target) {
    if (risk === 0) {
      for (let i = 0; i < n; i++) if (cells[i] === "dry" && !blocked(i) && dryColourOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) === RISK) out[i] = RISK;
    }
    grow(out, rgba, w, h, target, (i) => out[i] !== CLEAR && !blocked(i) && (cells[i] === "dry" || tex[i] >= STRONG_TEXTURE));
  } else if (Math.abs(target - risk) > floor && risk > target * AREA_FACTOR) {
    trim(out, rgba, n, target, (i) => (raster?.dry[i] ? 2 : off(i) ? 0 : cells[i] === "live" ? 1 : 2));
  }
  // The green side, the same way: the estimate implies (100 - dryPct) / 100 x vegFrac of the frame is live ground vegetation.
  const green = (i: number) => 2 * rgba[i * 4 + 1] - rgba[i * 4] - rgba[i * 4 + 2];
  const clearTarget = Math.round((1 - dryPct / 100) * vegFrac * n);
  if (Math.abs(clearTarget - clear) > floor && clear * AREA_FACTOR < clearTarget) {
    // Green that the gate took out comes back, soil tiles first and the greenest first: a few plants on a dirt road never win a tile.
    const gated: number[] = [];
    for (let i = 0; i < n; i++) if (labels[i] === CLEAR && out[i] === NEUTRAL) gated.push(i);
    gated.sort((a, b) => Number(cells[b] === "soil") - Number(cells[a] === "soil") || green(b) - green(a));
    for (let k = 0; k < gated.length && clear < clearTarget; k++, clear++) out[gated[k]] = CLEAR;
  } else if (Math.abs(clearTarget - clear) > floor && clear > clearTarget * AREA_FACTOR) {
    // Too much green is canopy counted as ground cover: "dry" tiles lose theirs first, then the least green.
    const kept: number[] = [];
    for (let i = 0; i < n; i++) if (out[i] === CLEAR) kept.push(i);
    kept.sort((a, b) => Number(cells[b] === "dry") - Number(cells[a] === "dry") || green(a) - green(b));
    for (let k = 0; k < kept.length - clearTarget; k++) out[kept[k]] = NEUTRAL;
  }
  return out;
}

/**
 * The whole analysis on a small RGBA frame (w x h): rasterise masks, white-balance a copy, classify it, then with the estimate's grid either gate
 * (grid only) or reconcile toward its dry area (grid, dryPct and vegFrac), smooth, drop specks, group. Pure, so the app
 * and the eval share it. A grid without dryPct and vegFrac gives the PR 20 gate.
 */
export function scan(rgba: ArrayLike<number>, w: number, h: number, srcW: number, masks: Mask[] | null, grid?: EstimateGrid | null, dryPct?: number | null, vegFrac?: number | null): FuelMap {
  const raster = masks ? rasterise(masks, srcW, w, h) : null;
  const balanced = whiteBalance(rgba, w, h);
  const classified = classify(balanced, w, h, raster);
  const gated = !(grid?.length && grid[0]?.length) ? classified : dryPct == null || vegFrac == null ? gateByGrid(classified, w, h, grid) : reconcile(classified, balanced, w, h, grid, dryPct, vegFrac, raster);
  const labels = dropSpecks(smooth(gated, w, h), w, h);
  return { w, h, labels, verdict: verdict(labels), areas: riskAreas(labels, w, h), colourOnly: !masks };
}

/** Browser wrapper: draws the frame at MAP_WIDTH and hands the pixels to `scan`. */
export function analyse(source: CanvasImageSource, srcW: number, srcH: number, masks: Mask[] | null, grid?: EstimateGrid | null, dryPct?: number | null, vegFrac?: number | null): FuelMap | null {
  const w = MAP_WIDTH;
  const h = Math.max(1, Math.round((srcH / srcW) * MAP_WIDTH));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return scan(ctx.getImageData(0, 0, w, h).data, w, h, srcW, masks, grid, dryPct, vegFrac);
}

/** Decodes an encoded frame (data URL) so it can be drawn. */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
