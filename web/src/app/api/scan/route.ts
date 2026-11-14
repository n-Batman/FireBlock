import { demoFindingsAt } from "@/content/demoFindings";
import type { ScanResponse } from "@/data/types";
import { parseScanRequest } from "@/lib/scanApi";

// Only the demo clip uses this route now. Live frames and photos go to /api/segment (Roboflow SAM3
// masks, coloured in the browser) and /api/findings (the model's words). Demo requests (with `demoTime`) stay on the canned timeline so the judges' run is the same
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

  // Live scans and photos go to /api/segment (masks) and /api/findings (words) instead.
  return Response.json({ error: "Only demo requests are served here. Use /api/segment." }, { status: 400 });
}
