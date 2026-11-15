import { estimateDry } from "@/lib/estimate";
import { parseScanRequest } from "@/lib/scanApi";
import { VisionError } from "@/lib/vision";

// POST { image } -> { dry_pct, veg_frac, grid }: the model's rating of the dry share of ground vegetation.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const parsed = parseScanRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const { dryPct, vegFrac, grid } = await estimateDry(parsed.image);
    return Response.json({ dry_pct: dryPct, veg_frac: vegFrac, grid });
  } catch (error) {
    if (error instanceof VisionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "The estimate failed." }, { status: 500 });
  }
}
