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
  const listed = areas.filter((a, i) => i === 0 || a.pctOfRisk >= 5);
  const first = notes?.find((n) => n.area === areas[0].id);
  const rest = 100 - listed.reduce((sum, a) => sum + a.pctOfRisk, 0);
  return (
    <>
    {first && <p className="font-semibold">Do first: {first.action}</p>}
    <ul aria-label="Findings" className="max-h-48 space-y-2 overflow-y-auto">
      {listed.map((a) => {
        const note = notes?.find((n) => n.area === a.id);
        return (
          <li key={a.id} className="flex items-start gap-3 text-[15px] leading-snug">
            <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TONE.risk.dot}`} />
            <div>
              <span className="sr-only">{TONE.risk.word}: </span>
              <p className="font-medium">{note?.label ?? "Dry fuel"}</p>
              <p className="text-sm text-ink-2">{a.where} · {a.pctOfRisk}% of the dry fuel</p>
              {note ? (
                a.id !== areas[0].id && <p>{note.action}</p>
              ) : notes === null ? (
                <span className="scan-shimmer">Writing the findings…</span>
              ) : null}
              {(note?.reason || !!a.reasons?.length) && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 text-xs text-ink-2">Why</summary>
                  {note?.reason && <p className="text-xs text-ink-2">{note.reason}</p>}
                  {!!a.reasons?.length && <p className="text-xs text-ink-2">{a.reasons.join(" · ")}</p>}
                </details>
              )}
            </div>
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
    </>
  );
}
