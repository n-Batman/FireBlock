import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OBJECT_PROMPTS, parseAll, parseSegments, PROMPTS, segmentFrame } from "./segment";

const IMAGE = "data:image/jpeg;base64,QUJD";

describe("parseSegments", () => {
  const dry = PROMPTS.indexOf("dry grass");
  const sky = PROMPTS.indexOf("sky");
  it("keeps each mask's group, drops broken points and slivers, and filters by group confidence", () => {
    const reply = {
      prompt_results: [
        { prompt_index: dry, echo: {}, predictions: [{ confidence: 0.35, masks: [[[0, 0], [10, 0], [10, 10]], [[1, 1], [2, 2]]] }] },
        { prompt_index: sky, echo: {}, predictions: [{ confidence: 0.25, masks: [[[0, 0], [5, 5], [0, 5]]] }, { confidence: 0.3, masks: [[[0, 0], [4, 4], [0, 4]]] }, { confidence: 0.5, masks: [[[0, 0], ["x", 1], [5, 5], [0, 5]]] }] },
      ],
    };
    // dry and exclude are kept from 0.3 (the 0.25 sky is dropped); the 0.5 sky loses its bad point.
    expect(parseSegments(reply)).toEqual([
      { group: "dry", polys: [[[0, 0], [10, 0], [10, 10]]] },
      { group: "exclude", polys: [[[0, 0], [4, 4], [0, 4]]] },
      { group: "exclude", polys: [[[0, 0], [5, 5], [0, 5]]] },
    ]);
  });

  it("is an error when the reply has no results", () => {
    expect(() => parseSegments({ message: "nope" })).toThrow();
  });

  it("reads the object reply by its own prompts: road, dog and the rest are hard excludes, plowed soil is soft", () => {
    const tri = [[[0, 0], [10, 0], [10, 10]]];
    const reply = {
      prompt_results: [
        { prompt_index: OBJECT_PROMPTS.indexOf("dog"), echo: {}, predictions: [{ confidence: 0.5, masks: tri }] },
        { prompt_index: OBJECT_PROMPTS.indexOf("plowed soil"), echo: {}, predictions: [{ confidence: 0.5, masks: tri }] },
        { prompt_index: OBJECT_PROMPTS.indexOf("person"), echo: {}, predictions: [{ confidence: 0.1, masks: tri }] },
      ],
    };
    expect(parseSegments(reply, OBJECT_PROMPTS)).toEqual([
      { group: "exclude", polys: tri, hard: true },
      { group: "exclude", polys: tri },
    ]);
  });

  it("parseAll adds the object masks, and a missing or broken object reply leaves the first call's masks as they were", () => {
    const tri = [[[0, 0], [10, 0], [10, 10]]];
    const main = { prompt_results: [{ prompt_index: dry, echo: {}, predictions: [{ confidence: 0.5, masks: tri }] }] };
    const objects = { prompt_results: [{ prompt_index: OBJECT_PROMPTS.indexOf("dirt road"), echo: {}, predictions: [{ confidence: 0.5, masks: tri }] }] };
    expect(parseAll(main, objects)).toHaveLength(2);
    expect(parseAll(main, null)).toEqual([{ group: "dry", polys: tri }]);
    expect(parseAll(main, { message: "nope" })).toEqual([{ group: "dry", polys: tri }]);
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

  const ok = (reply: unknown = { prompt_results: [] }) => ({ ok: true, status: 200, json: async () => reply });
  const promptsOf = (init: { body: string }) => (JSON.parse(init.body).prompts as { text: string }[]).map((p) => p.text);
  /** Answers the main call from `main` and the object call from `objects`, told apart by the prompts sent. */
  const route = (main: () => unknown, objects: () => unknown = () => ok()) =>
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => (promptsOf(init)[0] === OBJECT_PROMPTS[0] ? objects() : main()));

  it("posts the raw base64 with every vegetation prompt as polygons, key in a Bearer header, and the object prompts in a second call", async () => {
    route(() => ok());
    await segmentFrame(IMAGE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [[url, init], [, objInit]] = fetchMock.mock.calls.sort(([, a], [, b]) => Number(promptsOf(a)[0] === OBJECT_PROMPTS[0]) - Number(promptsOf(b)[0] === OBJECT_PROMPTS[0]));
    expect(url).toBe("https://serverless.roboflow.com/sam3/concept_segment");
    expect(init.headers.authorization).toBe("Bearer rf-secret");
    expect(objInit.headers.authorization).toBe("Bearer rf-secret");
    const body = JSON.parse(init.body);
    expect(body.image).toEqual({ type: "base64", value: "QUJD" });
    expect(promptsOf(init)).toEqual(PROMPTS);
    expect(promptsOf(objInit)).toEqual(OBJECT_PROMPTS);
    expect(body).toMatchObject({ format: "polygon", output_prob_thresh: 0.3 });
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
    let calls = 0;
    route(() => (calls++ === 0 ? fail : ok()));
    expect(await segmentFrame(IMAGE)).toEqual([]);
    expect(calls).toBe(2);
    fetchMock.mockReset();
    calls = 0;
    route(() => (calls++, fail));
    await expect(segmentFrame(IMAGE)).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(3);
    fetchMock.mockReset();
    calls = 0;
    route(() => (calls++, { ok: false, status: 401, json: async () => ({}) }));
    await expect(segmentFrame(IMAGE)).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(1);
  });

  it("adds the object masks, and scans with the first call's masks alone when the object call fails", async () => {
    const tri = [[[0, 0], [10, 0], [10, 10]]];
    const main = ok({ prompt_results: [{ prompt_index: 0, echo: {}, predictions: [{ confidence: 0.5, masks: tri }] }] });
    route(() => main, () => ok({ prompt_results: [{ prompt_index: OBJECT_PROMPTS.indexOf("vehicle"), echo: {}, predictions: [{ confidence: 0.5, masks: tri }] }] }));
    expect(await segmentFrame(IMAGE)).toEqual([{ group: "dry", polys: tri }, { group: "exclude", polys: tri, hard: true }]);
    for (const failure of [{ ok: false, status: 500, json: async () => ({}) }, new Error("down")]) {
      fetchMock.mockReset();
      route(() => main, () => { if (failure instanceof Error) throw failure; return failure; });
      expect(await segmentFrame(IMAGE)).toEqual([{ group: "dry", polys: tri }]);
    }
  });
});
