"use client";

import { useSyncExternalStore } from "react";
import { Drop, Warning, Wind } from "@phosphor-icons/react";
import type { Property } from "@/data/types";
import { timeAgo } from "@/lib/relativeTime";
import { HotspotBadge } from "./HotspotBadge";

function subscribeMinute(onChange: () => void) {
  const id = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(id);
}

export function WeatherStrip({ property }: { property: Property }) {
  const { weather } = property;
  // The server snapshot is empty so the clock never differs between server and browser.
  const ago = useSyncExternalStore(
    subscribeMinute,
    () => timeAgo(weather.updatedAt, new Date()),
    () => "",
  );

  return (
    <div className="glass pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs lg:min-h-[60px] lg:gap-x-5 lg:px-4 lg:py-3 lg:text-[13px]">
      <span className="inline-flex items-center gap-2">
        <Wind size={16} aria-hidden="true" />
        <span className="num">
          {weather.windDir} {weather.windMph} mph
        </span>
      </span>
      <span className="inline-flex items-center gap-2">
        <Drop size={16} aria-hidden="true" />
        <span>
          <span className="num">{weather.humidityPct}%</span> humidity
        </span>
      </span>
      {weather.redFlag ? (
        <span className="inline-flex items-center gap-2 font-semibold text-high-ink">
          <Warning size={16} weight="fill" aria-hidden="true" />
          Red Flag Warning
        </span>
      ) : (
        <span className="text-ink-2">No Red Flag Warning</span>
      )}
      <HotspotBadge count={property.activeFires25mi} />
      <span className="text-ink-2">{ago ? `Updated ${ago}` : "Updated"}</span>
    </div>
  );
}
