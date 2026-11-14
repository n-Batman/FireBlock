/* Scores the scanner on eval/manifest.json. Run: npm run eval:run  (needs ROBOFLOW_API_KEY in .env.local; replies cached in eval/cache) */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { MAP_WIDTH, RISK, CLEAR, scan, type FuelMap } from "../../src/lib/fuelMask";
import { ENDPOINT, parseSegments, segmentBody } from "../../src/lib/segment";
import { CACHE, DATA, MANIFEST, mk, pool, sha, sleep, type Item } from "./common";

const PASS_PTS = 15; // |our dry% - GPT estimate|
const BG_PASS = 0.05; // VegAnn: risk on background pixels, share of background
const DIRT_PASS = 0.03; // dirt buckets: risk pixels, share of frame
const DIRT = ["bare soil field", "dirt road"];

export interface Result {
  item: Item;
  map: FuelMap;
  ours: number; // dry %, 0 when nothing could be rated
  expected: number | null;
  err: number | null; // |ours - expected|
  bgFp: number | null; // VegAnn only
  riskFrame: number; // risk pixels / frame
  allClearWithRisk: boolean;
  pass: boolean;
  why: string;
  jpeg: Buffer;
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

async function evaluate(item: Item, key: string): Promise<Result> {
  const { jpeg, w: sw, h: sh } = await frame(`${DATA}/${item.file}`);
  const polygons = parseSegments(await segment(jpeg, key));
  const w = MAP_WIDTH;
  const h = Math.max(1, Math.round((sh / sw) * w));
  const rgba = await sharp(jpeg).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const map = scan(rgba, w, h, sw, polygons);
  const n = w * h;
  let risk = 0;
  for (const l of map.labels) if (l === RISK) risk++;
  const ours = map.verdict.share == null ? 0 : map.verdict.share * 100;
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
  const riskFrame = risk / n;
  const err = expected == null ? null : Math.abs(ours - expected);
  const dirt = DIRT.includes(item.category);
  let pass = true;
  let why = "";
  if (err != null && err > PASS_PTS) (pass = false), (why = `dry% off by ${err.toFixed(0)}`);
  if (dirt && riskFrame > DIRT_PASS) (pass = false), (why = `dirt read as risk (${(riskFrame * 100).toFixed(0)}% of frame)`);
  if (bgFp != null && bgFp > BG_PASS) (pass = false), (why = `risk on ${(bgFp * 100).toFixed(0)}% of background`);
  return { item, map, ours, expected, err, bgFp, riskFrame, allClearWithRisk: map.verdict.level === "clear" && risk > 0, pass, why, jpeg };
}

async function main() {
  const key = process.env.ROBOFLOW_API_KEY?.trim();
  if (!key) throw new Error("ROBOFLOW_API_KEY missing (run via npm run eval:run)");
  mk(CACHE);
  const all: Item[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const items = all.filter((i) => i.source === "vegann" || i.source === "own" || i.expected?.relevant);
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
