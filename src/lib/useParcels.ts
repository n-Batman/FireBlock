"use client";

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { useEffect, useMemo, useState } from "react";
import type { ParcelUnit } from "@/data/types";
import { lookupParcelsInView, type View, type ViewLookup } from "./parcelApi";
import { loadRiskCells, scoreParcel, type RiskCell } from "./parcelScore";
import { toGeoJSON } from "./parcelUnits";
import { useParcelScans } from "./useParcelScans";
import { ParcelScoreCache } from "./parcelScoreCache";
import { insideSlo } from "./geocode";

export interface ParcelState {
  /** "zoom" means the view exceeds the county query limit; loaded parcels remain. */
  phase: "idle" | "loading" | "ready" | "outside" | "error" | "zoom";
  units: ParcelUnit[];
  truncated: boolean;
  /** Plain words for an error, otherwise null. */
  message: string | null;
}

interface Place {
  lat: number;
  lon: number;
  id: number;
}

const viewKeyOf = (v: View | null) => (v ? [v.west, v.south, v.east, v.north,v.zoom??17].join(",") : null);

/**
 * Load a bounded visible viewport at every zoom and retain loaded geometry while
 * the next request completes. Each has a score only if a saved scan's GPS
 * falls inside it or public/data/risk_map.geojson covers it. Everything else stays unscored.
 */
export function useParcels(place: Place | null, view: View | null = null): ParcelState {
  const scans = useParcelScans();
  const [cells, setCells] = useState<RiskCell[]>([]);
  const [viewLookup, setViewLookup] = useState<{ placeId: number; viewKey:string; result: ViewLookup } | null>(null);
  const [retained,setRetained]=useState<{placeId:number;result:Extract<ViewLookup,{kind:"ok"}>}|null>(null);
  // A new map or scan array creates a fresh memo, so stale scores cannot survive
  // new evidence. The cache never stores raw scans, photos or GPS coordinates.
  const scoreCache=useMemo(()=>new ParcelScoreCache(),[cells,scans]);
  useEffect(()=>{
    const clear=()=>scoreCache.clear();
    const timer=setInterval(clear,5*60_000);
    window.addEventListener("pagehide",clear);
    return ()=>{clearInterval(timer);window.removeEventListener("pagehide",clear);clear();};
  },[scoreCache]);

  useEffect(() => {
    let alive = true;
    void loadRiskCells().then((loaded) => {
      if (alive) setCells(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);

  const id = place?.id;
  const lat = place?.lat;
  const lon = place?.lon;
  const outside=lat!==undefined&&lon!==undefined&&!insideSlo(lat,lon);
  const viewKey = viewKeyOf(view);
  useEffect(() => {
    // Await valid camera bounds before the initial request; no zoom cutoff.
    if (!viewKey || id === undefined || outside) return;
    const [west, south, east, north, zoom] = viewKey.split(",").map(Number);
    const forPlace = id;
    const controller = new AbortController();
    lookupParcelsInView({ west, south, east, north,zoom }, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) {
          setViewLookup({ placeId: forPlace, viewKey, result });
          if(result.kind==="ok")setRetained({placeId:forPlace,result});
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setViewLookup({ placeId: forPlace, viewKey, result: { kind: "error", message: "The parcel lookup failed. Try again." } });
        }
      },
    );
    return () => controller.abort();
  }, [viewKey,id,outside]);

  // Match replies to the current view; retain successful geometry for this place.
  const current = place&&viewLookup?.placeId===place.id&&viewLookup.viewKey===viewKey?viewLookup.result:null;
  const display=current?.kind==="ok"?current:retained?.placeId===place?.id?retained?.result:null;
  // Fetch only the requested point/view. Speculative envelopes competed with
  // visible lookups and repeatedly downloaded larger parcel geometries.
  // Camera changes only filter these units; point tests and score-cache lookups
  // belong to the geometry/evidence version, not every pan or resize.
  const scoredUnits = useMemo(() => {
    if (!display) return [];
    const here = place ? point([place.lon, place.lat]) : null;
    return display.units.map((u) => ({
      ...u,
      atPoint: u.atPoint ?? (here ? booleanPointInPolygon(here, toGeoJSON(u)) : false),
      score: scoreCache.get(u,()=>scoreParcel(u, scans, cells)),
    }));
  }, [display, place, scans, cells, scoreCache]);
  const units = useMemo(() => scoredUnits.filter(u=>!view||u.parts.some(part=>{
    const xs=part[0].map(p=>p[1]),ys=part[0].map(p=>p[0]);
    return Math.min(...xs)<=view.east&&Math.max(...xs)>=view.west&&Math.min(...ys)<=view.north&&Math.max(...ys)>=view.south;
  })), [scoredUnits, view]);

  if (!place) return { phase: "idle", units: [], truncated: false, message: null };
  if (outside) return { phase: "outside", units: [], truncated: false, message: null };
  if (!current) return { phase: "loading", units, truncated: display?.truncated??false, message: null };
  if (current.kind === "too-wide") return { phase: "zoom", units, truncated: true, message: "Showing loaded properties. Zoom in to load more boundaries." };
  if (current.kind === "error") return { phase: "error", units, truncated: display?.truncated??false, message: current.message };
  return { phase: "ready", units, truncated: current.truncated, message: null };
}
