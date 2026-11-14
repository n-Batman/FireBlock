"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Camera, X } from "@phosphor-icons/react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { Block, Level } from "@/data/types";
import { formatAsOf } from "@/lib/format";
import { actionsFor } from "@/lib/plan";
import { levelOf, scoreOf } from "@/lib/score";
import { useWide } from "@/lib/useWide";
import { RiskChip } from "./RiskChip";

const EASE = [0.16, 1, 0.3, 1] as const;
const BAR: Record<Level, string> = { low: "bg-low", medium: "bg-med", high: "bg-high" };

interface BreakdownPanelProps {
  block: Block;
  propertyId: string;
  onClose: () => void;
}

export function BreakdownPanel({ block, propertyId, onClose }: BreakdownPanelProps) {
  const score = scoreOf(block);
  const level = levelOf(score);
  const scanFactor = block.factors.find((f) => f.key === "photoScan");
  const actions = actionsFor(block);
  const wide = useWide();
  const reduce = useReducedMotion();

  // The number counts up through a motion value, so React does not re-render per frame.
  const count = useMotionValue(reduce ? score : 0);
  const shown = useTransform(count, (v) => Math.round(v).toString());
  useEffect(() => {
    if (reduce) {
      count.set(score);
      return;
    }
    const controls = animate(count, score, { duration: 0.3, ease: EASE });
    return () => controls.stop();
  }, [count, score, reduce]);

  const slide = wide ? { x: 24 } : { y: 24 };

  return (
    <motion.section
      aria-label={`${block.name} score breakdown`}
      initial={{ opacity: 0, ...slide }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, ...slide }}
      transition={{ duration: 0.22, ease: EASE }}
      className="glass no-print pointer-events-auto flex max-h-[55dvh] w-full flex-col overflow-y-auto lg:max-h-full lg:w-[400px] lg:self-start"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <h2 className="text-lg font-semibold tracking-tight">{block.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-[var(--r)] text-ink-2 transition-colors hover:text-ink"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-5 pb-5 pt-2">
        <div className="flex items-center gap-3">
          <p className="text-5xl font-semibold leading-none tracking-tight">
            <span data-testid="score" className="sr-only">
              {score}
            </span>
            <motion.span aria-hidden="true" className="num">
              {shown}
            </motion.span>
            <span aria-hidden="true" className="num ml-1 text-base font-medium text-ink-2">
              / 100
            </span>
          </p>
          <RiskChip level={level} />
        </div>
        <p className="mt-3 text-[15px] leading-relaxed">{block.summary}</p>
      </div>

      <ul className="divide-y divide-[var(--glass-border)] border-y border-[var(--glass-border)]">
        {block.factors.map((f, i) => (
          <li key={f.key} data-testid="factor-row" className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{f.label}</span>
              <span className="num">
                <span data-testid="factor-points" className="text-base font-semibold">
                  {f.points >= 0 ? "+" : ""}
                  {f.points}
                </span>
                <span className="text-xs text-ink-2"> of {f.max}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <motion.div
                className={`h-full rounded-full ${BAR[level]}`}
                style={{ width: `${Math.max(0, f.points / f.max) * 100}%`, originX: 0 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.22, delay: 0.1 + i * 0.06, ease: EASE }}
              />
            </div>
            <p className="mt-2 text-[15px] leading-snug text-ink-2">{f.reason}</p>
            <p className="mt-1 text-xs text-ink-2">
              {f.source}, as of <time dateTime={f.asOf}>{formatAsOf(f.asOf)}</time>
            </p>
          </li>
        ))}
      </ul>

      <section aria-labelledby={`todo-${block.id}`} className="px-5 pt-5">
        <h3 id={`todo-${block.id}`} className="text-[15px] font-semibold">
          What to do
        </h3>
        <ol
          data-testid="actions"
          className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-snug marker:text-ink-2"
        >
          {actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
      </section>

      <div className="space-y-4 px-5 py-5">
        <div
          data-testid="photo-slot"
          className="rounded-[var(--r)] border border-dashed border-[var(--glass-border)] px-4 py-4"
        >
          <p className="text-[15px] font-medium">Photo scan</p>
          <p className="mt-1 text-[15px] leading-snug text-ink-2">
            {scanFactor
              ? `Scan changed score from ${score - scanFactor.points} to ${score}. ${scanFactor.reason}`
              : "No scan yet. Walk the rows with the camera to correct this score."}
          </p>
          <Link
            href={`/scan?property=${propertyId}&block=${block.id}`}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98]"
          >
            <Camera size={18} aria-hidden="true" />
            {scanFactor ? "Scan again" : "Scan the rows"}
          </Link>
        </div>

        <details className="rounded-[var(--r)] border border-[var(--glass-border)]">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[15px] font-medium">
            Adjust weights
          </summary>
          <div className="space-y-3 border-t border-[var(--glass-border)] px-4 py-4">
            {block.factors.map((f) => (
              <label key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-[15px]">
                <span>{f.label}</span>
                <span className="num text-ink-2">{f.max}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={f.max}
                  disabled
                  readOnly
                  aria-label={`${f.label} weight`}
                  className="col-span-2 mt-1 w-full accent-[var(--ink)]"
                />
              </label>
            ))}
            <p className="text-xs text-ink-2">Weights are fixed in this demo.</p>
          </div>
        </details>

        <Link
          href={`/plan?property=${propertyId}`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          See plan
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </motion.section>
  );
}
