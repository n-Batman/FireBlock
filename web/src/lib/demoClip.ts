export const DEMO_CLIP_URL = "/demo/vineyard.mp4";

/**
 * Is the demo clip really there? A catch-all page that answers 200 with HTML does not count,
 * so the answer must also be a video. Any failure means "no".
 */
export async function demoClipExists(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(DEMO_CLIP_URL, { method: "HEAD" });
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("video/");
  } catch {
    return false;
  }
}
