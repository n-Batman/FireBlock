import { parseScanRequest } from "@/lib/scanApi";
import { segmentFrame } from "@/lib/segment";
import { VisionError } from "@/lib/vision";

// POST { image } -> { polygons }: vegetation masks from Roboflow SAM3, in pixels of the sent image.
// A failure is an error status; the scan screen then falls back to the colour-only overlay.
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
    return Response.json({ polygons: await segmentFrame(parsed.image) });
  } catch (error) {
    if (error instanceof VisionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Segmentation failed." }, { status: 500 });
  }
}
