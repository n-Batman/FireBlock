import { demoFindingsAt } from "@/content/demoFindings";
import type { ScanResponse } from "@/data/types";
import { parseScanRequest } from "@/lib/scanApi";
import { scanFrame, VisionError } from "@/lib/vision";

// Live requests go to the OpenAI vision model (gpt-6.1-terra, Responses API, strict
// text.format = SCAN_JSON_SCHEMA), see src/lib/vision.ts. The key is read there, on the server only.
// Demo requests (with `demoTime`) stay on the canned timeline so the judges' run is the same
// every time. A failure is an error status, never made-up findings: the scan screen shows it.

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON." }, { status: 400 });
  }

  const parsed = parseScanRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  if (parsed.demoTime !== undefined) {
    const response: ScanResponse = { findings: demoFindingsAt(parsed.demoTime) };
    return Response.json(response);
  }

  try {
    const response: ScanResponse = { findings: await scanFrame(parsed.image) };
    return Response.json(response);
  } catch (error) {
    if (error instanceof VisionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "The scan failed." }, { status: 500 });
  }
}
