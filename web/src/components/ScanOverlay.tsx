"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { isVisible, mapBoxToRect, type Track } from "@/lib/scan";

interface ScanOverlayProps {
  videoSize: { w: number; h: number } | null;
  tracks: Track[];
  running: boolean;
}

const corner = "absolute size-7 border-ink";

/** Dimmed edges, corner-bracket reticle, sweep line and the detection boxes. */
export function ScanOverlay({ videoSize, tracks, running }: ScanOverlayProps) {
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

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/0.45)_100%)]" />

      <div className="absolute inset-[12%]" aria-hidden="true">
        <span className={`${corner} left-0 top-0 border-l-2 border-t-2`} />
        <span className={`${corner} right-0 top-0 border-r-2 border-t-2`} />
        <span className={`${corner} bottom-0 left-0 border-b-2 border-l-2`} />
        <span className={`${corner} bottom-0 right-0 border-b-2 border-r-2`} />
      </div>

      {running && !reduce && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-ink to-transparent opacity-70"
          initial={{ y: 0 }}
          animate={{ y: box?.h ?? 0 }}
          transition={{ duration: 1.5, ease: "linear", repeat: Infinity }}
        />
      )}

      {videoSize &&
        box &&
        tracks.map((t) => {
          const r = mapBoxToRect(t.bbox, videoSize, box);
          const risk = t.severity === "risk";
          const labelAbove = r.y + r.height > box.h - 64;
          return (
            <div
              key={t.id}
              className="absolute left-0 top-0 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
              style={{
                width: r.width,
                height: r.height,
                transform: `translate(${r.x}px, ${r.y}px)`,
                opacity: isVisible(t) ? 1 : 0,
              }}
            >
              <div
                className={`absolute inset-0 rounded-[var(--r)] border-2 ${
                  risk ? "border-high bg-high/12" : "border-low bg-low/12"
                }`}
              />
              <div
                className={`absolute left-0 w-max max-w-[70vw] ${
                  labelAbove ? "bottom-full mb-1" : "top-full mt-1"
                }`}
              >
                <p
                  className={`inline-block rounded-[var(--r)] px-2 py-1 text-xs font-semibold ${
                    risk ? "bg-high-bg text-high-ink" : "bg-low-bg text-low-ink"
                  }`}
                >
                  {t.label}
                </p>
                <p className="mt-0.5 text-xs font-medium text-ink [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
                  {t.action}
                </p>
              </div>
            </div>
          );
        })}
    </div>
  );
}
