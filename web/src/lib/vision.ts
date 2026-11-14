import { SCAN_JSON_SCHEMA, type Finding } from "@/data/types";

// OpenAI model ID from https://developers.openai.com/api/docs/models/gpt-6.1-terra
// (text and image input, Responses API, structured outputs).
const MODEL = "gpt-6.1-terra";
// "none" answers in about 3 s per frame, "low" took 5.6 s on the same frame. The budget is 8 s.
// Raise it only if the dry/green photo checks need it.
const REASONING_EFFORT = "none";
const TIMEOUT_MS = 8000;
const MAX_FINDINGS = 3;
// Frames are sent at 640 px, so "low" detail keeps the call fast. Use "auto" if small fuels get missed.
const IMAGE_DETAIL = "low";

const SYSTEM_PROMPT = `You are a fuels inspector walking a vineyard before fire season. You look at one camera frame and report only vegetation and fuel: grass, brush, leaf litter, dead wood, vines, cover crop. Ignore buildings, pavement, sky, vehicles and people.

Judge each region by how dry it looks:
- risk: brown, tan, cured or standing-dead grass and weeds; dead brush; leaf litter or dead wood piled against a structure, fence or vine row.
- clear: green, live plants; green cover crop; irrigated vines; bare dirt or gravel; mowed or cleared ground.
Green leaves and green cuttings are clear, even when the frame is a close-up of one plant. Dry, tan or brown vegetation is risk, even when it fills the frame or is held in a hand.

Rules:
- Report at most 3 findings, the ones that matter most. Merge neighbouring regions of the same kind into one.
- Each finding: a short label (2 to 4 words), severity, a bbox [xmin, ymin, xmax, ymax] as integers 0 to 999 relative to the frame with 0,0 at the top left, and a confidence from 0 to 1.
- For risk, action is a short, concrete instruction like "Mow by June 1" or "Cut back 5 ft from the wall". For clear, action is "Keep it trimmed" or similar.
- When you are unsure, say clear with a low confidence. Never invent risk. If the frame shows no vegetation, return no findings.`;

export class VisionError extends Error {
  constructor(
    message: string,
    /** HTTP status the scan route should answer with. */
    readonly status: number,
  ) {
    super(message);
  }
}

const clamp = (n: number) => Math.min(999, Math.max(0, Math.round(n)));

function toFinding(raw: unknown): Finding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { label, severity, action, bbox, confidence } = raw as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "") return null;
  if (typeof action !== "string" || action.trim() === "") return null;
  if (severity !== "risk" && severity !== "clear") return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  const box = bbox.map(clamp) as Finding["bbox"];
  if (box[2] <= box[0] || box[3] <= box[1]) return null;
  return { label, severity, action, bbox: box, confidence: Math.min(1, Math.max(0, confidence)) };
}

/** Reads the model's JSON text, clamps each bbox to 0..999 and drops findings that are malformed. */
export function parseFindings(text: string): Finding[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (data as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(list)) return [];
  return list
    .map(toFinding)
    .filter((f): f is Finding => f !== null)
    .slice(0, MAX_FINDINGS);
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

/** Sends one JPEG data URL to the vision model and returns its findings. Throws VisionError. */
export async function scanFrame(image: string, { timeoutMs = TIMEOUT_MS } = {}): Promise<Finding[]> {
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
              { type: "input_text", text: "Inspect this frame." },
              { type: "input_image", image_url: image, detail: IMAGE_DETAIL },
            ],
          },
        ],
        text: { format: { type: "json_schema", ...SCAN_JSON_SCHEMA } },
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
  return parseFindings(outputText(await res.json()));
}
