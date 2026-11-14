import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskAreaInput } from "@/data/types";
import { parseNotes, writeFindings } from "./vision";

const IMAGE = "data:image/jpeg;base64,AAAA";
const AREAS: RiskAreaInput[] = [
  { id: 1, box: [0.5, 0.6, 1, 1], pctOfRisk: 70, pctOfFrame: 20, where: "bottom right" },
  { id: 2, box: [0, 0.7, 0.3, 1], pctOfRisk: 30, pctOfFrame: 8, where: "bottom left" },
];
const note = (area: number) => ({ area, label: "Cured grass", reason: "Tan stems.", action: "Mow it." });
const apiReply = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(body) }] }] }),
});

describe("parseNotes", () => {
  it("keeps one note per given area, in the areas' order, and drops invented areas", () => {
    const out = parseNotes(JSON.stringify({ notes: [note(2), note(9), note(1), note(1)] }), AREAS);
    expect(out.map((n) => n.area)).toEqual([1, 2]);
  });

  it("returns nothing for text that is not the schema", () => {
    expect(parseNotes("nope", AREAS)).toEqual([]);
    expect(parseNotes(JSON.stringify({ notes: [{ area: 1, label: "" }] }), AREAS)).toEqual([]);
  });
});

describe("writeFindings", () => {
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

  it("sends the image plus the measured areas and share, and asks for words only", async () => {
    fetchMock.mockResolvedValue(apiReply({ notes: [note(1)] }));
    expect(await writeFindings(IMAGE, AREAS, 0.42)).toEqual([note(1)]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-6.1-terra");
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "area_notes", strict: true });
    const facts = JSON.parse(body.input[0].content[0].text);
    expect(facts.dryShareOfVegetation).toBe("42%");
    expect(facts.areas.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(body.instructions).toContain("Only describe the areas you were given");
  });

  it("makes no call when there are no risk areas", async () => {
    expect(await writeFindings(IMAGE, [], 0)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never passes the upstream error body on", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "bad key sk-test-key" }) });
    const error = (await writeFindings(IMAGE, AREAS, 0.5).catch((e: unknown) => e)) as Error & { status: number };
    expect(error.message).not.toContain("sk-test-key");
    expect(error.status).toBe(502);
  });
});
