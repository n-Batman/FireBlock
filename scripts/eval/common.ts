import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";

export const DATA = "eval/data";
export const CACHE = "eval/cache";
export const MANIFEST = "eval/manifest.json";
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
}

export const sha = (s: string | Buffer) => createHash("sha1").update(s).digest("hex").slice(0, 16);
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
