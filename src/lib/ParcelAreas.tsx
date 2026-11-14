"use client";

import { useMemo, useState } from "react";
import { Polygon, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { ParcelUnit } from "@/data/types";
import { INDIVIDUAL_PARCEL_ZOOM, parcelDisplay, type ParcelAreaSummary } from "./parcelDisplay";
import { scaleColor } from "./riskScale";

export function useParcelDisplay(parcels: ParcelUnit[], selectedId: string | null) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => Math.floor(map.getZoom()));
  useMapEvents({ zoomend: () => setZoom(Math.floor(map.getZoom())) });
  return useMemo(() => parcelDisplay(parcels, zoom, selectedId), [parcels, zoom, selectedId]);
}

/** Summaries are approximate area tiles. Clicking zooms to properties, never selects a fake parcel. */
export function ParcelAreas({ areas }: { areas: ParcelAreaSummary[] }) {
  const map = useMap();
  return <>{areas.map(area => {
    const color = area.score === null ? "#b7c5bc" : scaleColor(area.score);
    return <Polygon key={area.id} positions={area.ring} pathOptions={{ color, fillColor: color, weight: 1, fillOpacity: area.score === null ? .06 : .18 }}
      eventHandlers={{ click: () => map.setView([(area.ring[0][0] + area.ring[2][0]) / 2, (area.ring[0][1] + area.ring[2][1]) / 2], INDIVIDUAL_PARCEL_ZOOM, { animate: false }) }}>
      <Tooltip sticky className="block-label">
        {`Approximate area · ${area.count} loaded parcels · ${area.scoredCount}/${area.count} scored · ${area.score === null ? "Insufficient scored area" : `Known-area average ${area.score.toFixed(1)}/100`} · Zoom in for individual property ratings`}
      </Tooltip>
    </Polygon>;
  })}</>;
}
