import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";

export const DATA = "eval/data";
export const CACHE = "eval/cache";
// EVAL_SET=v2: hand-labelled ground-fuel set (eval/manifest.v2.json + eval/labels.v2.json, labelSource "human-ground").
export const V2 = process.env.EVAL_SET === "v2";
export const MANIFEST = V2 ? "eval/manifest.v2.json" : "eval/manifest.json";
export const LABELS_V2 = "eval/labels.v2.json";
export const REPORT = V2 ? "eval/report.v2.md" : "eval/report.md";
export const UA = "FireBlockScannerEval/0.1 (wildfire fuel research; contact via GitHub repo)";

/** What the eval knows about one image. `expected` is filled by label.ts (GPT) or, for VegAnn, by the mask. */
export interface Item {
  id: string;
  file: string; // under eval/data
  url: string;
  license: string;
  author: string;
  category: string; // bucket
  source: "commons" | "vegann" | "own";
  mask?: string; // VegAnn ground truth: veg=white, background=black
  expected?: { relevant: boolean; dry_pct_estimate: number; notes: string };
  thumb?: string; // v2: image URL fetch.ts downloads
  dirt?: boolean; // v2: bare soil dominates and almost no vegetation, so scored with the dirt rule
}

/** One hand label: dry_pct/green_pct are shares of visible GROUND vegetation only (no vine/tree canopy). */
export interface HumanLabel {
  id: string;
  labelSource: "human-ground";
  dry_pct: number;
  green_pct: number;
  bare_soil: "none" | "some" | "lots";
  flags: string[]; // canopy-dominant | distant | low-light | autumn | fog | snow
  confidence: "high" | "medium";
  notes: string;
}

/** Copies hand labels onto manifest items in the shape run.ts scores. Items without a label are left unlabelled. */
export function withHumanLabels(items: Item[], labels: HumanLabel[]): Item[] {
  const by = new Map(labels.map((l) => [l.id, l]));
  return items.map((it) => {
    const l = by.get(it.id);
    if (!l) return it;
    const notes = [l.notes, ...l.flags, `${l.confidence} confidence`].join("; ");
    return { ...it, expected: { relevant: true, dry_pct_estimate: l.dry_pct, notes }, dirt: l.bare_soil === "lots" && l.dry_pct <= 10 };
  });
}

/** Dirt buckets: "bare soil field" / "dirt road", with or without the v2 "v2 " prefix. */
export const isDirtBucket = (category: string) => /^(v2 )?(bare soil|dirt road)/.test(category);

export const sha = (s: string | Buffer) => createHash("sha1").update(s).digest("hex").slice(0, 16);
/** Fixed 70/30 split by id: true for the 30% thresholds are never fitted on. */
export const heldOut = (id: string) => parseInt(sha(id).slice(0, 4), 16) % 10 >= 7;
export const mk = (d: string) => mkdirSync(d, { recursive: true });

/** Runs `fn` over `items` with `n` workers. */
export async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
