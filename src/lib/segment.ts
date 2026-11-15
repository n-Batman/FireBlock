import type { Group, Mask, Polygon } from "./fuelMask";
import { VisionError } from "./vision";

export type { Mask, Polygon };

export const ENDPOINT = "https://serverless.roboflow.com/sam3/concept_segment";
const TIMEOUT_MS = 20000;
/**
 * SAM3 concepts in three groups. Dry masks say "fuel here" (the pixel colour still has to agree), live masks say
 * "living plants", exclude masks say "never fuel" and always win: soil, trunks, dormant vines, posts, sky, snow and
 * autumn vine leaves (red and orange, but not fuel). At most 16 prompts per call.
 */
export const GROUPS: Record<Group, string[]> = {
  dry: ["dry grass", "dead grass", "dead weeds", "dry brush", "leaf litter"],
  live: ["green grass", "cover crop", "green plants", "foliage"],
  exclude: ["bare soil", "tree trunk", "dormant grapevine", "wooden post", "sky", "snow", "autumn grape leaves"],
};
export const PROMPTS: string[] = [...GROUPS.dry, ...GROUPS.live, ...GROUPS.exclude];
/**
 * A second call, because the first is at the 16-prompt cap: things that are never fuel. Its masks join the exclude group.
 * "plowed soil" stays soft like "bare soil" (straw colour with grassy texture may still override it); the rest are hard
 * and nothing overrides them (see `Mask.hard`).
 */
export const OBJECT_PROMPTS: string[] = ["dirt road", "gravel path", "plowed soil", "dog", "person", "fence post", "building", "vehicle"];
const SOFT_OBJECTS = ["plowed soil"];
/** Minimum confidence for the second call's masks. Tuned on EVAL_SPLIT=train only. */
export const OBJECT_MIN_CONFIDENCE = 0.4;
/** The second call gives up sooner than the first: without it the scan is exactly what it was. */
const OBJECT_TIMEOUT_MS = 10000;
const groupOf = (text: string): Group | null =>
  (Object.keys(GROUPS) as Group[]).find((g) => GROUPS[g].includes(text)) ?? (OBJECT_PROMPTS.includes(text) ? "exclude" : null);
/** Roboflow's serverless SAM3 answers 500 now and then; a 5xx is tried again this many times. */
const RETRIES = 2;
/** Sent to SAM3 low so dry masks keep their weaker hits; the client filters per group below. */
export const PROB_THRESH = 0.3;
/** Minimum confidence to keep a mask: dry fuel and exclude masks are kept from 0.3, live plants from 0.4. */
export const MIN_CONFIDENCE: Record<Group, number> = { dry: 0.3, live: 0.4, exclude: 0.3 };

/**
 * Every mask in the reply with the group of the prompt that found it. The prompt comes from the echoed text, else
 * its index. Masks under their group's confidence, malformed points and rings under 3 points are dropped.
 */
export function parseSegments(reply: unknown, prompts: string[] = PROMPTS): Mask[] {
  const results = (reply as { prompt_results?: unknown } | null)?.prompt_results;
  if (!Array.isArray(results)) throw new VisionError("Segmentation returned no results.", 502);
  const out: Mask[] = [];
  results.forEach((result, position) => {
    const r = result as { prompt_index?: unknown; echo?: { text?: unknown; prompt?: { text?: unknown } }; predictions?: unknown[] };
    const echoed = [r?.echo?.text, r?.echo?.prompt?.text].find((t): t is string => typeof t === "string");
    const text = echoed ?? prompts[typeof r?.prompt_index === "number" ? r.prompt_index : position];
    const group = text ? groupOf(text) : null;
    if (!group || !text) return;
    const object = OBJECT_PROMPTS.includes(text);
    const min = object ? OBJECT_MIN_CONFIDENCE : MIN_CONFIDENCE[group];
    for (const prediction of r?.predictions ?? []) {
      const { masks, confidence } = (prediction ?? {}) as { masks?: unknown; confidence?: unknown };
      if (!Array.isArray(masks) || (typeof confidence === "number" && confidence < min)) continue;
      const polys: Polygon[] = [];
      for (const poly of masks) {
        if (!Array.isArray(poly)) continue;
        const points = poly
          .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map(([x, y]) => [x, y] as [number, number]);
        if (points.length >= 3) polys.push(points);
      }
      if (polys.length) out.push(object && !SOFT_OBJECTS.includes(text) ? { group, polys, hard: true } : { group, polys });
    }
  });
  return out;
}

/** The exact request body sent to SAM3. Shared with the eval harness so it tests what the app sends. */
export function segmentBody(image: string, prompts: string[] = PROMPTS): string {
  return JSON.stringify({
    image: { type: "base64", value: image.slice(image.indexOf(",") + 1) },
    prompts: prompts.map((text) => ({ type: "text", text })),
    format: "polygon",
    output_prob_thresh: PROB_THRESH,
  });
}

/** Both calls' replies as one mask list. The object reply is optional: null or malformed leaves the first call's masks as they were. */
export function parseAll(reply: unknown, objectReply: unknown): Mask[] {
  const masks = parseSegments(reply);
  if (objectReply == null) return masks;
  try {
    return [...masks, ...parseSegments(objectReply, OBJECT_PROMPTS)];
  } catch {
    return masks;
  }
}

/** One SAM3 request, a 5xx tried again. Returns the parsed JSON reply. */
async function post(body: string, key: string, deadline: AbortSignal): Promise<unknown> {
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
    return res.json();
  }
}

/**
 * Sends one JPEG data URL to Roboflow SAM3 and returns the masks: the main call and, in parallel, the object call.
 * A failed or slow object call is ignored. The key never leaves the server.
 */
export async function segmentFrame(image: string, { timeoutMs = TIMEOUT_MS } = {}): Promise<Mask[]> {
  const key = process.env.ROBOFLOW_API_KEY?.trim();
  if (!key) throw new VisionError("Segmentation is not set up on this server.", 503);
  const objects = post(segmentBody(image, OBJECT_PROMPTS), key, AbortSignal.timeout(Math.min(timeoutMs, OBJECT_TIMEOUT_MS))).catch(() => null);
  const [main, extra] = await Promise.all([post(segmentBody(image), key, AbortSignal.timeout(timeoutMs)), objects]);
  return parseAll(main, extra);
}
