import { SCAN_JSON_SCHEMA, type Finding } from "@/data/types";

// OpenAI model ID from https://developers.openai.com/api/docs/models/gpt-6.1-terra
// (text and image input, Responses API, structured outputs).
const MODEL = "gpt-6.1-terra";
// Low effort keeps a frame well inside the 8 second budget. Raise it only if accuracy needs it.
const REASONING_EFFORT = "low";
const TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You are a fuels inspector walking a vineyard before fire season. You look at one camera frame and report what burns and what does not.

Judge every region by how dry it looks:
- risk: brown, tan, cured or standing-dead grass and weeds; dead brush; debris, stacked wood or dry brush touching or close to a building, fence or vine row.
- clear: green, live plants; green cover crop; irrigated vines; bare dirt or gravel; mowed or cleared ground.
Green leaves and green cuttings are clear, even when the frame is a close-up of one plant. Dry, tan or brown vegetation is risk, even when it fills the frame or is held in a hand.

Rules:
- Give each distinct region one finding with a short label (2 to 4 words), severity, and a bbox [xmin, ymin, xmax, ymax] as integers 0 to 999 relative to the frame, with 0,0 at the top left.
- For risk, action is a short, concrete instruction like "Mow by June 1" or "Cut back 5 ft from the wall". For clear, action is "Keep it trimmed" or similar.
- Report at most 6 findings. Merge neighbouring regions of the same kind.
- When you are unsure, say clear. Never invent risk. If the frame shows no plants or ground, return no findings.`;

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
  const { label, severity, action, bbox } = raw as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "") return null;
  if (typeof action !== "string" || action.trim() === "") return null;
  if (severity !== "risk" && severity !== "clear") return null;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  const box = bbox.map(clamp) as Finding["bbox"];
  if (box[2] <= box[0] || box[3] <= box[1]) return null;
  return { label, severity, action, bbox: box };
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
  return list.map(toFinding).filter((f): f is Finding => f !== null);
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
              { type: "input_image", image_url: image },
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
