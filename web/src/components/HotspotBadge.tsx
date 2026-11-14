import { FireSimple } from "@phosphor-icons/react";

export function HotspotBadge({ count }: { count: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[var(--r)] border border-line bg-surface px-3 py-2 text-sm font-medium shadow-[0_1px_2px_rgb(21_36_29/0.1)]">
      <FireSimple size={16} aria-hidden="true" />
      <span>{`${count} active ${count === 1 ? "fire" : "fires"} within 25 mi`}</span>
    </div>
  );
}
