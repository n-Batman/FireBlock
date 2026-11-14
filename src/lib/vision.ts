import { GRID_JSON_SCHEMA, type GridScan } from "@/data/types";
import { parseGrid } from "./grid";

// gpt-6.1-terra with no reasoning: about 3 s a frame. gpt-6.1-sol is stronger but cannot go below
// "low" (minimal and none are rejected) and takes 11 to 27 s. Neither accepts `temperature`.
// Measured on SRV1 and SRV5: the red lands on the same dry areas.
const MODEL = "gpt-6.1-terra";
const REASONING_EFFORT = "none";
const TIMEOUT_MS = 40000;
const IMAGE_DETAIL = "high";

const SYSTEM_PROMPT = `You are a wildfire fuels inspector using defensible-space guidance (CAL FIRE / Ready for Wildfire). The photo has a 12 x 8 grid drawn on it: columns A to L left to right, rows 1 to 8 top to bottom, and every cell has its label (A1, B1 ... L8) in its top-left corner.

Step 1: classify EVERY cell, all 96, by what covers most of it. One letter each:
d = dry, cured, tan or brown grass and weeds (standing or flattened). Treat brown or tan grass as cured fuel even when green grass is right next to it.
b = dead brush, dead branches or dead wood.
l = leaf litter, dead leaves on the ground, or mulch.
w = dormant woody plant: bare or leafless vines, trunks, canes, shrubs with no live foliage.
g = green cover crop, green grass or green weeds.
v = green vine or tree canopy, live foliage.
s = bare soil, gravel or pavement.
o = structure, vehicle, sky, distant hills or anything else.
Rules: look at the WHOLE frame, edges, corners and background as carefully as the centre. Do not let the middle of the picture decide the cells around it. A cell with dry grass under a live canopy is d only if the dry grass is clearly visible. Judge each cell on its own.

Step 2: "rows" is 8 strings, row 1 first, each exactly 12 letters (columns A to L).

Step 3: "findings": at most 6 specific findings, one per distinct patch, the risks first. Each has label (the fuel, 2 to 4 words), where (location words: "right edge between rows", "at post base", "background hillside"), reason (one short sentence on what you see), action (a concrete instruction for d, b and l; an empty string for g, v and s), code (the letter of that patch: d, b, l, g, v or s) and anchor (one cell of that patch, like "L4", that you gave that same letter in the rows). Cover every patch of d, b and l; do not leave dry fuel without a finding.`;

export class VisionError extends Error {
  constructor(
    message: string,
    /** HTTP status the scan route should answer with. */
    readonly status: number,
  ) {
    super(message);
  }
}

/** The model's text out of a Responses API reply. A refusal or empty reply is an error. */
function outputText(reply: unknown): string {
  const output = (reply as { output?: { content?: { type: string; text?: string }[] }[] } | null)?.output ?? [];
  for (const item of output) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  throw new VisionError("The vision model did not return a result.", 502);
}

/** Sends one grid-labelled JPEG data URL to the vision model and returns the 12 x 8 grid. Throws VisionError. */
export async function scanGrid(image: string, { timeoutMs = TIMEOUT_MS } = {}): Promise<GridScan> {
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
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Classify every cell of this frame." },
              { type: "input_image", image_url: image, detail: IMAGE_DETAIL },
            ],
          },
        ],
        text: { format: { type: "json_schema", ...GRID_JSON_SCHEMA } },
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw timedOut
      ? new VisionError("The scan took too long. Try again.", 504)
      : new VisionError("Could not reach the vision service.", 502);
  }

  // Upstream error bodies are never passed on: they can quote the key or the request.
  if (!res.ok) throw new VisionError(`The vision service returned an error (${res.status}).`, 502);
  const grid = parseGrid(outputText(await res.json()));
  if (!grid) throw new VisionError("The vision model returned a grid that could not be read.", 502);
  return grid;
}

/** scanGrid, once more if the model's grid came back unreadable (it is not deterministic). */
export async function scanGridWithRetry(image: string, options?: { timeoutMs?: number }): Promise<GridScan> {
  try {
    return await scanGrid(image, options);
  } catch (error) {
    if (error instanceof VisionError && error.message.includes("could not be read")) return scanGrid(image, options);
    throw error;
  }
}
