"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { mapBoxToRect, type Track } from "@/lib/scan";
import { layoutLabels, PILL_H, toneOf, type Safe, type Tone } from "@/lib/scanView";

interface ScanOverlayProps {
  videoSize: { w: number; h: number } | null;
  /** The tracks to draw, already limited to what is on screen (see shownTracks). */
  tracks: Track[];
  running: boolean;
  frozen?: boolean;
}

/** Label pills stay inside this: clear of the top buttons and the result card at the bottom. */
const SAFE: Safe = { top: 72, right: 12, bottom: 248, left: 12 };

// Risk and clear get the same weight: saturated line, same 22% fill, solid pill. Watch (shaky risk) stays amber.
const TONE: Record<Tone, { line: string; fill: string; pill: string }> = {
  risk: { line: "border-[#ff1f1f]", fill: "bg-[#ff1f1f]/20", pill: "bg-[#e11414] text-white" },
  watch: { line: "border-med", fill: "bg-med/20", pill: "bg-med-bg text-med-ink" },
  clear: { line: "border-[#00e05a]", fill: "bg-[#00e05a]/20", pill: "bg-[#0a8f3c] text-white" },
};

const CORNERS = [
  "left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-[3px]",
  "right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-[3px]",
  "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-[3px]",
  "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-[3px]",
];

const glide = "transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none";

/** Dimmed edges, a sweep line, corner brackets around each finding and a name pill for each. */
export function ScanOverlay({ videoSize, tracks, running, frozen = false }: ScanOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rects = videoSize && box ? tracks.map((t) => ({ t, rect: mapBoxToRect(t.bbox, videoSize, box) })) : [];
  const pills = box ? layoutLabels(rects.map(({ t, rect }) => ({ key: t.id, rect, label: t.label })), box, SAFE) : null;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/0.45)_100%)]" />

      {running && !frozen && !reduce && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-ink to-transparent opacity-70"
          initial={{ y: 0 }}
          animate={{ y: box?.h ?? 0 }}
          transition={{ duration: 1.5, ease: "linear", repeat: Infinity }}
        />
      )}

      {rects.map(({ t, rect }) => {
        const tone = TONE[toneOf(t)];
        const arm = Math.max(8, Math.min(18, rect.width / 3, rect.height / 3));
        return (
          <div
            key={t.id}
            className={`absolute left-0 top-0 ${glide}`}
            style={{ width: rect.width, height: rect.height, transform: `translate(${rect.x}px, ${rect.y}px)` }}
          >
            <div data-testid="fill" className={`absolute inset-0 rounded-[3px] ${tone.fill}`} />
            {CORNERS.map((corner) => (
              <span
                key={corner}
                data-testid="bracket"
                className={`absolute ${corner} ${tone.line}`}
                style={{ width: arm, height: arm }}
              />
            ))}
          </div>
        );
      })}

      {pills &&
        rects.map(({ t }) => {
          const p = pills.get(t.id)!;
          const tone = toneOf(t);
          return (
            <div
              key={t.id}
              data-pill
              data-tone={tone}
              className={`absolute left-0 top-0 ${glide}`}
              style={{ width: p.w, height: PILL_H, transform: `translate(${p.x}px, ${p.y}px)` }}
            >
              <p
                className={`truncate rounded-full px-2.5 text-xs font-semibold leading-6 shadow-[0_1px_4px_rgb(0_0_0/0.4)] ${TONE[tone].pill}`}
              >
                {t.label}
              </p>
            </div>
          );
        })}
    </div>
  );
}
