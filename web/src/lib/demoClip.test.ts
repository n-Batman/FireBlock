import { describe, it, expect, vi } from "vitest";
import { DEMO_CLIP_URL, demoClipExists } from "./demoClip";

const reply = (status: number, type: string) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": type }) }) as Response;

describe("demoClipExists", () => {
  it("is true when the clip answers with a video", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(200, "video/mp4"));
    expect(await demoClipExists(fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(DEMO_CLIP_URL, expect.objectContaining({ method: "HEAD" }));
  });

  it("is false when the file is missing", async () => {
    expect(await demoClipExists(vi.fn().mockResolvedValue(reply(404, "text/html")))).toBe(false);
  });

  it("is false when a catch-all page answers 200 with HTML instead of a video", async () => {
    expect(await demoClipExists(vi.fn().mockResolvedValue(reply(200, "text/html")))).toBe(false);
  });

  it("is false when the request fails", async () => {
    expect(await demoClipExists(vi.fn().mockRejectedValue(new Error("offline")))).toBe(false);
  });

  it("points at the demo vineyard clip", () => {
    expect(DEMO_CLIP_URL).toBe("/demo/vineyard.mp4");
  });
});
