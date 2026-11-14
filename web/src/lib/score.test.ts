import { describe, it, expect } from "vitest";
import { scoreOf, levelOf, rankBlocks } from "./score";
import type { Block, Factor } from "@/data/types";

const factor = (points: number): Factor => ({
  key: "fireWeather",
  label: "Fire weather",
  points,
  max: 35,
  reason: "sample reason",
  source: "sample source",
  asOf: "2026-11-13T07:00:00-08:00",
});

const block = (id: string, kind: Block["kind"], pts: number[]): Block => ({
  id,
  name: id,
  kind,
  acres: 5,
  polygon: [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  factors: pts.map(factor),
  summary: "",
  reason: "",
});

describe("levelOf", () => {
  it("puts 34 in low, 35 in medium, 64 in medium, 65 in high", () => {
    expect(levelOf(34)).toBe("low");
    expect(levelOf(35)).toBe("medium");
    expect(levelOf(64)).toBe("medium");
    expect(levelOf(65)).toBe("high");
  });
});

describe("scoreOf", () => {
  it("sums factor points and rounds", () => {
    expect(scoreOf(block("a", "vine", [12.4, 10.3]))).toBe(23);
    expect(scoreOf(block("b", "vine", [27, 19, 11, 12, 9]))).toBe(78);
  });
});

describe("rankBlocks", () => {
  it("orders vine blocks highest score first and omits habitat", () => {
    const ranked = rankBlocks([
      block("low", "vine", [10]),
      block("habitat", "habitat", []),
      block("high", "vine", [80]),
      block("mid", "vine", [50]),
    ]);
    expect(ranked.map((b) => b.id)).toEqual(["high", "mid", "low"]);
  });
});
