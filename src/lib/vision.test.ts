import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanGrid, scanGridWithRetry } from "./vision";

const IMAGE = "data:image/jpeg;base64,AAAA";
const rows = Array.from({ length: 8 }, () => "gggggggddddd");
const reply = {
  rows,
  findings: [
    { label: "Dry grass", where: "right edge", reason: "Cured and tan.", action: "Mow it.", code: "d", anchor: "L8" },
  ],
};
const apiReply = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(body) }] }] }),
});

describe("scanGrid", () => {
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

  it("sends the labelled frame at high detail with the strict grid schema and the checklist prompt", async () => {
    fetchMock.mockResolvedValue(apiReply(reply));
    const grid = await scanGrid(IMAGE);
    expect(grid.cells).toHaveLength(96);
    expect(grid.findings[0].cells).toEqual(Array.from({ length: 8 }, (_, r) => r * 12 + 11).concat(Array.from({ length: 8 }, (_, r) => r * 12 + 7), Array.from({ length: 8 }, (_, r) => r * 12 + 8), Array.from({ length: 8 }, (_, r) => r * 12 + 9), Array.from({ length: 8 }, (_, r) => r * 12 + 10)).sort((a, b) => a - b));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(init.body);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "grid_scan", strict: true });
    const content = body.input.flatMap((m: { content: unknown }) => m.content);
    expect(content).toContainEqual({ type: "input_image", image_url: IMAGE, detail: "high" });
    for (const phrase of ["EVERY cell", "edges, corners and background", "Treat brown or tan grass as cured fuel even when green grass"]) {
      expect(body.instructions).toContain(phrase);
    }
    expect(body).not.toHaveProperty("temperature"); // the newest models reject it
  });

  it("says the scanner is not configured when the key is missing, without calling OpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(scanGrid(IMAGE)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 504 on a timeout and 502 when the grid is the wrong shape", async () => {
    fetchMock.mockImplementation((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    );
    await expect(scanGrid(IMAGE, { timeoutMs: 20 })).rejects.toMatchObject({ status: 504 });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(apiReply({ rows: ["ggg"], findings: [] }));
    await expect(scanGrid(IMAGE)).rejects.toMatchObject({ status: 502 });
  });

  it("never passes the upstream error body on", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "bad key sk-test-key" }) });
    const error = await scanGrid(IMAGE).catch((e) => e);
    expect(error.message).not.toContain("sk-test-key");
    expect(error.status).toBe(502);
  });

  it("retries once when the grid comes back unreadable, but not on other errors", async () => {
    fetchMock.mockResolvedValueOnce(apiReply({ rows: ["ggg"], findings: [] })).mockResolvedValueOnce(apiReply(reply));
    expect((await scanGridWithRetry(IMAGE)).cells).toHaveLength(96);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(scanGridWithRetry(IMAGE)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
