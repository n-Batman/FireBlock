"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { properties } from "@/data/properties";
import { BlockRail } from "@/components/BlockRail";
import { DataLimitsPanel } from "@/components/DataLimitsPanel";
import { HotspotBadge } from "@/components/HotspotBadge";
import { Legend } from "@/components/Legend";
import { TopBar } from "@/components/TopBar";

// Leaflet touches `window`, so the map loads in the browser only.
const RiskMap = dynamic(() => import("@/components/RiskMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

export default function Home() {
  const [activeId, setActiveId] = useState(properties[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const openLimits = useCallback(() => setLimitsOpen(true), []);
  const closeLimits = useCallback(() => setLimitsOpen(false), []);

  const property = properties.find((p) => p.id === activeId) ?? properties[0];

  function changeProperty(id: string) {
    setActiveId(id);
    setSelectedId(null);
  }

  return (
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh]">
      <TopBar
        properties={properties}
        activeId={property.id}
        onChange={changeProperty}
        cachedAt={property.cachedAt}
        onOpenLimits={openLimits}
      />

      <main className="grid flex-1 grid-rows-[minmax(60dvh,1fr)_auto] lg:min-h-0 lg:grid-cols-[380px_1fr] lg:grid-rows-1">
        <div className="relative order-1 lg:order-2">
          <div className="absolute inset-0 isolate">
            <RiskMap
              key={property.id}
              property={property}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
          <div className="absolute left-4 top-4 z-10">
            <HotspotBadge count={property.activeFires25mi} />
          </div>
          <div className="absolute bottom-4 left-4 z-10">
            <Legend />
          </div>
        </div>

        <div className="order-2 border-t border-line bg-surface lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-t-0">
          <BlockRail property={property} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </main>

      <DataLimitsPanel open={limitsOpen} onClose={closeLimits} />
    </div>
  );
}
