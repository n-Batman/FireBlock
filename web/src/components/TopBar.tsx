import { Info } from "@phosphor-icons/react";
import type { Property } from "@/data/types";
import { formatAsOf } from "@/lib/format";

interface TopBarProps {
  properties: Property[];
  activeId: string;
  onChange: (id: string) => void;
  cachedAt: string;
  onOpenLimits: () => void;
  /** Sits between the two pills (the weather strip). */
  children?: React.ReactNode;
}

export function TopBar({
  properties,
  activeId,
  onChange,
  cachedAt,
  onOpenLimits,
  children,
}: TopBarProps) {
  return (
    <header className="no-print flex flex-wrap items-center gap-2">
      <div className="glass pointer-events-auto order-1 flex items-center gap-4 py-1.5 pl-4 pr-1.5">
        <span className="text-base font-semibold tracking-tight">FireBlock</span>
        <div>
          <label htmlFor="property" className="sr-only">
            Property
          </label>
          <select
            id="property"
            value={activeId}
            onChange={(e) => onChange(e.target.value)}
            className="h-11 max-w-[150px] rounded-[var(--r)] border border-[var(--glass-border)] bg-surface px-3 text-[15px] font-medium text-ink sm:max-w-none"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="order-3 w-full lg:order-2 lg:w-auto">{children}</div>

      <div className="glass pointer-events-auto order-2 ml-auto flex items-center gap-3 py-1.5 pl-4 pr-1.5 text-[13px] text-ink-2 lg:order-3">
        <span className="hidden xl:inline">
          Data as of{" "}
          <time dateTime={cachedAt} className="tabular-nums text-ink">
            {formatAsOf(cachedAt)}
          </time>
        </span>
        <button
          type="button"
          onClick={onOpenLimits}
          aria-label="Data & limits"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98]"
        >
          <Info size={18} aria-hidden="true" />
          <span className="hidden sm:inline">Data &amp; limits</span>
        </button>
      </div>
    </header>
  );
}
