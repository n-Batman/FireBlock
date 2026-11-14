import type { Level } from "@/data/types";

const STYLES: Record<Level, string> = {
  low: "bg-low-bg text-low-ink",
  medium: "bg-med-bg text-med-ink",
  high: "bg-high-bg text-high-ink",
};
const LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };

export function RiskChip({ level, score }: { level: Level; score: number }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-[var(--r)] px-2 py-1 text-xs font-semibold ${STYLES[level]}`}
    >
      {LABEL[level]}
      <span className="num text-sm">{score}</span>
    </span>
  );
}
