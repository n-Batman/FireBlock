"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import { Marker, useMap } from "react-leaflet";
import { FIRST_SCAN_SPOT, LATEST_SCAN_SPOT } from "@/content/parcelCopy";

/** Where a parcel's first and newest scans were saved. `after` is absent until there is a rescan. */
export interface ScanSpots {
  before: { lat: number; lon: number };
  after?: { lat: number; lon: number };
}

// Same look as the score pills in RiskMap (glass dot, thin ring), smaller; the tone tells the two apart.
// Full class strings so Tailwind can see them (they are used inside Leaflet's divIcon HTML).
const TONE = { before: "border-ink/70", after: "border-low/70 bg-low/30" } as const;
const icons = new Map<string, L.DivIcon>();

function pinIcon(kind: keyof typeof TONE) {
  const cached = icons.get(kind);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "",
    iconSize: [0, 0],
    html: `<span class="block size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--glass-bg)] ${TONE[kind]}"></span>`,
  });
  icons.set(kind, icon);
  return icon;
}

/**
 * Small pins at the first scan's spot and, once it exists, the latest scan's, in their own pane. The pane is hidden while
 * the map moves, like the score pills.
 */
export function ScanSpotPins({ spots }: { spots: ScanSpots | null }) {
  const map = useMap();
  const [pane] = useState(() => {
    const p = map.getPane("scan-spots") ?? map.createPane("scan-spots");
    p.style.zIndex = "610";
    return p;
  });
  useEffect(() => {
    const hide = () => { pane.style.visibility = "hidden"; };
    const show = () => { pane.style.visibility = "visible"; };
    map.on("movestart zoomstart", hide);
    map.on("moveend zoomend", show);
    return () => {
      map.off("movestart zoomstart", hide);
      map.off("moveend zoomend", show);
      show();
    };
  }, [map, pane]);
  if (!spots) return null;
  return (
    <>
      <Marker pane="scan-spots" position={[spots.before.lat, spots.before.lon]} icon={pinIcon("before")} title={FIRST_SCAN_SPOT} alt={FIRST_SCAN_SPOT} interactive={false} />
      {spots.after && (
        <Marker pane="scan-spots" position={[spots.after.lat, spots.after.lon]} icon={pinIcon("after")} title={LATEST_SCAN_SPOT} alt={LATEST_SCAN_SPOT} interactive={false} />
      )}
    </>
  );
}
