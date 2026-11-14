import type { Block, FactorKey, Property } from "@/data/types";
import { levelOf, rankBlocks, scoreOf } from "./score";

/** Assumption shown in the UI: mowing hours per acre. */
export const HOURS_PER_ACRE = 1.2;

/** Default crew rate in dollars per hour, shared by /plan and the rail's savings line. */
export const DEFAULT_RATE = 90;

export interface PlanItem {
  order: number;
  block: Block;
  hours: number;
  cost: number;
  /** One to three concrete things to do on this block, from its biggest factors. */
  actions: string[];
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

// What each factor calls for. Mowing, not tilling, because the growers here are no-till.
const ACTIONS: Record<FactorKey, string> = {
  fuelDryness: "Mow the dry growth between the rows before June 1. The county fines anything over 4 ft.",
  slope: "Mow the upslope edge first. Fire runs uphill fastest.",
  fireWeather: "Mow early in the morning and skip Red Flag days. A hot mower can start a fire.",
  hazardZone: "Re-trench the 50 ft firebreak along the property line.",
  fireHistory: "Keep the road side mowed so fire crews can reach the block.",
  photoScan: "Fix what the scan flagged: dry growth and brush near the buildings.",
};
/** A factor only earns an action once it is at least this share of its maximum. */
const SHARE_MIN = 0.4;

/**
 * One to three concrete actions for a block, taken from the factors that make up the largest
 * share of their maximum. Low-risk blocks need no mowing. Habitat is never mowed.
 */
export function actionsFor(block: Block): string[] {
  if (block.kind !== "vine") return [];
  if (levelOf(scoreOf(block)) === "low") {
    return ["No urgent mowing. Keep the cover crop green and check again after the next rain."];
  }
  const actions = block.factors
    .map((f, i) => ({ f, i, share: f.max > 0 ? f.points / f.max : 0 }))
    .filter(({ f, share }) => f.points > 0 && share >= SHARE_MIN)
    .sort((a, b) => b.share - a.share || b.f.points - a.f.points || a.i - b.i)
    .slice(0, 3)
    .map(({ f }) => ACTIONS[f.key]);
  return actions.length > 0 ? actions : ["Mow the rows before June 1 as part of your regular schedule."];
}

export function buildPlan(property: Property, rate: number): Plan {
  const items = rankBlocks(property.blocks).map((block, i) => {
    const hours = Math.round(block.acres * HOURS_PER_ACRE * 10) / 10;
    return { order: i + 1, block, hours, cost: Math.round(hours * rate), actions: actionsFor(block) };
  });
  return {
    items,
    totalHours: Math.round(items.reduce((s, i) => s + i.hours, 0) * 10) / 10,
    totalCost: items.reduce((s, i) => s + i.cost, 0),
    urgent: items.some((i) => levelOf(scoreOf(i.block)) !== "low"),
  };
}

export interface MowTotal {
  blocks: number;
  hours: number;
  cost: number;
}

export interface Savings {
  /** Every vine block. Same numbers as /plan. */
  all: MowTotal;
  /** Only the blocks scored High. */
  high: MowTotal;
  saved: { hours: number; cost: number };
  /** Habitat is never mowable, so it is in neither total. */
  habitatAcres: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** What mowing only the High blocks saves over mowing every vine block, at `rate` dollars an hour. */
export function savingsFor(property: Property, rate: number): Savings {
  const { items, totalHours, totalCost } = buildPlan(property, rate);
  const high = items.filter((i) => levelOf(scoreOf(i.block)) === "high");
  const highHours = round1(high.reduce((s, i) => s + i.hours, 0));
  const highCost = high.reduce((s, i) => s + i.cost, 0);
  return {
    all: { blocks: items.length, hours: totalHours, cost: totalCost },
    high: { blocks: high.length, hours: highHours, cost: highCost },
    saved: { hours: round1(totalHours - highHours), cost: totalCost - highCost },
    habitatAcres: property.blocks.filter((b) => b.kind === "habitat").reduce((s, b) => s + b.acres, 0),
  };
}
