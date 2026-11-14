/**
 * Turns a frame (and, when Roboflow answers, its vegetation masks) into a per-pixel fuel map:
 * the pixel's colour decides risk, not the mask's label. Tan, straw and brown = risk, green = clear,
 * everything else (sky, posts, shadows, and dirt when there are masks) = neutral and out of the score.
 */

export const NEUTRAL = 0;
export const CLEAR = 1;
export const RISK = 2;
export type Label = typeof NEUTRAL | typeof CLEAR | typeof RISK;

/** Width of the working map. The overlay is this map scaled up and softened, so it reads as smooth shapes. */
export const MAP_WIDTH = 384;
/** Under this share of rated pixels the frame may be called all clear. */
export const CLEAR_BELOW = 0.03;

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

/**
 * Labels every pixel. With a vegetation mask, a pixel inside it is rated by its colour; outside it, only a
 * clearly green pixel counts (as clear: SAM3 often misses vine canopy, and nothing green is sky or dirt), so
 * risk always needs a mask and bare dirt never counts. Without masks (Roboflow failed) colour alone decides.
 */
export function classify(rgba: ArrayLike<number>, w: number, h: number, mask: ArrayLike<number> | null): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const label = colourOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    out[i] = !mask || mask[i] ? label : label === CLEAR ? CLEAR : NEUTRAL;
  }
  return out;
}

/** Majority vote in a (2r+1)² window: removes speckle so regions read as clean shapes. Neutral wins ties. */
export function smooth(labels: Uint8Array, w: number, h: number, r = 2): Uint8Array {
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

/** Score = risk pixels / (risk + clear pixels). "All clear" only at 3% or less. */
export function verdict(labels: ArrayLike<number>): Verdict {
  let risk = 0;
  let clear = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === RISK) risk++;
    else if (labels[i] === CLEAR) clear++;
  }
  if (risk + clear === 0) return { risk, clear, share: null, level: "none", text: "No vegetation to rate in this frame." };
  const share = risk / (risk + clear);
  const pct = Math.round(share * 100);
  if (share <= CLEAR_BELOW) return { risk, clear, share, level: "clear", text: `All clear: ${pct}% of the vegetation looks dry.` };
  const level = share >= 0.4 ? "high" : share >= 0.15 ? "moderate" : "low";
  const word = { high: "High risk", moderate: "Moderate risk", low: "Some risk" }[level];
  return { risk, clear, share, level, text: `${word}: ${pct}% of the vegetation looks dry.` };
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

/** Touching risk pixels grouped into areas, the biggest first; specks under 0.15% of the frame are left out. */
export function riskAreas(labels: Uint8Array, w: number, h: number): RiskArea[] {
  const seen = new Uint8Array(w * h);
  const total = labels.reduce((n, l) => n + (l === RISK ? 1 : 0), 0);
  const found: (RiskArea & { n: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== RISK || seen[start]) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      n++;
      sx += x;
      sy += y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
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
    if (n / (w * h) < MIN_AREA) continue;
    found.push({
      id: 0,
      n,
      box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h],
      pctOfRisk: Math.round((n / total) * 100),
      pctOfFrame: Math.round((n / (w * h)) * 1000) / 10,
      where: whereOf(sx / n / w, sy / n / h),
    });
  }
  return found
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_AREAS)
    .map((a, i) => ({ id: i + 1, box: a.box, pctOfRisk: a.pctOfRisk, pctOfFrame: a.pctOfFrame, where: a.where }));
}

/** Polygons in pixels of a `srcW` wide frame. */
export type Polygon = [number, number][];

export interface FuelMap {
  w: number;
  h: number;
  labels: Uint8Array;
  verdict: Verdict;
  areas: RiskArea[];
  /** True when there were no vegetation masks and colour alone was used. */
  colourOnly: boolean;
}

/** Runs the whole analysis in the browser: draw the frame small, rasterise the masks, classify, smooth, group. */
export function analyse(source: CanvasImageSource, srcW: number, srcH: number, polygons: Polygon[] | null): FuelMap | null {
  const w = MAP_WIDTH;
  const h = Math.max(1, Math.round((srcH / srcW) * MAP_WIDTH));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  let mask: Uint8Array | null = null;
  if (polygons) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    const k = w / srcW;
    for (const poly of polygons) {
      if (poly.length < 3) continue;
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      ctx.closePath();
      ctx.fill();
    }
    const a = ctx.getImageData(0, 0, w, h).data;
    mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  }
  const labels = smooth(classify(rgba, w, h, mask), w, h);
  return { w, h, labels, verdict: verdict(labels), areas: riskAreas(labels, w, h), colourOnly: !polygons };
}

/** Decodes an encoded frame (data URL) so it can be drawn. */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
