import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateDry, parseEstimate } from "./estimate";
import { VisionError } from "./vision";

const row = (c: string) => Array(8).fill(c);
const grid = Array.from({ length: 6 }, () => row("dry"));
const reply = (o: unknown) => ({ ok: true, status: 200, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify(o) }] }] }) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseEstimate", () => {
  it("parses a good reply", () => {
    expect(parseEstimate(JSON.stringify({ dry_pct: 40, veg_frac: 0.5, grid }))).toEqual({ dryPct: 40, vegFrac: 0.5, grid });
  });
  it("clamps out-of-range numbers", () => {
    const e = parseEstimate(JSON.stringify({ dry_pct: 180, veg_frac: -2, grid }));
    expect([e.dryPct, e.vegFrac]).toEqual([100, 0]);
  });
  it.each([
    ["not json", "nope"],
    ["missing dry_pct", JSON.stringify({ veg_frac: 0.5, grid })],
    ["string dry_pct", JSON.stringify({ dry_pct: "40", veg_frac: 0.5, grid })],
    ["short grid", JSON.stringify({ dry_pct: 1, veg_frac: 0.5, grid: grid.slice(1) })],
    ["short row", JSON.stringify({ dry_pct: 1, veg_frac: 0.5, grid: [row("dry").slice(1), ...grid.slice(1)] })],
    ["bad cell", JSON.stringify({ dry_pct: 1, veg_frac: 0.5, grid: [row("lava"), ...grid.slice(1)] })],
    ["null", "null"],
  ])("rejects %s", (_n, text) => {
    expect(() => parseEstimate(text)).toThrow(VisionError);
  });
});

describe("estimateDry", () => {
  it("needs a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(estimateDry("data:image/jpeg;base64,x")).rejects.toMatchObject({ status: 503 });
  });
  it("sends the capped, unstored request and returns the estimate", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const f = vi.fn().mockResolvedValue(reply({ dry_pct: 70, veg_frac: 0.8, grid }));
    vi.stubGlobal("fetch", f);
    expect((await estimateDry("data:image/jpeg;base64,x")).dryPct).toBe(70);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ store: false, max_output_tokens: 800, text: { format: { type: "json_schema" } } });
  });
  it("hides upstream error bodies", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "secret-key", json: async () => ({ error: "secret-key" }) }));
    const err = await estimateDry("x").catch((e) => e);
    expect(err).toBeInstanceOf(VisionError);
    expect(err.message).not.toContain("secret-key");
  });
  it("maps a timeout to 504", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    await expect(estimateDry("x")).rejects.toMatchObject({ status: 504 });
  });
});
