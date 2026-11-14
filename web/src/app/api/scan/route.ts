import { demoFindingsAt } from "@/content/demoFindings";
import type { Finding, ScanResponse } from "@/data/types";
import { parseScanRequest } from "@/lib/scanApi";

// STUB. Returns canned findings after a 400 to 800 ms delay so the scanner screen can be
// built and demoed. To wire the real model, replace `liveFindings` below with the OpenAI call
// (gpt-4.1-mini, Responses API, text.format = SCAN_JSON_SCHEMA from src/data/types.ts, strict)
// and keep the response shape: { findings: Finding[] }. Demo requests (with `demoTime`) should
// keep using the timeline so the judges' run is the same every time.

let calls = 0;

/** Canned live findings that drift a little on each call, so boxes can be matched across frames. */
function liveFindings(n: number): Finding[] {
  const drift = (n % 4) * 6;
  return [
    { label: "Dry growth", severity: "risk", action: "Mow by June 1", bbox: [180 + drift, 480, 480 + drift, 800] },
    { label: "Brush touching barn", severity: "risk", action: "Cut back 5 ft from the wall", bbox: [560, 250 - drift, 860, 560 - drift] },
    { label: "Stacked firewood", severity: "risk", action: "Move 30 ft from the house", bbox: [90 + drift, 130, 300 + drift, 360] },
    { label: "Cleared firebreak", severity: "clear", action: "Keep it trimmed", bbox: [80, 830, 920, 970] },
  ];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON." }, { status: 400 });
  }

  const parsed = parseScanRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400));

  const findings =
    parsed.demoTime !== undefined ? demoFindingsAt(parsed.demoTime) : liveFindings(calls++);
  const response: ScanResponse = { findings };
  return Response.json(response);
}
