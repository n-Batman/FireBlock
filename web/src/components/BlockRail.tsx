"use client";

import { useSyncExternalStore } from "react";
import type { Property } from "@/data/types";
import { daysUntilJune1 } from "@/lib/countdown";
import { levelOf, rankBlocks, scoreOf } from "@/lib/score";
import { RiskChip } from "./RiskChip";

interface BlockRailProps {
  property: Property;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Injectable for tests; defaults to the current date in the browser. */
  today?: Date;
}

const noopSubscribe = () => () => {};

function Deadline({ today }: { today?: Date }) {
  // Server snapshot is null so the date never differs between server and browser.
  const days = useSyncExternalStore(
    noopSubscribe,
    () => daysUntilJune1(today ?? new Date()),
    () => null,
  );
  return (
    <div data-testid="deadline" className="border-b border-line px-6 py-5">
      <p className="text-xs font-medium text-ink-2">County clearance deadline, June 1</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">
        {days === null ? (
          <span className="invisible">0</span>
        ) : days === 0 ? (
          "Deadline is today"
        ) : (
          <>
            <span className="num">{days}</span> {days === 1 ? "day" : "days"} left
          </>
        )}
      </p>
    </div>
  );
}

export function BlockRail({ property, selectedId, onSelect, today }: BlockRailProps) {
  const ranked = rankBlocks(property.blocks);
  const habitat = property.blocks.filter((b) => b.kind === "habitat");

  return (
    <div>
      <Deadline today={today} />

      <h2 className="px-6 pt-5 text-xs font-medium text-ink-2">Blocks, highest risk first</h2>
      <ul className="mt-2 divide-y divide-line">
        {ranked.map((block) => {
          const score = scoreOf(block);
          const selected = block.id === selectedId;
          return (
            <li key={block.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(block.id)}
                className={`block w-full px-6 py-4 text-left transition-colors hover:bg-white/5 ${
                  selected ? "bg-white/[0.07] shadow-[inset_3px_0_0_var(--ink)]" : ""
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{block.name}</span>
                  <RiskChip level={levelOf(score)} score={score} />
                </span>
                <span className="mt-1 block text-sm leading-snug text-ink-2">{block.reason}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {habitat.length > 0 && (
        <ul className="border-t border-line">
          {habitat.map((block) => (
            <li key={block.id} className="px-6 py-4">
              <span className="flex items-center gap-3">
                <span className="hatch size-4 shrink-0 rounded-sm border border-line" aria-hidden="true" />
                <span className="font-medium">{block.name}</span>
                <span className="ml-auto text-xs font-medium text-ink-2">No-mow</span>
              </span>
              <span className="mt-1 block text-sm leading-snug text-ink-2">{block.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
