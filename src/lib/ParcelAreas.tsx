"use client";

import { useMemo } from "react";
import { Polygon, Tooltip, useMap } from "react-leaflet";
import type { ParcelUnit } from "@/data/types";
import type { ParcelAreaSummary } from "./parcelDisplay";
import { scaleColor } from "./riskScale";

// Grouping is disabled. Keep the call contract without camera subscriptions,
// screen-area calculations, clipping, union work, or an outline cache.
export function useParcelDisplay(parcels: ParcelUnit[], _selectedId: string | null) {
  return useMemo(()=>({individuals:parcels,areas:[] as ParcelAreaSummary[]}),[parcels]);
}

/** Union outlines of small parcels. Clicking fits the real member geometry. */
export function ParcelAreas({ areas }: { areas: ParcelAreaSummary[] }) {
  const map = useMap();
  return <>{areas.map(area => {
    const color = area.score === null ? "#b7c5bc" : scaleColor(area.score);
    return <Polygon key={area.id} positions={area.parts} pathOptions={{ color, fillColor: color, weight: 1, fillOpacity: area.score === null ? .06 : .18 }}
      eventHandlers={{ click: () => {const points=area.parts.flatMap(part=>part[0]);map.fitBounds([[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]],{padding:[40,40],maxZoom:24,animate:false});} }}>
      <Tooltip sticky className="block-label">
        {`Combined outline · ${area.count} loaded parcels · ${area.scoredCount}/${area.count} scored · ${area.score === null ? "Insufficient scored area" : `Known-area average ${area.score.toFixed(1)}/100`} · Zoom in for individual properties`}
      </Tooltip>
    </Polygon>;
  })}</>;
}
