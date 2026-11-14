import type { RiskAreaInput } from "@/data/types";

const MAX_IMAGE_CHARS = 4_000_000;

export type ScanRequest =
  | { ok: true; image: string; demoTime: number | undefined }
  | { ok: false; error: string };

/** Checks the body of POST /api/scan. `image` is a JPEG data URL, `demoTime` is video seconds. */
export function parseScanRequest(body: unknown): ScanRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Send a JSON object with an image." };
  }
  const { image, demoTime } = body as { image?: unknown; demoTime?: unknown };
  if (typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,")) {
    return { ok: false, error: "image must be a JPEG data URL." };
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return { ok: false, error: "image is too large. Send the longest side at 1600 px or less." };
  }
  if (demoTime !== undefined && (typeof demoTime !== "number" || !Number.isFinite(demoTime) || demoTime < 0)) {
    return { ok: false, error: "demoTime must be zero or more seconds." };
  }
  return { ok: true, image, demoTime };
}

const unit = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const pct = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

/** The measured areas from the browser, checked. Null when any is malformed. */
export function parseAreas(raw: unknown): RiskAreaInput[] | null {
  if (!Array.isArray(raw) || raw.length > 6) return null;
  const out: RiskAreaInput[] = [];
  for (const a of raw) {
    const { id, box, pctOfRisk, pctOfFrame, where } = (a ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(id) || !Array.isArray(box) || box.length !== 4 || !box.every(unit)) return null;
    if (!pct(pctOfRisk) || !pct(pctOfFrame) || typeof where !== "string" || where.length > 40) return null;
    out.push({ id: id as number, box: box as RiskAreaInput["box"], pctOfRisk: pctOfRisk as number, pctOfFrame: pctOfFrame as number, where });
  }
  return out;
}
