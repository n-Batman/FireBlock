/* The eval's model replies, cached in eval/cache by request: SAM3 (both calls, shared with the app through src/lib/segment.ts) and the VLM estimate. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { SYSTEM_PROMPT, estimateDry, type Estimate } from "../../src/lib/estimate";
import type { Mask } from "../../src/lib/fuelMask";
import { ENDPOINT, OBJECT_PROMPTS, parseAll, segmentBody } from "../../src/lib/segment";
import { CACHE, sha, sleep } from "./common";

/** Same framing as the app: longest side 1024, JPEG 0.85. */
export async function frame(path: string) {
  const { data, info } = await sharp(path).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return { jpeg: data, w: info.width, h: info.height };
}

/** One SAM3 reply for `body`, cached by the body's hash (the two calls have different bodies, so each has its own file). */
async function sam(body: string, key: string) {
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

/** Both SAM calls' raw replies; the object reply is null when EVAL_OBJECTS=0 (the before-numbers) or that call fails, as in the app. */
export async function samReplies(jpeg: Buffer, key: string) {
  const image = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const objects = process.env.EVAL_OBJECTS === "0" ? Promise.resolve(null) : sam(segmentBody(image, OBJECT_PROMPTS), key).catch(() => null);
  const [main, extra] = await Promise.all([sam(segmentBody(image), key), objects]);
  return { main, extra };
}

/** The masks the app would scan with for this frame. */
export async function segment(jpeg: Buffer, key: string): Promise<Mask[]> {
  const { main, extra } = await samReplies(jpeg, key);
  return parseAll(main, extra);
}

/** One VLM estimate, cached by frame. Retries 429/5xx twice. */
export async function estimate(jpeg: Buffer): Promise<Estimate> {
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
