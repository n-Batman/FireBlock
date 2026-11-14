"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Camera, X } from "@phosphor-icons/react";
import type { Block, Level } from "@/data/types";
import { formatAsOf } from "@/lib/format";
import { levelOf, scoreOf } from "@/lib/score";
import { RiskChip } from "./RiskChip";

const BAR: Record<Level, string> = { low: "bg-low", medium: "bg-med", high: "bg-high" };

interface BreakdownPanelProps {
  block: Block;
  propertyId: string;
  onClose: () => void;
}

export function BreakdownPanel({ block, propertyId, onClose }: BreakdownPanelProps) {
  const ref = useRef<HTMLElement>(null);
  const score = scoreOf(block);
  const level = levelOf(score);

  useEffect(() => {
    // On phones the panel sits below the map, so bring it into view.
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return (
    <section
      ref={ref}
      aria-label={`${block.name} score breakdown`}
      className="no-print order-2 flex flex-col overflow-y-auto border-t border-line bg-surface lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:z-20 lg:order-3 lg:w-[400px] lg:rounded-[var(--r)] lg:border lg:shadow-[0_8px_30px_rgb(21_36_29/0.18)]"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <h2 className="text-lg font-semibold tracking-tight">{block.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-[var(--r)] p-2 text-ink-2 transition-colors hover:text-ink"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-5 pb-5 pt-3">
        <div className="flex items-center gap-3">
          <p className="text-5xl font-semibold tracking-tight">
            <span data-testid="score" className="num">
              {score}
            </span>
            <span className="num ml-1 text-base font-medium text-ink-2">/ 100</span>
          </p>
          <RiskChip level={level} />
        </div>
        <p className="mt-3 text-sm leading-relaxed">{block.summary}</p>
      </div>

      <ul className="divide-y divide-line border-y border-line">
        {block.factors.map((f) => (
          <li key={f.key} data-testid="factor-row" className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{f.label}</span>
              <span className="num">
                <span data-testid="factor-points" className="text-base font-semibold">
                  +{f.points}
                </span>
                <span className="text-xs text-ink-2"> of {f.max}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div
                className={`h-full rounded-full ${BAR[level]}`}
                style={{ width: `${(f.points / f.max) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-sm leading-snug text-ink-2">{f.reason}</p>
            <p className="mt-1 text-xs text-ink-2">
              {f.source}, as of <time dateTime={f.asOf}>{formatAsOf(f.asOf)}</time>
            </p>
          </li>
        ))}
      </ul>

      <div className="space-y-4 px-5 py-5">
        <div
          data-testid="photo-slot"
          className="rounded-[var(--r)] border border-dashed border-line px-4 py-4"
        >
          <p className="text-sm font-medium">Photo scan</p>
          <p className="mt-1 text-sm leading-snug text-ink-2">
            No photos yet. Photos from the rows will correct this score.
          </p>
          <button
            type="button"
            disabled
            className="mt-3 inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-[var(--r)] border border-line px-3 text-sm font-medium text-ink-2"
          >
            <Camera size={16} aria-hidden="true" />
            Add photos from the rows
          </button>
          <p className="mt-2 text-xs text-ink-2">The photo scan is the next thing we are building.</p>
        </div>

        <details className="group rounded-[var(--r)] border border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Adjust weights</summary>
          <div className="space-y-3 border-t border-line px-4 py-4">
            {block.factors.map((f) => (
              <label key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
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
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--r)] bg-ink px-4 text-sm font-semibold text-paper transition-opacity hover:opacity-90"
        >
          See plan
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
