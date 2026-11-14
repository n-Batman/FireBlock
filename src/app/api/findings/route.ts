import { parseAreas, parseScanRequest } from "@/lib/scanApi";
import { VisionError, writeFindings } from "@/lib/vision";

// POST { image, areas, share } -> { notes }: the model's words for the risk areas the browser measured.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const parsed = parseScanRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { areas: rawAreas, share } = body as { areas?: unknown; share?: unknown };
  const areas = parseAreas(rawAreas);
  if (!areas || typeof share !== "number" || !(share >= 0 && share <= 1)) return Response.json({ error: "Send the measured areas and share." }, { status: 400 });
  try {
    return Response.json({ notes: await writeFindings(parsed.image, areas, share as number) });
  } catch (error) {
    if (error instanceof VisionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "The findings failed." }, { status: 500 });
  }
}
