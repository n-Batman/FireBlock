import { FINDINGS_JSON_SCHEMA, type AreaNote, type RiskAreaInput } from "@/data/types";

// gpt-6.1-terra with no reasoning answers in about 3 s. It only writes words: the areas, their places and
// sizes are measured in the browser and passed in, so it cannot add or move a risk.
const MODEL = "gpt-6.1-terra";
const REASONING_EFFORT = "none";
const TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `You are a wildfire fuels inspector using defensible-space guidance (CAL FIRE / Ready for Wildfire). You get a vineyard photo and a list of risk areas that were already measured in it: each has an id, a box [xmin, ymin, xmax, ymax] as fractions of the frame (0,0 top left), location words, and how much of the dry fuel it holds.

For each area, look at that part of the photo and write one note:
- area: its id, exactly as given.
- label: what the fuel is, 2 to 4 words ("Cured grass", "Dry weeds at post base").
- reason: one short sentence on what you see there and why it carries fire.
- action: one concrete instruction ("Mow to 4 inches before June 1.", "Clear 5 ft around the post.").
Only describe the areas you were given, never others. Do not change the measured numbers or say an area is clear.`;

export class VisionError extends Error {
  constructor(
    message: string,
    /** HTTP status the route should answer with. */
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

/** Keeps notes that name a given area, one per area, in the given order. */
export function parseNotes(text: string, areas: RiskAreaInput[]): AreaNote[] {
  let list: unknown;
  try {
    list = (JSON.parse(text) as { notes?: unknown })?.notes;
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const byArea = new Map<number, AreaNote>();
  for (const raw of list) {
    const { area, label, reason, action } = (raw ?? {}) as Record<string, unknown>;
    if (typeof area !== "number" || !areas.some((a) => a.id === area) || byArea.has(area)) continue;
    if (typeof label !== "string" || !label.trim() || typeof reason !== "string" || typeof action !== "string") continue;
    byArea.set(area, { area, label: label.trim(), reason: reason.trim(), action: action.trim() });
  }
  return areas.flatMap((a) => byArea.get(a.id) ?? []);
}

/** Asks the model for words about the measured risk areas. No areas, no call. Throws VisionError. */
export async function writeFindings(
  image: string,
  areas: RiskAreaInput[],
  share: number,
  { timeoutMs = TIMEOUT_MS } = {},
): Promise<AreaNote[]> {
  if (areas.length === 0) return [];
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new VisionError("The scanner is not set up on this server.", 503);
  const facts = {
    dryShareOfVegetation: `${Math.round(share * 100)}%`,
    areas: areas.map((a) => ({ id: a.id, box: a.box.map((v) => Math.round(v * 100) / 100), where: a.where, shareOfDryFuel: `${a.pctOfRisk}%` })),
  };
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
              { type: "input_text", text: JSON.stringify(facts) },
              { type: "input_image", image_url: image, detail: "high" },
            ],
          },
        ],
        text: { format: { type: "json_schema", ...FINDINGS_JSON_SCHEMA } },
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw timedOut ? new VisionError("The findings took too long.", 504) : new VisionError("Could not reach the vision service.", 502);
  }
  // Upstream error bodies are never passed on: they can quote the key or the request.
  if (!res.ok) throw new VisionError(`The vision service returned an error (${res.status}).`, 502);
  return parseNotes(outputText(await res.json()), areas);
}
