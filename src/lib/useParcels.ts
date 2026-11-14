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
import { INDIVIDUAL_PARCEL_ZOOM } from "./parcelDisplay";
import { insideSlo } from "./geocode";

export interface ParcelState {
  /** "zoom" means area overview mode, or a view too wide for a parcel query. */
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
 * Load the visible county parcels only after the camera reports detail zoom (17+).
 * Overview zooms and views over 25 km2 show no individual parcels. Each has a score only if a saved scan's GPS
 * falls inside it or public/data/risk_map.geojson covers it. Everything else stays unscored.
 */
export function useParcels(place: Place | null, view: View | null = null): ParcelState {
  const scans = useParcelScans();
  const [cells, setCells] = useState<RiskCell[]>([]);
  const [viewLookup, setViewLookup] = useState<{ placeId: number; viewKey:string; result: ViewLookup } | null>(null);
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
  const overview=!!view&&(view.zoom??17)<INDIVIDUAL_PARCEL_ZOOM;
  const outside=lat!==undefined&&lon!==undefined&&!insideSlo(lat,lon);
  const viewKey = viewKeyOf(view);
  useEffect(() => {
    // Await the camera's zoom before any parcel request, including the initial address pick.
    if (!viewKey || id === undefined || overview || outside) return;
    const [west, south, east, north, zoom] = viewKey.split(",").map(Number);
    const forPlace = id;
    const controller = new AbortController();
    lookupParcelsInView({ west, south, east, north,zoom }, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setViewLookup({ placeId: forPlace, viewKey, result });
      },
      () => {
        if (!controller.signal.aborted) {
          setViewLookup({ placeId: forPlace, viewKey, result: { kind: "error", message: "The parcel lookup failed. Try again." } });
        }
      },
    );
    return () => controller.abort();
  }, [viewKey,id,overview,outside]);

  // Never retain visible details from a different camera, place or overview zoom.
  const current = !overview&&place&&viewLookup?.placeId===place.id&&viewLookup.viewKey===viewKey?viewLookup.result:null;
  // Fetch only the requested point/view. Speculative envelopes competed with
  // visible lookups and repeatedly downloaded larger parcel geometries.
  const units = useMemo(() => {
    if (current?.kind !== "ok") return [];
    const here = place ? point([place.lon, place.lat]) : null;
    return current.units.map((u) => ({
      ...u,
      atPoint: u.atPoint ?? (here ? booleanPointInPolygon(here, toGeoJSON(u)) : false),
      score: scoreCache.get(u,()=>scoreParcel(u, scans, cells)),
    }));
  }, [current, place, scans, cells, scoreCache]);

  if (!place) return { phase: "idle", units: [], truncated: false, message: null };
  if (outside) return { phase: "outside", units: [], truncated: false, message: null };
  if (overview) return {phase:"zoom",units:[],truncated:false,message:"Area summaries shown. Zoom in for individual properties."};
  if (!current) return { phase: "loading", units: [], truncated: false, message: null };
  if (current.kind === "too-wide") return { phase: "zoom", units: [], truncated: false, message: null };
  if (current.kind === "error") return { phase: "error", units: [], truncated: false, message: current.message };
  return { phase: "ready", units, truncated: current.truncated, message: null };
}
