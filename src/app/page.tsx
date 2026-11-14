"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { ListBullets, MapPinLine } from "@phosphor-icons/react";
import { properties } from "@/data/properties";
import { FINDING_PARCELS, TRUNCATED, ZOOM_IN } from "@/content/parcelCopy";
import { NO_BLOCKS_MESSAGE, OUTSIDE_COUNTY_MESSAGE } from "@/content/placeMessages";
import { AddressSearch } from "@/components/AddressSearch";
import { BlockRail } from "@/components/BlockRail";
import { BreakdownPanel } from "@/components/BreakdownPanel";
import { DataLimitsPanel } from "@/components/DataLimitsPanel";
import { Legend } from "@/components/Legend";
import { ParcelPanel } from "@/components/ParcelPanel";
import { PARCELS_OPTION, TopBar } from "@/components/TopBar";
import { WeatherStrip } from "@/components/WeatherStrip";
import type { Place } from "@/lib/geocode";
import type { View } from "@/lib/parcelApi";
import { applyScans } from "@/lib/scanStore";
import { useParcels } from "@/lib/useParcels";
import { useScans } from "@/lib/useScans";
import { useWide } from "@/lib/useWide";

// Leaflet touches `window`, so the map loads in the browser only.
import type { PickedPlace } from "@/components/RiskMap";

const RiskMap = dynamic(() => import("@/components/RiskMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" aria-hidden="true" />,
});

/** `/?lat=..&lon=..` reopens the map at a place, for example where a scan was saved. */
function placeFromParams(params: URLSearchParams): PickedPlace | null {
  const rawLat = params.get("lat");
  const rawLon = params.get("lon");
  if (rawLat === null || rawLon === null) return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, label: "Scan location", id: 1 } : null;
}

function MapShell() {
  const params = useSearchParams();
  const scans = useScans();
  const [activeId, setActiveId] = useState(
    () => properties.find((p) => p.id === params.get("property"))?.id ?? properties[0].id,
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("block"));
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [place, setPlace] = useState<PickedPlace | null>(() => placeFromParams(params));
  // True once someone picks a Demo property. Searching a place switches back to the real parcels.
  const [demo, setDemo] = useState(false);
  // Phones only: his parcel panel needs the space the block rail uses, so they take turns.
  // Reopening at a scan's location starts with the map clear, as after a search.
  const [toolsOpen, setToolsOpen] = useState(() => place !== null);
  // The map's visible area, reported 400 ms after it stops moving. The parcels follow it.
  const [view, setView] = useState<View | null>(null);
  const picks = useRef(place ? 1 : 0);
  const wide = useWide();
  const openLimits = useCallback(() => setLimitsOpen(true), []);
  const closeLimits = useCallback(() => setLimitsOpen(false), []);

  const base = properties.find((p) => p.id === activeId) ?? properties[0];
  // Saved scans show up as a "Photo scan" factor on the blocks they were run for.
  const property = useMemo(() => applyScans(base, scans), [base, scans]);

  // Real county parcels around the searched place, unless a Demo property is showing.
  const parcelView = place !== null && !demo;
  const parcelState = useParcels(place, parcelView ? view : null);
  const units = parcelView ? parcelState.units : [];
  const selectedParcel = parcelView ? (units.find((u) => u.id === selectedId) ?? null) : null;
  const selectedBlock = parcelView ? null : (property.blocks.find((b) => b.id === selectedId && b.kind === "vine") ?? null);
  const hasSelection = selectedBlock !== null || selectedParcel !== null;

  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  // What the parcel list cannot show on its own: still loading, outside the county, an error, a cut-off list.
  const status = !parcelView
    ? null
    : parcelState.phase === "loading"
      ? FINDING_PARCELS
      : parcelState.phase === "zoom"
        ? ZOOM_IN
        : parcelState.phase === "outside"
        ? OUTSIDE_COUNTY_MESSAGE
        : parcelState.phase === "error"
          ? parcelState.message
          : parcelState.truncated
            ? TRUNCATED
            : null;
  const noneScored = parcelView && parcelState.phase === "ready" && units.every((u) => u.score === null);
  // Under the search box. When the rail is on screen it already shows the status, so it is not said twice.
  const railVisible = wide || (!hasSelection && !toolsOpen);
  const notice = (railVisible ? null : status) ?? (noneScored ? NO_BLOCKS_MESSAGE : null);

  const startAt = (point: { lat: number; lon: number }, label: string) => {
    setPlace({ ...point, label, id: ++picks.current });
    setDemo(false);
    setSelectedId(null);
  };
  const pickPlace = (picked: Place) => {
    startAt(picked, picked.label);
    setToolsOpen(true);
  };
  // His latitude/longitude fields and "Pick on map" report the point they looked up.
  const onPoint = (point: { lat: number; lon: number }) => {
    const same = place && Math.abs(place.lat - point.lat) < 1e-9 && Math.abs(place.lon - point.lon) < 1e-9;
    if (!same) startAt(point, "Chosen point");
  };

  function changeProperty(id: string) {
    setSelectedId(null);
    if (id === PARCELS_OPTION) {
      setDemo(false);
      return;
    }
    setActiveId(id);
    setDemo(true);
  }

  const scanHref = parcelView
    ? selectedParcel
      ? `/scan?parcel=${encodeURIComponent(selectedParcel.id)}`
      : "/scan"
    : selectedBlock
      ? `/scan?property=${property.id}&block=${selectedBlock.id}`
      : `/scan?property=${property.id}`;

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
          parcels={parcelView ? units : null}
          onPoint={onPoint}
          onView={setView}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-2 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <TopBar
          properties={properties}
          activeId={parcelView ? PARCELS_OPTION : property.id}
          parcelsAvailable={place !== null}
          onChange={changeProperty}
          cachedAt={parcelView ? undefined : property.cachedAt}
          onOpenLimits={openLimits}
          scanHref={scanHref}
        >
          {/* The weather is sample data for the Demo properties, so it is not shown for real parcels. */}
          {!parcelView && (wide || (!hasSelection && !toolsOpen)) && <WeatherStrip property={property} />}
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
            aria-label={parcelView ? "Parcels" : "Blocks"}
            className={`glass pointer-events-auto max-h-[40dvh] w-full overflow-y-auto lg:max-h-full lg:w-[360px] lg:self-start ${
              hasSelection || toolsOpen ? "hidden lg:block" : ""
            }`}
          >
            <BlockRail
              property={property}
              selectedId={selectedId}
              onSelect={setSelectedId}
              parcels={parcelView ? units : undefined}
              parcelNotice={status}
            />
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
            {selectedParcel && (
              <ParcelPanel key={selectedParcel.id} parcel={selectedParcel} onClose={() => setSelectedId(null)} />
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
