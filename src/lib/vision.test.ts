import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFindings, scanFrame, VisionError } from "./vision";

const IMAGE = "data:image/jpeg;base64,AAAA";
const finding = { label: "Dry growth", severity: "risk", action: "Mow by June 1", bbox: [100, 200, 400, 600], confidence: 0.9 };

/** What the Responses API returns: the model's JSON sits in output[].content[].text. */
const apiReply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }),
});

describe("parseFindings", () => {
  it("returns well-formed findings as they are", () => {
    expect(parseFindings(JSON.stringify({ findings: [finding] }))).toEqual([finding]);
  });

  it("clamps bbox to 0..999 and rounds", () => {
    const wild = { ...finding, bbox: [-40, 12.6, 1500, 999.4] };
    expect(parseFindings(JSON.stringify({ findings: [wild] }))[0].bbox).toEqual([0, 13, 999, 999]);
  });

  it("clamps confidence to 0..1", () => {
    const out = parseFindings(JSON.stringify({ findings: [{ ...finding, confidence: 1.4 }, { ...finding, bbox: [600, 600, 900, 900], confidence: -2 }] }));
    expect(out.map((x) => x.confidence)).toEqual([1, 0]);
  });

  it("keeps at most 5 findings", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...finding, label: `F${i}` }));
    expect(parseFindings(JSON.stringify({ findings: seven }))).toHaveLength(5);
  });

  it("drops malformed findings and keeps the good ones", () => {
    const bad = [
      { ...finding, confidence: undefined },
      { ...finding, confidence: "high" },
      { ...finding, severity: "maybe" },
      { ...finding, label: "" },
      { ...finding, action: 7 },
      { ...finding, bbox: [1, 2, 3] },
      { ...finding, bbox: [1, 2, "3", 4] },
      { ...finding, bbox: [500, 100, 500, 300] }, // zero width
      { ...finding, bbox: [600, 100, 200, 300] }, // xmin after xmax
      null,
      "text",
    ];
    expect(parseFindings(JSON.stringify({ findings: [...bad, finding] }))).toEqual([finding]);
  });

  it("returns nothing for output that is not the schema", () => {
    expect(parseFindings("not json")).toEqual([]);
    expect(parseFindings(JSON.stringify({ other: 1 }))).toEqual([]);
    expect(parseFindings(JSON.stringify({ findings: "x" }))).toEqual([]);
  });
});

describe("scanFrame", () => {
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

  it("sends the frame as an image with the strict JSON schema, and the key as a bearer token", async () => {
    fetchMock.mockResolvedValue(apiReply(JSON.stringify({ findings: [finding] })));
    expect(await scanFrame(IMAGE)).toEqual([finding]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-6.1-terra");
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "scan_response", strict: true });
    const content = body.input.flatMap((m: { content: unknown }) => m.content);
    expect(content).toContainEqual({ type: "input_image", image_url: IMAGE, detail: "high" });
    expect(body.instructions).toMatch(/at most 5/i);
    for (const item of ["ladder fuels", "leaf litter", "mulch", "dead material on live plants", "Healthy, no action needed", "tight box"]) {
      expect(body.instructions.toLowerCase()).toContain(item.toLowerCase());
    }
    expect(body.instructions).toMatch(/confidence/i);
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(content.some((c: { type: string }) => c.type === "input_text")).toBe(true);
  });

  it("says the scanner is not configured when the key is missing, without calling OpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(scanFrame(IMAGE)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with 504 when OpenAI takes longer than the timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    );
    await expect(scanFrame(IMAGE, { timeoutMs: 20 })).rejects.toMatchObject({ status: 504 });
  });

  it("fails with 502 on an API error, and never echoes the key", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: "bad key sk-test-key" } }) });
    const error = await scanFrame(IMAGE).catch((e) => e);
    expect(error).toBeInstanceOf(VisionError);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain("sk-test-key");
  });

  it("fails with 502 when the model refuses or returns no text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }),
    });
    await expect(scanFrame(IMAGE)).rejects.toMatchObject({ status: 502 });
  });

  it("returns an empty list, not an error, when the model finds nothing", async () => {
    fetchMock.mockResolvedValue(apiReply(JSON.stringify({ findings: [] })));
    expect(await scanFrame(IMAGE)).toEqual([]);
  });
});
