import type { Block, Level } from "@/data/types";

export function scoreOf(block: Block): number {
  return Math.round(block.factors.reduce((sum, f) => sum + f.points, 0));
}

export function levelOf(score: number): Level {
  if (score < 35) return "low";
  if (score < 65) return "medium";
  return "high";
}

/** Vine blocks only, highest score first. Habitat is never ranked. */
export function rankBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.kind === "vine").sort((a, b) => scoreOf(b) - scoreOf(a));
}
