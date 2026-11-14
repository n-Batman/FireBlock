"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { properties } from "@/data/properties";
import { BlockRail } from "@/components/BlockRail";
import { BreakdownPanel } from "@/components/BreakdownPanel";
import { DataLimitsPanel } from "@/components/DataLimitsPanel";
import { Legend } from "@/components/Legend";
import { TopBar } from "@/components/TopBar";
import { WeatherStrip } from "@/components/WeatherStrip";
import { useWide } from "@/lib/useWide";

// Leaflet touches `window`, so the map loads in the browser only.
const RiskMap = dynamic(() => import("@/components/RiskMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" aria-hidden="true" />,
});

export default function Home() {
  const [activeId, setActiveId] = useState(properties[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const wide = useWide();
  const openLimits = useCallback(() => setLimitsOpen(true), []);
  const closeLimits = useCallback(() => setLimitsOpen(false), []);

  const property = properties.find((p) => p.id === activeId) ?? properties[0];
  const selectedBlock =
    property.blocks.find((b) => b.id === selectedId && b.kind === "vine") ?? null;
  const hasSelection = selectedBlock !== null;

  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  function changeProperty(id: string) {
    setActiveId(id);
    setSelectedId(null);
  }

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-paper">
      <div className="absolute inset-0 isolate">
        <RiskMap
          key={property.id}
          property={property}
          selectedId={selectedId}
          onSelect={setSelectedId}
          panelOpen={hasSelection}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-2 p-4 pb-8">
        <TopBar
          properties={properties}
          activeId={property.id}
          onChange={changeProperty}
          cachedAt={property.cachedAt}
          onOpenLimits={openLimits}
        >
          {/* On phones the strip steps aside while the breakdown sheet is open. */}
          {(wide || !hasSelection) && <WeatherStrip property={property} />}
        </TopBar>

        <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 lg:flex-row lg:justify-between lg:gap-4">
          {!hasSelection && (
            <div className="lg:hidden">
              <Legend />
            </div>
          )}

          <aside
            aria-label="Blocks"
            className={`glass pointer-events-auto max-h-[40dvh] w-full overflow-y-auto lg:max-h-full lg:w-[360px] lg:self-start ${
              hasSelection ? "hidden lg:block" : ""
            }`}
          >
            <BlockRail property={property} selectedId={selectedId} onSelect={setSelectedId} />
          </aside>

          <AnimatePresence>
            {selectedBlock && (
              <BreakdownPanel
                key={selectedBlock.id}
                block={selectedBlock}
                propertyId={property.id}
                onClose={() => setSelectedId(null)}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="hidden justify-center lg:flex">
          <Legend />
        </div>
      </div>

      <DataLimitsPanel open={limitsOpen} onClose={closeLimits} />
    </div>
  );
}
