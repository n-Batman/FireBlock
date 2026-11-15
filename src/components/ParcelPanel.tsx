"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, X } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { ParcelUnit } from "@/data/types";
import { acresLabel, BEFORE_AFTER_RESET, BEFORE_AFTER_TITLE, NOT_SCORED, PLANNING_ONLY, sourceLabel } from "@/content/parcelCopy";
import { formatAsOf } from "@/lib/format";
import { loadParcelReset, saveParcelReset } from "@/lib/parcelScanStore";
import { beforeAfter } from "@/lib/parcelScore";
import { useParcelScans } from "@/lib/useParcelScans";
import { useWide } from "@/lib/useWide";
import { RiskChip } from "./RiskChip";

const EASE = [0.16, 1, 0.3, 1] as const;

/** The detail panel for a selected county parcel. Scored only when a scan or the risk map says so. */
export function ParcelPanel({ parcel, onClose }: { parcel: ParcelUnit; onClose: () => void }) {
  const wide = useWide();
  const slide = wide ? { x: 24 } : { y: 24 };
  const { score } = parcel;
  const scans = useParcelScans();
  const [resetAt, setResetAt] = useState<string | null>(() => {
    try {
      return loadParcelReset(window.localStorage, parcel.id);
    } catch {
      return null;
    }
  });
  const change = beforeAfter(parcel, scans, resetAt);
  const restart = () => {
    const at = new Date().toISOString();
    try {
      saveParcelReset(window.localStorage, parcel.id, at);
    } catch {
      /* the marker could not be saved; the row stays */
      return;
    }
    setResetAt(at);
  };

  return (
    <motion.section
      aria-label={`Parcel ${parcel.id}`}
      initial={{ opacity: 0, ...slide }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, ...slide }}
      transition={{ duration: 0.22, ease: EASE }}
      className="glass no-print pointer-events-auto flex max-h-[55dvh] w-full flex-col overflow-y-auto lg:max-h-full lg:w-[400px] lg:self-start"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Parcel {parcel.id}</h2>
          <p className="mt-1 text-[15px] text-ink-2">{acresLabel(parcel.acres)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-[var(--r)] text-ink-2 transition-colors hover:text-ink"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-5 pb-4 pt-4">
        {score ? (
          <>
            <div className="flex items-center gap-3">
              <p className="text-5xl font-semibold leading-none tracking-tight">
                <span data-testid="score" className="num">
                  {score.score}
                </span>
                <span aria-hidden="true" className="num ml-1 text-base font-medium text-ink-2">
                  / 100
                </span>
              </p>
              <RiskChip level={score.level} scaleScore={score.score} />
            </div>
            <p className="mt-3 text-[15px] leading-snug">{sourceLabel(score.source)}</p>
            <p className="mt-1 text-xs text-ink-2">
              {score.source.kind === "scan" ? (
                <>
                  Saved <time dateTime={score.source.at}>{formatAsOf(score.source.at)}</time>
                </>
              ) : (
                <>Model {score.source.modelId || "unknown"}, as of {score.source.asOf ? formatAsOf(score.source.asOf) : "an unknown date"}</>
              )}
            </p>
          </>
        ) : (
          <p className="text-[15px] leading-relaxed">{NOT_SCORED}</p>
        )}
        {change && (
          <div data-testid="before-after" className="mt-4 border-t border-[var(--glass-border)] pt-4">
            <p className="text-xs font-medium text-ink-2">{BEFORE_AFTER_TITLE}</p>
            <p className="mt-1 text-[15px]">
              Before <span className="num font-semibold">{change.before.score}</span>
              <span className="text-ink-2"> ({formatAsOf(change.before.at)})</span>
            </p>
            <p className="text-[15px]">
              After <span className="num font-semibold">{change.after.score}</span>
              <span className="text-ink-2"> ({formatAsOf(change.after.at)})</span>
            </p>
            <button type="button" onClick={restart} className="mt-2 h-11 text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
              {BEFORE_AFTER_RESET}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-[var(--glass-border)] px-5 py-5">
        <Link
          href={`/scan?parcel=${encodeURIComponent(parcel.id)}${score?.source.kind === "scan" ? "&rescan=1" : ""}`}
          className="inline-flex h-11 items-center gap-2 rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98]"
        >
          <Camera size={18} aria-hidden="true" />
          {score?.source.kind === "scan" ? "Scan again" : "Scan the rows"}
        </Link>
        <p className="text-xs text-ink-2">{PLANNING_ONLY}</p>
      </div>
    </motion.section>
  );
}
