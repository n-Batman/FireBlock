/* Scores the scanner on eval/manifest.json. Run: npm run eval:run  (needs ROBOFLOW_API_KEY in .env.local; replies cached in eval/cache)
   EVAL_ESTIMATOR=vlm scores src/lib/estimate.ts instead of SAM (needs OPENAI_API_KEY; replies cached as eval/cache/est-<sha>.json). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { EST_COLS, EST_ROWS, SYSTEM_PROMPT, estimateDry, type Estimate } from "../../src/lib/estimate";
import { CLEAR, MAP_WIDTH, NEUTRAL, RISK, hsv, scan, type FuelMap } from "../../src/lib/fuelMask";
import { ENDPOINT, parseSegments, segmentBody } from "../../src/lib/segment";
import { CACHE, DATA, LABELS_V2, MANIFEST, V2, heldOut, isDirtBucket, mk, pool, sha, sleep, withHumanLabels, type Item } from "./common";

const VLM = process.env.EVAL_ESTIMATOR === "vlm";
const PASS_PTS = 15; // |our dry% - GPT estimate|
const BG_PASS = 0.05; // VegAnn: risk on background pixels, share of background
const DIRT_PASS = 0.03; // dirt buckets: risk pixels, share of frame

export interface Result {
  item: Item;
  map: FuelMap;
  ours: number; // dry %, 0 when nothing could be rated
  /** VLM mode only: SAM fuel map share * 100 (0 when null) for the same frame; null when not run or SAM failed. */
  overlay: number | null;
  gap: number | null; // |ours - overlay|
  /** VLM mode only: the SAM fuel map itself (null when not run or SAM failed). */
  overlayMap: FuelMap | null;
  /** VLM mode only: RISK pixels / frame, for the SAM fuel map and for the VLM's grid alone ("GPT only"). */
  overlayRisk: number | null;
  gridRisk: number | null;
  /** VLM mode only: the grid's own share, dry cells / (dry + live cells) * 100 (0 when neither). */
  gridShare: number | null;
  /** VLM mode only: the dry area the estimate implies, dryPct / 100 * vegFrac of the frame. */
  target: number | null;
  expected: number | null;
  err: number | null; // |ours - expected|
  bgFp: number | null; // VegAnn only
  riskFrame: number; // risk pixels / frame
  /** Scored with the dirt rule (risk under 3% of frame). */
  dirt: boolean;
  allClearWithRisk: boolean;
  pass: boolean;
  why: string;
  /** Why GPT's estimate looks wrong, if it obviously does. Flagged images are listed, not counted in pass rates. */
  suspect: string | null;
  jpeg: Buffer;
}

/** An obvious label error: the estimate contradicts its own note or claims dry vegetation in a snow/monochrome scene. Not tuned to; only flagged. */
export function suspectLabel(notes: string, expected: number | null, snowShare: number, meanSat: number): string | null {
  if (expected == null) return null;
  if (expected > 20 && (snowShare > 0.35 || meanSat < 0.05)) return "snow or monochrome scene, no rateable vegetation";
  if (expected > 20 && /snow|black.and.white|monochrome|sepia/i.test(notes)) return "note says snow/monochrome";
  if (expected > 25 && /\b(bare|no vegetation|gravel)\b/i.test(notes)) return "note says bare ground";
  if (expected < 35 && /mostly (dry|dead|brown|straw|tan)/i.test(notes)) return "note says mostly dry, number says otherwise";
  if (expected > 65 && /mostly green|lush/i.test(notes)) return "note says mostly green, number says otherwise";
  return null;
}

/** Same framing as the app: longest side 1024, JPEG 0.85. */
async function frame(path: string) {
  const { data, info } = await sharp(path).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return { jpeg: data, w: info.width, h: info.height };
}

async function segment(jpeg: Buffer, key: string) {
  const body = segmentBody(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  const cache = `${CACHE}/seg-${sha(body)}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  for (let a = 0; a < 4; a++) {
    const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!res || res.status >= 500 || res.status === 429) {
      await sleep(1500 * (a + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // body never printed: it can echo the key
    const reply = await res.json();
    writeFileSync(cache, JSON.stringify(reply));
    return reply;
  }
  throw new Error("segmentation failed after retries");
}

/** One VLM estimate, cached by frame. Retries 429/5xx twice. */
async function estimate(jpeg: Buffer): Promise<Estimate> {
  const cache = `${CACHE}/est-${sha(sha(jpeg) + sha(SYSTEM_PROMPT))}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  for (let a = 0; ; a++) {
    try {
      const est = await estimateDry(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
      writeFileSync(cache, JSON.stringify(est));
      return est;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (a >= 2 || (status !== 429 && status !== 502 && status !== 504)) throw e;
      await sleep(1500 * (a + 1));
    }
  }
}

/** The VLM's 6x8 grid as a FuelMap (dry = risk, live = clear, the rest neutral), so reports and sheets draw it like SAM's. */
function gridMap(est: Estimate, w: number, h: number): FuelMap {
  const labels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = est.grid[Math.min(EST_ROWS - 1, Math.floor((y / h) * EST_ROWS))][Math.min(EST_COLS - 1, Math.floor((x / w) * EST_COLS))];
      labels[y * w + x] = c === "dry" ? RISK : c === "live" ? CLEAR : NEUTRAL;
    }
  }
  const share = est.vegFrac > 0 ? est.dryPct / 100 : null;
  return { w, h, labels, verdict: { risk: 0, clear: 0, share, level: share == null ? "none" : share > 0 ? "moderate" : "clear", text: "" }, areas: [], colourOnly: false };
}

async function evaluate(item: Item, key: string): Promise<Result> {
  const { jpeg, w: sw, h: sh } = await frame(`${DATA}/${item.file}`);
  const w = MAP_WIDTH;
  const h = Math.max(1, Math.round((sh / sw) * w));
  const rgba = await sharp(jpeg).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  let vlm: Estimate | null = null;
  let map: FuelMap;
  let overlay: number | null = null;
  let overlayMap: FuelMap | null = null;
  if (VLM) {
    vlm = await estimate(jpeg);
    map = gridMap(vlm, w, h);
    const rf = process.env.ROBOFLOW_API_KEY?.trim();
    if (rf) {
      const sam = await segment(jpeg, rf).then((r) => scan(rgba, w, h, sw, parseSegments(r), vlm?.grid, vlm?.dryPct), () => null); // SAM failure leaves overlay null: reported separately
      overlayMap = sam;
      if (sam) overlay = sam.verdict.share == null ? 0 : sam.verdict.share * 100;
    }
  } else map = scan(rgba, w, h, sw, parseSegments(await segment(jpeg, key)));
  const n = w * h;
  let snow = 0;
  let satSum = 0;
  for (let i = 0; i < n; i++) {
    const [, sat, v] = hsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    satSum += sat;
    if (v > 0.8 && sat < 0.12) snow++;
  }
  let risk = 0;
  for (const l of map.labels) if (l === RISK) risk++;
  const count = (m: FuelMap, l: number) => m.labels.reduce((a, x) => a + (x === l ? 1 : 0), 0);
  const gridClear = vlm ? count(map, CLEAR) : 0;
  const ours = vlm ? vlm.dryPct : map.verdict.share == null ? 0 : map.verdict.share * 100;
  const gap = overlay == null ? null : Math.abs(ours - overlay);
  const expected = item.expected?.relevant ? item.expected.dry_pct_estimate : null;
  let bgFp: number | null = null;
  if (item.mask) {
    const m = await sharp(`${DATA}/${item.mask}`).resize(w, h, { fit: "fill", kernel: "nearest" }).greyscale().raw().toBuffer();
    let bg = 0;
    let bgRisk = 0;
    for (let i = 0; i < n; i++) {
      if (m[i] < 128) {
        bg++;
        if (map.labels[i] === RISK) bgRisk++;
      }
    }
    bgFp = bg ? bgRisk / bg : null;
  }
  const riskFrame = vlm ? (vlm.dryPct / 100) * vlm.vegFrac : risk / n; // vlm: dry share of vegetation x vegetation share of frame
  const err = expected == null ? null : Math.abs(ours - expected);
  const dirt = V2 ? item.dirt === true : isDirtBucket(item.category) || item.dirt === true; // v2: only hand-flagged soil-dominant frames; dirt-road buckets often hold real dry grass
  let pass = true;
  let why = "";
  if (err != null && err > PASS_PTS) (pass = false), (why = `dry% off by ${err.toFixed(0)}`);
  if (dirt && riskFrame > DIRT_PASS) (pass = false), (why = `dirt read as risk (${(riskFrame * 100).toFixed(0)}% of frame)`);
  if (bgFp != null && bgFp > BG_PASS) (pass = false), (why = `risk on ${(bgFp * 100).toFixed(0)}% of background`);
  return { item, map, ours, overlay, gap, overlayMap, overlayRisk: overlayMap ? count(overlayMap, RISK) / n : null, gridRisk: vlm ? risk / n : null, gridShare: vlm ? (risk + gridClear ? (risk / (risk + gridClear)) * 100 : 0) : null, target: vlm ? (vlm.dryPct / 100) * vlm.vegFrac : null, expected, err, bgFp, riskFrame, dirt, allClearWithRisk: map.verdict.level === "clear" && risk > 0, pass, why, suspect: V2 ? null : suspectLabel(item.expected?.notes ?? "", expected, snow / n, satSum / n), jpeg };
}

async function main() {
  const key = (VLM ? process.env.OPENAI_API_KEY : process.env.ROBOFLOW_API_KEY)?.trim();
  if (!key) throw new Error(`${VLM ? "OPENAI_API_KEY" : "ROBOFLOW_API_KEY"} missing (run via npm run eval:run)`);
  mk(CACHE);
  const raw: Item[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const all = V2 ? withHumanLabels(raw, JSON.parse(readFileSync(LABELS_V2, "utf8"))) : raw;
  const split = process.env.EVAL_SPLIT; // "train" | "test": the fixed 70/30 split thresholds are fitted on
  const items = all.filter((i) => (i.source === "vegann" || i.source === "own" || i.expected?.relevant) && (!split || heldOut(i.id) === (split === "test")));
  const dropped = all.length - items.length;
  const results: Result[] = [];
  const failed: string[] = [];
  await pool(items, 4, async (it) => {
    try {
      results.push(await evaluate(it, key));
    } catch (e) {
      failed.push(`${it.id}: ${e instanceof Error ? e.message : e}`);
    }
  });
  results.sort((a, b) => a.item.id.localeCompare(b.item.id));
  const { report } = await import("./report");
  await report(results, { total: all.length, dropped, failed });
}
main();
