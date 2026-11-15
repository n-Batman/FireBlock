import type { AreaNote } from "@/data/types";
import type { RiskArea } from "@/lib/fuelMask";
import type { Track } from "@/lib/scan";
import { findingLine, toneOf, type Tone } from "@/lib/scanView";

// Colour is never the only signal: each line also says Risk, Watch or Clear to screen readers.
const TONE: Record<Tone, { word: string; dot: string }> = {
  risk: { word: "Risk", dot: "bg-high" },
  watch: { word: "Watch", dot: "bg-med" },
  clear: { word: "Clear", dot: "bg-low" },
};

/** The findings on screen, one plain line each, for the card at the bottom of the scanner. */
export function FindingsList({ tracks, empty }: { tracks: Track[]; empty: string }) {
  if (tracks.length === 0) return <p className="text-[15px] text-ink-2">{empty}</p>;
  return (
    <ul aria-label="Findings" className="space-y-2">
      {tracks.map((t) => {
        const tone = TONE[toneOf(t)];
        return (
          <li key={t.id} className="flex items-start gap-3 text-[15px] leading-snug">
            <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${tone.dot}`} />
            <span>
              <span className="sr-only">{tone.word}: </span>
              {findingLine(t)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The measured risk areas, biggest first, each with where it is and its share of the dry fuel. The model's
 * words (`notes`) fill in when they arrive; until then, or if they fail, the measured facts still show.
 */
export function AreaFindingsList({ areas, notes }: { areas: RiskArea[]; notes: AreaNote[] | null }) {
  if (areas.length === 0) return <p className="text-[15px] text-ink-2">No dry patches big enough to list.</p>;
  const rest = 100 - areas.reduce((sum, a) => sum + a.pctOfRisk, 0);
  return (
    <ul aria-label="Findings" className="max-h-48 space-y-2 overflow-y-auto">
      {areas.map((a) => {
        const note = notes?.find((n) => n.area === a.id);
        return (
          <li key={a.id} className="flex items-start gap-3 text-[15px] leading-snug">
            <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TONE.risk.dot}`} />
            <span>
              <span className="sr-only">{TONE.risk.word}: </span>
              <span className="font-medium">{note?.label ?? "Dry fuel"}</span>, {a.where} ({a.pctOfRisk}% of the dry fuel).{" "}
              {note ? (
                `${note.reason} ${note.action}`
              ) : notes === null ? (
                <span className="scan-shimmer">Writing the findings…</span>
              ) : null}
            </span>
          </li>
        );
      })}
      {rest >= 5 && (
        <li className="flex items-start gap-3 text-[15px] leading-snug">
          <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TONE.risk.dot}`} />
          <span>
            <span className="sr-only">{TONE.risk.word}: </span>
            Smaller patches: {rest}% of the dry fuel
          </span>
        </li>
      )}
    </ul>
  );
}
