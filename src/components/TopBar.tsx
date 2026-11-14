import { Info } from "@phosphor-icons/react";
import type { Property } from "@/data/types";
import { formatAsOf } from "@/lib/format";

interface TopBarProps {
  properties: Property[];
  activeId: string;
  onChange: (id: string) => void;
  cachedAt: string;
  onOpenLimits: () => void;
}

export function TopBar({ properties, activeId, onChange, cachedAt, onOpenLimits }: TopBarProps) {
  return (
    <header className="no-print border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:h-16 lg:flex-nowrap lg:py-0">
        <span className="text-base font-semibold tracking-tight">FireBlock</span>

        <div>
          <label htmlFor="property" className="sr-only">
            Property
          </label>
          <select
            id="property"
            value={activeId}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 rounded-[var(--r)] border border-line bg-paper px-3 text-sm font-medium"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
          <span>
            Data as of{" "}
            <time dateTime={cachedAt} className="tabular-nums text-ink">
              {formatAsOf(cachedAt)}
            </time>
          </span>
          <button
            type="button"
            onClick={onOpenLimits}
            className="inline-flex h-10 items-center gap-2 rounded-[var(--r)] border border-line px-3 font-medium text-ink transition-colors hover:bg-paper"
          >
            <Info size={16} />
            Data &amp; limits
          </button>
        </div>
      </div>
    </header>
  );
}
