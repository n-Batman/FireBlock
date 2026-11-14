import { VisionError } from "./vision";

const ENDPOINT = "https://serverless.roboflow.com/sam3/concept_segment";
const TIMEOUT_MS = 20000;
/**
 * Vegetation concepts. The label only says "this is vegetation"; the pixel colour decides risk. SAM3 found no
 * vines for "grapevine leaves" on SRV1/3/6/9, so "foliage", "plant" and "green plants" catch the canopy.
 * ("vineyard" was tried and dropped: its mask spreads over bare dirt, which then reads as straw.)
 */
export const PROMPTS = [
  "dry grass",
  "dead grass",
  "green grass",
  "dead brush",
  "leaf litter",
  "grapevine leaves",
  "tree",
  "foliage",
  "plant",
  "green plants",
];
/** Roboflow's serverless SAM3 answers 500 now and then; a 5xx is tried again this many times. */
const RETRIES = 2;
const PROB_THRESH = 0.4;

export type Polygon = [number, number][];

/** Every polygon in the reply, in pixels of the sent image. Malformed points and polygons under 3 points are dropped. */
export function parseSegments(reply: unknown): Polygon[] {
  const results = (reply as { prompt_results?: unknown } | null)?.prompt_results;
  if (!Array.isArray(results)) throw new VisionError("Segmentation returned no results.", 502);
  const out: Polygon[] = [];
  for (const result of results) {
    for (const prediction of (result as { predictions?: unknown[] })?.predictions ?? []) {
      const masks = (prediction as { masks?: unknown })?.masks;
      if (!Array.isArray(masks)) continue;
      for (const poly of masks) {
        if (!Array.isArray(poly)) continue;
        const points = poly.filter(
          (p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
        ).map(([x, y]) => [x, y] as [number, number]);
        if (points.length >= 3) out.push(points);
      }
    }
  }
  return out;
}

/** Sends one JPEG data URL to Roboflow SAM3 and returns the vegetation polygons. The key never leaves the server. */
export async function segmentFrame(image: string, { timeoutMs = TIMEOUT_MS } = {}): Promise<Polygon[]> {
  const key = process.env.ROBOFLOW_API_KEY?.trim();
  if (!key) throw new VisionError("Segmentation is not set up on this server.", 503);
  const body = JSON.stringify({
    image: { type: "base64", value: image.slice(image.indexOf(",") + 1) },
    prompts: PROMPTS.map((text) => ({ type: "text", text })),
    format: "polygon",
    output_prob_thresh: PROB_THRESH,
  });
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body,
        signal: deadline,
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw timedOut ? new VisionError("Segmentation took too long.", 504) : new VisionError("Could not reach segmentation.", 502);
    }
    if (res.status >= 500 && attempt < RETRIES) continue;
    // The upstream body is never passed on or logged: it can echo the key.
    if (!res.ok) throw new VisionError(`Segmentation returned an error (${res.status}).`, 502);
    return parseSegments(await res.json());
  }
}
