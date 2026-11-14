import { describe, it, expect } from "vitest";
import { parseAreas, parseScanRequest } from "./scanApi";

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("parseScanRequest", () => {
  it("accepts a JPEG data URL", () => {
    expect(parseScanRequest({ image: jpeg })).toEqual({ ok: true, image: jpeg, demoTime: undefined });
  });

  it("accepts a demo time of zero or more seconds", () => {
    expect(parseScanRequest({ image: jpeg, demoTime: 0 })).toMatchObject({ ok: true, demoTime: 0 });
    expect(parseScanRequest({ image: jpeg, demoTime: 12.5 })).toMatchObject({ ok: true, demoTime: 12.5 });
  });

  it("rejects a bad demo time", () => {
    for (const demoTime of [-1, NaN, Infinity, "3"]) {
      expect(parseScanRequest({ image: jpeg, demoTime })).toMatchObject({ ok: false });
    }
  });

  it("rejects anything that is not an object with a JPEG data URL", () => {
    for (const body of [null, undefined, "x", 5, [], {}, { image: 5 }, { image: "http://x.test/a.jpg" }, { image: "data:image/png;base64,AAAA" }]) {
      expect(parseScanRequest(body)).toMatchObject({ ok: false });
    }
  });

  it("rejects an image that is too large", () => {
    const big = "data:image/jpeg;base64," + "A".repeat(5_000_000);
    expect(parseScanRequest({ image: big })).toMatchObject({ ok: false });
  });

  it("gives a reason with every rejection", () => {
    const r = parseScanRequest({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
  });
});

describe("parseAreas", () => {
  const area = { id: 1, box: [0.1, 0.2, 0.5, 0.9], pctOfRisk: 60, pctOfFrame: 12.5, where: "bottom left" };
  it("accepts measured areas and rejects out-of-range boxes, too many areas or long text", () => {
    expect(parseAreas([area])).toEqual([area]);
    expect(parseAreas([{ ...area, box: [0, 0, 2, 1] }])).toBeNull();
    expect(parseAreas(Array(7).fill(area))).toBeNull();
    expect(parseAreas([{ ...area, where: "x".repeat(41) }])).toBeNull();
    expect(parseAreas("nope")).toBeNull();
  });
});
