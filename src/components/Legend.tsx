import { RISK_STOPS, scaleColor } from "@/lib/riskScale";

const TICKS = [0, 25, 50, 75, 100];
const GRADIENT = `linear-gradient(to right in srgb, ${RISK_STOPS.map(({ score }) => `${scaleColor(score)} ${score}%`).join(", ")})`;

export function Legend() {
  return (
    <ul className="glass pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs font-medium">
      <li className="space-y-1">
        <span>Risk score</span>
        <div className="mx-2 w-36">
          <div className="h-3 rounded-sm" style={{ backgroundImage: GRADIENT }} aria-hidden="true" />
          <div className="num relative mt-1 h-4">
            {TICKS.map((score) => (
              <span key={score} className="absolute -translate-x-1/2" style={{ left: `${score}%` }}>{score}</span>
            ))}
          </div>
        </div>
      </li>
      <li className="flex items-center gap-2">
        <span className="hatch size-3 rounded-sm border border-line" aria-hidden="true" />
        No-mow habitat
      </li>
    </ul>
  );
}
