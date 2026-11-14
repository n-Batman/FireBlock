import { FireSimple } from "@phosphor-icons/react";

export function HotspotBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <FireSimple size={16} aria-hidden="true" />
      <span>{`${count} active ${count === 1 ? "fire" : "fires"} within 25 mi`}</span>
    </span>
  );
}
