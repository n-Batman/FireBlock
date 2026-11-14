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

  it("returns the model's grid with an empty findings list", async () => {
    const rows = Array(8).fill("ggggggddddgg");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ rows, findings: [] }) }] }],
      }),
    });
    const res = await post({ image: IMAGE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings).toEqual([]);
    expect(body.grid.cells).toHaveLength(96);
    expect(body.grid.cells[6]).toBe("d");
  });

  it("returns an error status, not fake findings, when the key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await post({ image: IMAGE });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it("returns an error status, not fake findings, when OpenAI fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const res = await post({ image: IMAGE });
    expect(res.status).toBe(502);
    expect(await res.json()).not.toHaveProperty("findings");
  });

  it("still rejects a bad request with 400", async () => {
    expect((await post({ image: "nope" })).status).toBe(400);
  });
});
