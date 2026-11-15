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
import { DataLimitsPanel } from "@/components/DataLimitsPanel";
import { Legend } from "@/components/Legend";
import { ParcelPanel } from "@/components/ParcelPanel";
import { TopBar } from "@/components/TopBar";
import { WeatherStrip } from "@/components/WeatherStrip";
import type { Place } from "@/lib/geocode";
import type { View } from "@/lib/parcelApi";
import { useParcels } from "@/lib/useParcels";
import { cellsFromRiskMap, scanSpots as spotsOf, type RiskCell } from "@/lib/parcelScore";
import { useParcelMarks } from "@/lib/useParcelMarks";
import { useParcelScans } from "@/lib/useParcelScans";
import type { RiskGrid } from "@/lib/parcelRisk";
import { useWide } from "@/lib/useWide";

// Leaflet touches `window`, so the map loads in the browser only.
import type { PickedPlace } from "@/components/RiskMap";

const RiskMap = dynamic(() => import("@/components/RiskMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" aria-hidden="true" />,
});

const DOWNTOWN_SLO: PickedPlace = { lat: 35.2828, lon: -120.6596, label: "Downtown SLO", id: 1 };

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [place, setPlace] = useState<PickedPlace>(() => placeFromParams(params) ?? DOWNTOWN_SLO);
  // Phones can switch between the parcel list and map lookup tools.
  const [toolsOpen, setToolsOpen] = useState(false);
  // The map's visible area, reported 400 ms after it stops moving. The parcels follow it.
  const [view, setView] = useState<View | null>(null);
  const [cells, setCells] = useState<RiskCell[]>([]);
  const onGridChange = useCallback((grid: RiskGrid | null) => {
    if (grid) setCells(cellsFromRiskMap(grid));
    else setCells(previous => previous.length ? [] : previous);
  }, []);
  const picks = useRef(1);
  const wide = useWide();
  const openLimits = useCallback(() => setLimitsOpen(true), []);
  const closeLimits = useCallback(() => setLimitsOpen(false), []);

  // The shared map and rail accept a property for legacy block mode.
  // Supplying parcels replaces those sample blocks with real county boundaries.
  const property = properties[0];
  const parcelState = useParcels(place, view, cells);
  const units = parcelState.units;
  const selectedParcel = units.find((u) => u.id === selectedId) ?? null;
  const hasSelection = selectedParcel !== null;
  // Pins for the selected parcel's first and newest scan, the same pair its before/after row shows.
  const scans = useParcelScans();
  const { resetAt } = useParcelMarks(selectedParcel?.id ?? null);
  const scanSpots = useMemo(() => (selectedParcel ? spotsOf(selectedParcel, scans, resetAt) : null), [selectedParcel, scans, resetAt]);

  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  // What the parcel list cannot show on its own: still loading, outside the county, an error, a cut-off list.
  const status = parcelState.phase === "loading"
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
  const noneScored = parcelState.phase === "ready" && units.every((u) => u.score === null);
  // Under the search box. When the rail is on screen it already shows the status, so it is not said twice.
  const railVisible = wide || (!hasSelection && !toolsOpen);
  const notice = (railVisible ? null : status) ?? (noneScored ? NO_BLOCKS_MESSAGE : null);

  const startAt = (point: { lat: number; lon: number }, label: string) => {
    setPlace({ ...point, label, id: ++picks.current });
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

  const scanHref = selectedParcel
    ? `/scan?parcel=${encodeURIComponent(selectedParcel.id)}`
    : "/scan";

  return (
    <div data-parcel-tools={toolsOpen ? "open" : "closed"} className="relative h-[100dvh] overflow-hidden bg-paper">
      <h1 className="sr-only">FireBlock fire prep map</h1>
      <div className="absolute inset-0 isolate">
        <RiskMap
          property={property}
          selectedId={selectedId}
          onSelect={setSelectedId}
          panelOpen={hasSelection}
          place={place}
          parcels={units}
          onPoint={onPoint}
          onView={setView}
          onGridChange={onGridChange}
          scanSpots={scanSpots}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-2 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <TopBar placeLabel={place.label} onOpenLimits={openLimits} scanHref={scanHref}>
          <WeatherStrip lat={view ? Number(((view.south + view.north) / 2).toFixed(2)) : place.lat} lon={view ? Number(((view.west + view.east) / 2).toFixed(2)) : place.lon} />
        </TopBar>

        <div className="pointer-events-auto w-full lg:w-[360px]">
          <div className="flex gap-2">
            <AddressSearch onSelect={pickPlace} />
            <button
              type="button"
              onClick={() => setToolsOpen((open) => !open)}
              aria-pressed={toolsOpen}
              aria-label={toolsOpen ? "Show parcels" : "Parcel tools"}
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
            aria-label="Parcels"
            className={`glass pointer-events-auto max-h-[40dvh] w-full overflow-y-auto lg:max-h-full lg:w-[360px] lg:self-start ${
              hasSelection || toolsOpen ? "hidden lg:block" : ""
            }`}
          >
            <BlockRail
              property={property}
              selectedId={selectedId}
              onSelect={setSelectedId}
              parcels={units}
              parcelNotice={status}
            />
          </aside>

          <AnimatePresence>
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
