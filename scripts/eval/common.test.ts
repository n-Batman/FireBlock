import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withHumanLabels, type HumanLabel, type Item } from "./common";

const item = (id: string): Item => ({ id, file: `v2/${id}.jpg`, url: "u", license: "CC0", author: "a", category: "v2 bare soil", source: "commons" });
const label = (id: string, dry_pct: number, bare_soil: HumanLabel["bare_soil"]): HumanLabel => ({ id, labelSource: "human-ground", dry_pct, green_pct: 100 - dry_pct, bare_soil, flags: ["distant"], confidence: "high", notes: "n" });

describe("withHumanLabels", () => {
  it("turns a hand label into the scored expectation and marks soil-only frames as dirt", () => {
    const [soil, grass, none] = withHumanLabels([item("a"), item("b"), item("c")], [label("a", 0, "lots"), label("b", 80, "lots")]);
    expect(soil.expected).toEqual({ relevant: true, dry_pct_estimate: 0, notes: "n; distant; high confidence" });
    expect(soil.dirt).toBe(true);
    expect(grass.dirt).toBe(false);
    expect(none.expected).toBeUndefined();
  });

  it("committed v2 files line up: every label has a manifest item with a download URL", () => {
    const items: Item[] = JSON.parse(readFileSync("eval/manifest.v2.json", "utf8"));
    const labels: HumanLabel[] = JSON.parse(readFileSync("eval/labels.v2.json", "utf8"));
    const ids = new Set(items.map((i) => i.id));
    expect(labels.every((l) => ids.has(l.id) && l.labelSource === "human-ground" && l.dry_pct + l.green_pct === 100)).toBe(true);
    expect(items.every((i) => i.thumb?.startsWith("https://") && i.license && i.author)).toBe(true);
  });
});
