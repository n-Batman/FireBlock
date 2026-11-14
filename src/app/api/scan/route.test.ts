import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoFindingsAt } from "@/content/demoFindings";
import { POST } from "./route";

const IMAGE = "data:image/jpeg;base64,AAAA";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/scan", { method: "POST", body: JSON.stringify(body) }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/scan", () => {
  it("keeps demo requests on the canned timeline and never calls OpenAI", async () => {
    const res = await post({ image: IMAGE, demoTime: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ findings: demoFindingsAt(3) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends live frames elsewhere: only demo requests are served here", async () => {
    const res = await post({ image: IMAGE });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still rejects a bad request with 400", async () => {
    expect((await post({ image: "nope" })).status).toBe(400);
  });
});
