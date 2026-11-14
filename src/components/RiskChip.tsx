import type { Level } from "@/data/types";
import { scaleColor } from "@/lib/riskScale";

const STYLES: Record<Level, string> = {
  low: "bg-low-bg text-low-ink",
  medium: "bg-med-bg text-med-ink",
  high: "bg-high-bg text-high-ink",
};
const LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };

/**
 * The Low, Medium, High chip. With `scaleScore` it is coloured on Nick's 0 to 100 scale instead (the
 * colour of his parcel fill for that score), as county parcels are. The word is still the level.
 */
export function RiskChip({ level, score, scaleScore }: { level: Level; score?: number; scaleScore?: number }) {
  const scaled =
    scaleScore === undefined
      ? undefined
      : { color: scaleColor(scaleScore), backgroundColor: scaleColor(scaleScore, 0.18) };
  return (
    <span
      style={scaled}
      className={`inline-flex items-center gap-2 rounded-[var(--r)] px-2 py-1 text-xs font-semibold ${scaled ? "" : STYLES[level]}`}
    >
      {LABEL[level]}
      {score !== undefined && <span className="num text-sm">{score}</span>}
    </span>
  );
}
