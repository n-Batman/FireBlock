"use client";

import { useMemo, useState } from "react";
import { Polygon, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { ParcelUnit } from "@/data/types";
import { parcelDisplay, ParcelOutlineCache, type ParcelAreaSummary } from "./parcelDisplay";
import { scaleColor } from "./riskScale";

export function useParcelDisplay(parcels: ParcelUnit[], selectedId: string | null) {
  const map = useMap();
  const [outlineCache]=useState(()=>new ParcelOutlineCache());
  const camera=()=>{const b=map.getBounds();return {west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth()};};
  const [view,setView]=useState(camera);
  const refresh=()=>setView(previous=>{
    const next=camera();
    return next.west===previous.west&&next.east===previous.east&&next.south===previous.south&&next.north===previous.north?previous:next;
  });
  useMapEvents({moveend:refresh,zoomend:refresh,resize:refresh});
  return useMemo(()=>parcelDisplay(parcels,view,selectedId,outlineCache),[parcels,view,selectedId,outlineCache]);
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
