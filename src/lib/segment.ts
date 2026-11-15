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
const groupOf = (text: string): Group | null => (Object.keys(GROUPS) as Group[]).find((g) => GROUPS[g].includes(text)) ?? null;
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
export function parseSegments(reply: unknown): Mask[] {
  const results = (reply as { prompt_results?: unknown } | null)?.prompt_results;
  if (!Array.isArray(results)) throw new VisionError("Segmentation returned no results.", 502);
  const out: Mask[] = [];
  results.forEach((result, position) => {
    const r = result as { prompt_index?: unknown; echo?: { text?: unknown; prompt?: { text?: unknown } }; predictions?: unknown[] };
    const echoed = [r?.echo?.text, r?.echo?.prompt?.text].find((t): t is string => typeof t === "string");
    const text = echoed ?? PROMPTS[typeof r?.prompt_index === "number" ? r.prompt_index : position];
    const group = text ? groupOf(text) : null;
    if (!group) return;
    for (const prediction of r?.predictions ?? []) {
      const { masks, confidence } = (prediction ?? {}) as { masks?: unknown; confidence?: unknown };
      if (!Array.isArray(masks) || (typeof confidence === "number" && confidence < MIN_CONFIDENCE[group])) continue;
      const polys: Polygon[] = [];
      for (const poly of masks) {
        if (!Array.isArray(poly)) continue;
        const points = poly
          .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map(([x, y]) => [x, y] as [number, number]);
        if (points.length >= 3) polys.push(points);
      }
      if (polys.length) out.push({ group, polys });
    }
  });
  return out;
}

/** The exact request body sent to SAM3. Shared with the eval harness so it tests what the app sends. */
export function segmentBody(image: string): string {
  return JSON.stringify({
    image: { type: "base64", value: image.slice(image.indexOf(",") + 1) },
    prompts: PROMPTS.map((text) => ({ type: "text", text })),
    format: "polygon",
    output_prob_thresh: PROB_THRESH,
  });
}

/** Sends one JPEG data URL to Roboflow SAM3 and returns the masks. The key never leaves the server. */
export async function segmentFrame(image: string, { timeoutMs = TIMEOUT_MS } = {}): Promise<Mask[]> {
  const key = process.env.ROBOFLOW_API_KEY?.trim();
  if (!key) throw new VisionError("Segmentation is not set up on this server.", 503);
  const body = segmentBody(image);
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
