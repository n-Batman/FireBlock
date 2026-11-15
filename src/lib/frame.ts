/** Longest side of a frame sent to the scanner. Smaller sources are never scaled up. */
export const MAX_SIDE = 1024;
export const JPEG_QUALITY = 0.85;
/** Variance of the Laplacian below this reads as blurry. ponytail: one global threshold, tune on real phone frames. */
export const MIN_SHARPNESS = 20;
/** Mean luma (0..255) below this reads as too dark to rate. ponytail: global thresholds, tune on real phone frames. */
export const MIN_LUMA = 45;
/** Fog is bright AND flat together: mean luma above FOG_LUMA with a luma spread (std dev) under FOG_CONTRAST. Bright but textured tan soil passes. */
export const FOG_LUMA = 175;
export const FOG_CONTRAST = 18;
const SHARP_WIDTH = 320;

/** Why a photo cannot be rated, or "ok". */
export type PhotoQuality = "ok" | "blurry" | "dark" | "foggy";

/** Local pixel check on a grayscale copy: dark first, then fog (bright and low contrast), then blur. */
export function photoQuality(gray: ArrayLike<number>, w: number, h: number): PhotoQuality {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < w * h; i++) {
    sum += gray[i];
    sumSq += gray[i] * gray[i];
  }
  const mean = sum / (w * h);
  const spread = Math.sqrt(Math.max(0, sumSq / (w * h) - mean * mean));
  if (mean < MIN_LUMA) return "dark";
  if (mean > FOG_LUMA && spread < FOG_CONTRAST) return "foggy";
  return sharpness(gray, w, h) < MIN_SHARPNESS ? "blurry" : "ok";
}

/** Blur score: variance of the 4-neighbour Laplacian over a grayscale copy. Higher is sharper. */
export function sharpness(gray: ArrayLike<number>, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Quality of a canvas, measured on a small copy. Null when canvas pixels cannot be read. */
function canvasQuality(src: HTMLCanvasElement): PhotoQuality | null {
  const small = document.createElement("canvas");
  small.width = SHARP_WIDTH;
  small.height = Math.max(3, Math.round((src.height * SHARP_WIDTH) / src.width));
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, small.width, small.height);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);
  const gray = new Uint8Array(small.width * small.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return photoQuality(gray, small.width, small.height);
}

/**
 * Downscales a video frame or photo to at most MAX_SIDE (about what SAM3 wants) and encodes it as JPEG,
 * with its quality (blurry, dark, foggy or ok; null when the pixels cannot be read).
 */
export function encodeFrame(
  source: CanvasImageSource,
  w: number,
  h: number,
  canvas: HTMLCanvasElement = document.createElement("canvas"),
): { image: string; quality: PhotoQuality | null } {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL("image/jpeg", JPEG_QUALITY), quality: ctx ? canvasQuality(canvas) : null };
}
