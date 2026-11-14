/** Longest side of a frame sent to the scanner. Smaller sources are never scaled up. */
export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.85;
/** Variance of the Laplacian below this reads as blurry. ponytail: one global threshold, tune on real phone frames. */
export const MIN_SHARPNESS = 20;
const SHARP_WIDTH = 320;

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

/** Sharpness of a canvas, measured on a small copy. Null when canvas pixels cannot be read. */
function canvasSharpness(src: HTMLCanvasElement): number | null {
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
  return sharpness(gray, small.width, small.height);
}

/** Downscales a video frame or photo to at most MAX_SIDE and encodes it as JPEG, with its blur score. */
export function encodeFrame(
  source: CanvasImageSource,
  w: number,
  h: number,
  canvas: HTMLCanvasElement = document.createElement("canvas"),
): { image: string; sharp: number | null } {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL("image/jpeg", JPEG_QUALITY), sharp: ctx ? canvasSharpness(canvas) : null };
}
