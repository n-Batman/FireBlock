import type { Block, Property } from "@/data/types";
import { levelOf, rankBlocks, scoreOf } from "./score";

/** Assumption shown in the UI: mowing hours per acre. */
export const HOURS_PER_ACRE = 1.2;

export interface PlanItem {
  order: number;
  block: Block;
  hours: number;
  cost: number;
}

export interface Plan {
  items: PlanItem[];
  totalHours: number;
  totalCost: number;
  /** False when no block is medium or high risk. */
  urgent: boolean;
}

/** Returns `previous` unless input is a finite number above zero. */
export function parseRate(input: string, previous: number): number {
  const trimmed = input.trim();
  const n = Number(trimmed);
  return trimmed !== "" && Number.isFinite(n) && n > 0 ? n : previous;
}

export function buildPlan(property: Property, rate: number): Plan {
  const items = rankBlocks(property.blocks).map((block, i) => {
    const hours = Math.round(block.acres * HOURS_PER_ACRE * 10) / 10;
    return { order: i + 1, block, hours, cost: Math.round(hours * rate) };
  });
  return {
    items,
    totalHours: Math.round(items.reduce((s, i) => s + i.hours, 0) * 10) / 10,
    totalCost: items.reduce((s, i) => s + i.cost, 0),
    urgent: items.some((i) => levelOf(scoreOf(i.block)) !== "low"),
  };
}
