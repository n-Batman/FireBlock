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
