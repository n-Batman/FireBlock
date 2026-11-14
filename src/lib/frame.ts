/** Longest side of a frame sent to the scanner. Smaller sources are never scaled up. */
export const MAX_SIDE = 1536;
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

/** Draws the 12 x 8 grid with a label (A1 ... L8) in each cell's corner, so the model can name cells. */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cw = w / 12;
  const ch = h / 8;
  const font = Math.max(11, Math.round(w / 110));
  ctx.lineWidth = Math.max(1, Math.round(w / 1000));
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  for (let i = 1; i < 12; i++) {
    ctx.moveTo(i * cw, 0);
    ctx.lineTo(i * cw, h);
  }
  for (let j = 1; j < 8; j++) {
    ctx.moveTo(0, j * ch);
    ctx.lineTo(w, j * ch);
  }
  ctx.stroke();
  ctx.font = `bold ${font}px sans-serif`;
  ctx.textBaseline = "top";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 12; c++) {
      const label = `${String.fromCharCode(65 + c)}${r + 1}`;
      const x = c * cw + 2;
      const y = r * ch + 2;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y, ctx.measureText(label).width + 4, font + 3);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 2, y + 1);
    }
  }
}

/**
 * Downscales a video frame or photo to at most MAX_SIDE and encodes it as JPEG, with its blur score
 * (measured before the grid goes on). `grid` labels the 12 x 8 cells on the sent copy.
 */
export function encodeFrame(
  source: CanvasImageSource,
  w: number,
  h: number,
  canvas: HTMLCanvasElement = document.createElement("canvas"),
  grid = false,
): { image: string; sharp: number | null } {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(source, 0, 0, canvas.width, canvas.height);
  const sharp = ctx ? canvasSharpness(canvas) : null;
  if (ctx && grid) drawGrid(ctx, canvas.width, canvas.height);
  return { image: canvas.toDataURL("image/jpeg", JPEG_QUALITY), sharp };
}
