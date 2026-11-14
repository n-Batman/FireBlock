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
