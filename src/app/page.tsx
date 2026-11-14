"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { ListBullets, MapPinLine } from "@phosphor-icons/react";
import { properties } from "@/data/properties";
import { NO_BLOCKS_MESSAGE } from "@/content/placeMessages";
import { AddressSearch } from "@/components/AddressSearch";
import { BlockRail } from "@/components/BlockRail";
import { BreakdownPanel } from "@/components/BreakdownPanel";
import { DataLimitsPanel } from "@/components/DataLimitsPanel";
import { Legend } from "@/components/Legend";
import { TopBar } from "@/components/TopBar";
import { WeatherStrip } from "@/components/WeatherStrip";
import { noticeFor, type Place } from "@/lib/geocode";
import { applyScans } from "@/lib/scanStore";
import { useScans } from "@/lib/useScans";
import { useWide } from "@/lib/useWide";

// Leaflet touches `window`, so the map loads in the browser only.
import type { PickedPlace } from "@/components/RiskMap";

const RiskMap = dynamic(() => import("@/components/RiskMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" aria-hidden="true" />,
});

function MapShell() {
  const params = useSearchParams();
  const scans = useScans();
  const [activeId, setActiveId] = useState(
    () => properties.find((p) => p.id === params.get("property"))?.id ?? properties[0].id,
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("block"));
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [place, setPlace] = useState<PickedPlace | null>(null);
  // Phones only: his parcel panel needs the space the block rail uses, so they take turns.
  const [toolsOpen, setToolsOpen] = useState(false);
  const picks = useRef(0);
  const wide = useWide();
  const openLimits = useCallback(() => setLimitsOpen(true), []);
  const closeLimits = useCallback(() => setLimitsOpen(false), []);

  const base = properties.find((p) => p.id === activeId) ?? properties[0];
  // Saved scans show up as a "Photo scan" factor on the blocks they were run for.
  const property = useMemo(() => applyScans(base, scans), [base, scans]);
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

  // What we can honestly say about the searched place: no scored blocks, or outside the county.
  const notice = place ? noticeFor(place, properties) : null;
  const pickPlace = (picked: Place) => {
    setPlace({ ...picked, id: ++picks.current });
    setToolsOpen(true);
  };

  function changeProperty(id: string) {
    setActiveId(id);
    setSelectedId(null);
  }

  return (
    <div data-parcel-tools={toolsOpen ? "open" : "closed"} className="relative h-[100dvh] overflow-hidden bg-paper">
      <h1 className="sr-only">FireBlock fire prep map</h1>
      <div className="absolute inset-0 isolate">
        <RiskMap
          key={property.id}
          property={property}
          selectedId={selectedId}
          onSelect={setSelectedId}
          panelOpen={hasSelection}
          place={place}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-2 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <TopBar
          properties={properties}
          activeId={property.id}
          onChange={changeProperty}
          cachedAt={property.cachedAt}
          onOpenLimits={openLimits}
          scanHref={
            selectedBlock
              ? `/scan?property=${property.id}&block=${selectedBlock.id}`
              : `/scan?property=${property.id}`
          }
        >
          {/* On phones the strip steps aside while the breakdown sheet is open. */}
          {(wide || (!hasSelection && !toolsOpen)) && <WeatherStrip property={property} />}
        </TopBar>

        <div className="pointer-events-auto w-full lg:w-[360px]">
          <div className="flex gap-2">
            <AddressSearch onSelect={pickPlace} />
            <button
              type="button"
              onClick={() => setToolsOpen((open) => !open)}
              aria-pressed={toolsOpen}
              aria-label={toolsOpen ? "Show blocks" : "Parcel tools"}
              className="glass inline-flex h-11 w-11 shrink-0 items-center justify-center transition-colors hover:bg-white/5 active:scale-[0.98] lg:hidden"
            >
              {toolsOpen ? <ListBullets size={20} aria-hidden="true" /> : <MapPinLine size={20} aria-hidden="true" />}
            </button>
          </div>
          {notice && (
            <p role="status" className="glass mt-2 px-3 py-2 text-[15px] leading-snug">
              {notice === NO_BLOCKS_MESSAGE ? (
                <Link href="/scan" className="block py-1 underline-offset-2 hover:underline">
                  {notice}
                </Link>
              ) : (
                notice
              )}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 lg:flex-row lg:justify-between lg:gap-4">
          {!hasSelection && !toolsOpen && (
            <div className="lg:hidden">
              <Legend />
            </div>
          )}

          <aside
            aria-label="Blocks"
            className={`glass pointer-events-auto max-h-[40dvh] w-full overflow-y-auto lg:max-h-full lg:w-[360px] lg:self-start ${
              hasSelection || toolsOpen ? "hidden lg:block" : ""
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

export default function Home() {
  return (
    <Suspense fallback={<div className="h-[100dvh] bg-paper" aria-hidden="true" />}>
      <MapShell />
    </Suspense>
  );
}
