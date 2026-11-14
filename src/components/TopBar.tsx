import Link from "next/link";
import { Camera, Info } from "@phosphor-icons/react";

interface TopBarProps {
  placeLabel: string;
  onOpenLimits: () => void;
  scanHref: string;
  children?: React.ReactNode;
}

export function TopBar({ placeLabel, onOpenLimits, scanHref, children }: TopBarProps) {
  return (
    <header className="no-print flex flex-wrap items-center gap-2">
      <div className="glass pointer-events-auto order-1 flex items-center gap-4 py-1.5 pl-1.5 pr-1.5 sm:pl-4">
        <span className="hidden text-base font-semibold tracking-tight sm:inline">FireBlock</span>
        <span className="flex min-h-11 max-w-[200px] items-center truncate px-3 text-[15px] font-medium sm:max-w-none" title={placeLabel}>
          {placeLabel}
        </span>
      </div>

      <div className="order-3 w-full lg:order-2 lg:w-auto">{children}</div>

      <div className="glass pointer-events-auto order-2 ml-auto flex items-center gap-1.5 py-1.5 pl-1.5 pr-1.5 sm:gap-3 xl:pl-4 text-[13px] text-ink-2 lg:order-3">
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
