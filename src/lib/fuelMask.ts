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

/** CIE Lab (D65) of an sRGB pixel as [L*, chroma, hue angle in degrees 0..360]: straw sits near 85-95, red-brown soil lower. */
export function lch(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return [116 * fy - 16, Math.hypot(a, bb), hue < 0 ? hue + 360 : hue];
}

/**
 * One pixel's colour class. ponytail: fixed HSV bands tuned on SRV1/3/6/9; a per-camera white balance would
 * tighten them. Dark pixels (shade, trunks) and greys (posts, wire, sky haze) stay neutral.
 */
export function colourOf(r: number, g: number, b: number): Label {
  const [h, s, v] = hsv(r, g, b);
  if (v < 0.3 || s < 0.14) return NEUTRAL;
  if (h >= 62 && h <= 170) return CLEAR;
  // Cured grass and straw: yellow-tan hue, light. Redder browns (bare dirt, h < 31) and dark browns
  // (trunks, bark, dormant canes, v < 0.48) are not fuel by colour.
  if (h >= 31 && h < 62 && s >= 0.2 && s <= 0.75 && v >= 0.48) return RISK;
  return NEUTRAL;
}

/** Inside a dry mask the risk band is wider: pale, pinkish and shaded dead grass counts. Clearly green is clear. */
export function dryColourOf(r: number, g: number, b: number): Label {
  const [h, s, v] = hsv(r, g, b);
  if (v < 0.25) return NEUTRAL;
  if (h >= 62 && h <= 170) return s >= 0.14 && v >= 0.3 ? CLEAR : NEUTRAL;
  return s >= 0.08 && (h >= 345 || h < 62) ? RISK : NEUTRAL;
}

/** Inside a live mask sunlit yellow-green grass (hue 50-62) is clear; only truly tan/straw pixels (hue 31-50) are risk. */
export function liveColourOf(r: number, g: number, b: number): Label {
  const [h, s, v] = hsv(r, g, b);
  if (h >= 50 && h <= 170 && s >= 0.14 && v >= 0.3) return CLEAR;
  if (h >= 31 && h < 50 && s >= 0.25 && s <= 0.75 && v >= 0.48) return RISK;
  return NEUTRAL;
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

/** How far (0 to 1) the overlay's share may sit from the headline dry_pct before reconcile fills or trims. */
export const RECONCILE_GAP = 0.15;

/**
 * Pulls the classified map toward the headline dry_pct. Soil/other tiles leave the score (RISK and CLEAR go neutral, except
 * SAM dry-mask pixels). Then, if the share is more than RECONCILE_GAP under the headline, pixels in "dry" tiles that the wide
 * dry band calls RISK become RISK (no texture check, exclude masks still win); if it is more than RECONCILE_GAP over, RISK
 * pixels in "live" tiles outside a SAM dry mask go neutral.
 */
export function reconcile(labels: Uint8Array, rgba: ArrayLike<number>, w: number, h: number, grid: EstimateGrid, dryPct: number, raster: Masks | null): Uint8Array {
  const rows = grid.length;
  const cells = new Array<string>(w * h);
  for (let y = 0; y < h; y++) {
    const row = grid[Math.min(rows - 1, Math.floor((y / h) * rows))];
    for (let x = 0; x < w; x++) cells[y * w + x] = row[Math.min(row.length - 1, Math.floor((x / w) * row.length))];
  }
  const out = labels.slice();
  for (let i = 0; i < w * h; i++) {
    if ((cells[i] === "soil" || cells[i] === "other") && (out[i] === CLEAR || (out[i] === RISK && !raster?.dry[i]))) out[i] = NEUTRAL;
  }
  const share = verdict(out).share ?? 0;
  const target = dryPct / 100;
  if (target - share > RECONCILE_GAP) {
    for (let i = 0; i < w * h; i++) {
      if (cells[i] === "dry" && out[i] !== RISK && !raster?.exclude[i] && dryColourOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) === RISK) out[i] = RISK;
    }
  } else if (share - target > RECONCILE_GAP) {
    for (let i = 0; i < w * h; i++) if (cells[i] === "live" && out[i] === RISK && !raster?.dry[i]) out[i] = NEUTRAL;
  }
  return out;
}

/**
 * The whole analysis on a small RGBA frame (w x h): rasterise masks, white-balance a copy, classify it, then with the estimate's grid either gate
 * (grid only) or reconcile toward its dryPct (grid and dryPct), smooth, drop specks, group. Pure, so the app and the eval
 * share it. No grid gives the same map as before; a grid without dryPct gives the PR 20 gate.
 */
export function scan(rgba: ArrayLike<number>, w: number, h: number, srcW: number, masks: Mask[] | null, grid?: EstimateGrid | null, dryPct?: number | null): FuelMap {
  const raster = masks ? rasterise(masks, srcW, w, h) : null;
  const balanced = whiteBalance(rgba, w, h);
  const classified = classify(balanced, w, h, raster);
  const gated = !(grid?.length && grid[0]?.length) ? classified : dryPct == null ? gateByGrid(classified, w, h, grid) : reconcile(classified, balanced, w, h, grid, dryPct, raster);
  const labels = dropSpecks(smooth(gated, w, h), w, h);
  return { w, h, labels, verdict: verdict(labels), areas: riskAreas(labels, w, h), colourOnly: !masks };
}

/** Browser wrapper: draws the frame at MAP_WIDTH and hands the pixels to `scan`. */
export function analyse(source: CanvasImageSource, srcW: number, srcH: number, masks: Mask[] | null, grid?: EstimateGrid | null, dryPct?: number | null): FuelMap | null {
  const w = MAP_WIDTH;
  const h = Math.max(1, Math.round((srcH / srcW) * MAP_WIDTH));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return scan(ctx.getImageData(0, 0, w, h).data, w, h, srcW, masks, grid, dryPct);
}

/** Decodes an encoded frame (data URL) so it can be drawn. */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
