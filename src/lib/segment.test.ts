import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSegments, PROMPTS, segmentFrame } from "./segment";

const IMAGE = "data:image/jpeg;base64,QUJD";

describe("parseSegments", () => {
  it("flattens every polygon of every prompt and drops broken points and slivers", () => {
    const reply = {
      prompt_results: [
        { prompt_index: 0, echo: {}, predictions: [{ confidence: 0.9, masks: [[[0, 0], [10, 0], [10, 10]], [[1, 1], [2, 2]]] }] },
        { prompt_index: 1, echo: {}, predictions: [{ confidence: 0.5, masks: [[[0, 0], ["x", 1], [5, 5], [0, 5]]] }] },
      ],
    };
    expect(parseSegments(reply)).toEqual([
      [[0, 0], [10, 0], [10, 10]],
      [[0, 0], [5, 5], [0, 5]],
    ]);
  });

  it("is an error when the reply has no results", () => {
    expect(() => parseSegments({ message: "nope" })).toThrow();
  });
});

describe("segmentFrame", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ROBOFLOW_API_KEY", "rf-secret");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts the raw base64 with every vegetation prompt as polygons, key in a Bearer header", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ prompt_results: [] }) });
    await segmentFrame(IMAGE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://serverless.roboflow.com/sam3/concept_segment");
    expect(init.headers.authorization).toBe("Bearer rf-secret");
    const body = JSON.parse(init.body);
    expect(body.image).toEqual({ type: "base64", value: "QUJD" });
    expect(body.prompts.map((p: { text: string }) => p.text)).toEqual(PROMPTS);
    expect(body).toMatchObject({ format: "polygon", output_prob_thresh: 0.4 });
  });

  it("answers 503 without a key and 502 on an upstream error, never echoing the body", async () => {
    vi.stubEnv("ROBOFLOW_API_KEY", "");
    await expect(segmentFrame(IMAGE)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("ROBOFLOW_API_KEY", "rf-secret");
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "rf-secret is bad" }) });
    const error = (await segmentFrame(IMAGE).catch((e: unknown) => e)) as Error & { status: number };
    expect(error.status).toBe(502);
    expect(error.message).not.toContain("rf-secret");
  });

  it("tries a 5xx again, up to twice, but not a 4xx", async () => {
    const fail = { ok: false, status: 500, json: async () => ({}) };
    fetchMock.mockResolvedValueOnce(fail).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ prompt_results: [] }) });
    expect(await segmentFrame(IMAGE)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(fail);
    await expect(segmentFrame(IMAGE)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(segmentFrame(IMAGE)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
