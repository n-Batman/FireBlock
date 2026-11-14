"use client";

import { useEffect, useRef } from "react";
import type { ParcelUnit } from "@/data/types";
import { acresLabel, NO_PARCELS, NOT_SCORED, sourceLabel } from "@/content/parcelCopy";
import { RiskChip } from "./RiskChip";

interface ParcelRowsProps {
  parcels: ParcelUnit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Something to say instead of a list: loading, outside the county, an error. */
  notice: string | null;
}

/** The parcel at the searched point first, then scored ones highest first, then the unscored by parcel number. */
function ordered(parcels: ParcelUnit[]) {
  return [...parcels].sort((a, b) => {
    if (!!a.atPoint !== !!b.atPoint) return a.atPoint ? -1 : 1;
    if (a.score && b.score) return b.score.score - a.score.score || a.id.localeCompare(b.id);
    if (a.score || b.score) return a.score ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** The county parcels around the place that was chosen, listed by parcel number. */
export function ParcelRows({ parcels, selectedId, onSelect, notice }: ParcelRowsProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // A parcel picked on the map scrolls into view here.
  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selectedId]);

  return (
    <div>
      <h2 className="px-6 pt-5 text-xs font-medium text-ink-2">Parcels near your search</h2>
      {notice && (
        <p role="status" className="px-6 pt-3 text-[15px] leading-snug text-ink-2">
          {notice}
        </p>
      )}
      {!notice && parcels.length === 0 && <p className="px-6 pt-3 text-[15px] leading-snug text-ink-2">{NO_PARCELS}</p>}
      {parcels.length > 0 && (
        <ul ref={listRef} className="mt-2 divide-y divide-line">
          {ordered(parcels).map((parcel) => {
            const selected = parcel.id === selectedId;
            return (
              <li key={parcel.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(parcel.id)}
                  className={`block w-full px-6 py-4 text-left transition-colors hover:bg-white/5 ${
                    selected ? "bg-white/[0.07] shadow-[inset_3px_0_0_var(--ink)]" : ""
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span>
                      <span className="num font-medium">{parcel.id}</span>
                      <span className="ml-2 text-sm text-ink-2">{acresLabel(parcel.acres)}</span>
                      {parcel.atPoint && <span className="ml-2 text-xs font-medium text-ink">At your search</span>}
                    </span>
                    {parcel.score && (
                      <RiskChip level={parcel.score.level} score={parcel.score.score} scaleScore={parcel.score.score} />
                    )}
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-ink-2">
                    {parcel.score ? sourceLabel(parcel.score.source) : NOT_SCORED}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
