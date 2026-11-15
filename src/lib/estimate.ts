import { MODEL, REASONING_EFFORT, VisionError, outputText } from "@/lib/vision";

const TIMEOUT_MS = 12000;
const MAX_OUTPUT_TOKENS = 800; // keeps a call near $0.005
export const EST_ROWS = 6;
export const EST_COLS = 8;
const CELLS = ["dry", "live", "soil", "other"] as const;
export type EstimateCell = (typeof CELLS)[number];

export interface Estimate {
  /** Dry share of GROUND vegetation, 0 to 100 (0 when there is none). */
  dryPct: number;
  /** Share of the frame that is ground vegetation, 0 to 1. */
  vegFrac: number;
  /** EST_ROWS x EST_COLS, top row first. */
  grid: EstimateCell[][];
}

const SCHEMA = {
  name: "ground_dry_estimate",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["dry_pct", "veg_frac", "grid"],
    properties: {
      dry_pct: { type: "number", description: "Percent (0 to 100) of the GROUND vegetation that is dry. 0 if there is no ground vegetation." },
      veg_frac: { type: "number", description: "Fraction (0 to 1) of the frame covered by ground vegetation." },
      grid: {
        type: "array",
        minItems: EST_ROWS,
        maxItems: EST_ROWS,
        description: `${EST_ROWS} rows, top of the frame first, each with ${EST_COLS} cells, left to right.`,
        items: { type: "array", minItems: EST_COLS, maxItems: EST_COLS, items: { type: "string", enum: [...CELLS] } },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a wildfire fuels inspector rating one photo for dry ground fuel.
Rate only GROUND vegetation: grass, weeds, cover crop, leaf and grass litter.
Ignore vine and tree canopy, autumn vine leaves still on the vine, trunks, canes, posts, sky and buildings.
Bare soil, tilled rows, dirt roads, gravel, sand and snow are NOT vegetation and NOT dry fuel.
Golden, tan or straw cured grass counts as dry even with a green tint.
Return dry_pct (percent of the ground vegetation that is dry, 0 if there is none), veg_frac (share of the frame that is ground vegetation) and a ${EST_ROWS} x ${EST_COLS} grid over the frame labelling each cell by what mostly fills it: "dry" (dry ground vegetation), "live" (green ground vegetation), "soil" (bare soil, road, gravel, sand, snow) or "other" (canopy, trunks, posts, sky, buildings).`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validates and clamps the model's JSON. Anything malformed is a VisionError. */
export function parseEstimate(text: string): Estimate {
  const bad = () => new VisionError("The estimate was malformed.", 502);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw bad();
  }
  const { dry_pct, veg_frac, grid } = raw ?? {};
  if (typeof dry_pct !== "number" || !Number.isFinite(dry_pct) || typeof veg_frac !== "number" || !Number.isFinite(veg_frac)) throw bad();
  if (!Array.isArray(grid) || grid.length !== EST_ROWS) throw bad();
  const cells = grid.map((row) => {
    if (!Array.isArray(row) || row.length !== EST_COLS || !row.every((c) => CELLS.includes(c as EstimateCell))) throw bad();
    return row as EstimateCell[];
  });
  return { dryPct: clamp(dry_pct, 0, 100), vegFrac: clamp(veg_frac, 0, 1), grid: cells };
}

/** Rates the dry share of ground vegetation in one photo (data URL). Throws VisionError. */
export async function estimateDry(imageDataUrl: string, { timeoutMs = TIMEOUT_MS } = {}): Promise<Estimate> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new VisionError("The scanner is not set up on this server.", 503);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: REASONING_EFFORT },
        instructions: SYSTEM_PROMPT,
        input: [{ role: "user", content: [{ type: "input_image", image_url: imageDataUrl, detail: "high" }] }],
        text: { format: { type: "json_schema", ...SCHEMA } },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw timedOut ? new VisionError("The estimate took too long.", 504) : new VisionError("Could not reach the vision service.", 502);
  }
  // Upstream error bodies are never passed on: they can quote the key or the request.
  if (!res.ok) throw new VisionError(`The vision service returned an error (${res.status}).`, res.status === 429 ? 429 : 502);
  return parseEstimate(outputText(await res.json()));
}
