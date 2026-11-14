import Link from "next/link";
import { Camera, Info } from "@phosphor-icons/react";
import type { Property } from "@/data/types";
import { formatAsOf } from "@/lib/format";

/** The picker value for the parcels around the searched place. Any other value is a sample property id. */
export const PARCELS_OPTION = "__parcels";

interface TopBarProps {
  properties: Property[];
  activeId: string;
  /** True once a place has been searched, so the parcels around it can be picked. */
  parcelsAvailable?: boolean;
  onChange: (id: string) => void;
  /** When the sample data was cached. Left out for real parcels, which have no sample date. */
  cachedAt?: string;
  onOpenLimits: () => void;
  /** Where the Scan button goes: the scanner for this property, and the selected block if any. */
  scanHref: string;
  /** Sits between the two pills (the weather strip). */
  children?: React.ReactNode;
}

export function TopBar({
  properties,
  activeId,
  parcelsAvailable = false,
  onChange,
  cachedAt,
  onOpenLimits,
  scanHref,
  children,
}: TopBarProps) {
  return (
    <header className="no-print flex flex-wrap items-center gap-2">
      <div className="glass pointer-events-auto order-1 flex items-center gap-4 py-1.5 pl-1.5 pr-1.5 sm:pl-4">
        {/* On phones the wordmark steps aside so the picker and both buttons fit on one row. */}
        <span className="hidden text-base font-semibold tracking-tight sm:inline">FireBlock</span>
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
            {parcelsAvailable && <option value={PARCELS_OPTION}>Parcels near your search</option>}
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                Demo: {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="order-3 w-full lg:order-2 lg:w-auto">{children}</div>

      <div className="glass pointer-events-auto order-2 ml-auto flex items-center gap-1.5 py-1.5 pl-1.5 pr-1.5 sm:gap-3 xl:pl-4 text-[13px] text-ink-2 lg:order-3">
        {cachedAt && (
          <span className="hidden xl:inline">
            Data as of{" "}
            <time dateTime={cachedAt} className="tabular-nums text-ink">
              {formatAsOf(cachedAt)}
            </time>
          </span>
        )}
        <Link
          href={scanHref}
          aria-label="Scan"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98]"
        >
          <Camera size={18} aria-hidden="true" />
          <span className="hidden sm:inline">Scan</span>
        </Link>
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
