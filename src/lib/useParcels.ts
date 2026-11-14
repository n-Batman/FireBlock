"use client";

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParcelUnit } from "@/data/types";
import { lookupParcels, lookupParcelsInView, type ParcelLookup, type View, type ViewLookup } from "./parcelApi";
import { loadRiskCells, scoreParcel, type RiskCell } from "./parcelScore";
import { toGeoJSON } from "./parcelUnits";
import { useParcelScans } from "./useParcelScans";
import { preloadNearbyParcels } from "./parcelCache";
import { ParcelScoreCache } from "./parcelScoreCache";

export interface ParcelState {
  /** "zoom" means the map view is too wide to search, so the parcels are not shown. */
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

const viewKeyOf = (v: View | null) => (v ? [v.west, v.south, v.east, v.north].join(",") : null);

/**
 * The county parcels for a chosen place: the ones within 300 m of it at first, then the ones in the
 * map's view as it moves (a view over 25 km2 shows none). Each has a score only if a saved scan's GPS
 * falls inside it or public/data/risk_map.geojson covers it. Everything else stays unscored.
 */
export function useParcels(place: Place | null, view: View | null = null): ParcelState {
  const scans = useParcelScans();
  const [cells, setCells] = useState<RiskCell[]>([]);
  const [lookup, setLookup] = useState<{ id: number; result: ParcelLookup } | null>(null);
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
  useEffect(() => {
    if (id === undefined || lat === undefined || lon === undefined) return;
    const controller = new AbortController();
    lookupParcels(lat, lon, { signal: controller.signal }).then(
      (result) => {
        // A late answer to an earlier place must not replace the newer one.
        if (!controller.signal.aborted) setLookup({ id, result });
      },
      () => {
        // An abort means a newer place replaced this one. Anything else is an error to show.
        if (!controller.signal.aborted) {
          setLookup({ id, result: { kind: "error", message: "The parcel lookup failed. Try again." } });
        }
      },
    );
    return () => controller.abort();
  }, [id, lat, lon]);

  // The map view. Each new view aborts the request for the one before it. The place it belongs to is
  // read from a ref, so choosing a place does not refetch the old view.
  const placeId = useRef(id);
  useEffect(() => {
    placeId.current = id;
  }, [id]);
  const viewKey = viewKeyOf(view);
  useEffect(() => {
    if (!viewKey || placeId.current === undefined) return;
    const [west, south, east, north] = viewKey.split(",").map(Number);
    const forPlace = placeId.current;
    const controller = new AbortController();
    lookupParcelsInView({ west, south, east, north }, { signal: controller.signal }).then(
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
  }, [viewKey]);

  // The latest view's answer replaces the 300 m one, and stays on screen until the next arrives.
  const viewCurrent = place && viewLookup?.placeId === place.id ? viewLookup.result : null;
  const current: ParcelLookup | ViewLookup | null = viewCurrent ?? (place && lookup?.id === place.id ? lookup.result : null);
  useEffect(()=>{
    if(!place||current?.kind!=="ok"||current.truncated)return;
    // Do not let speculative work race ahead of a still-loading viewport.
    if(viewKey&&(viewLookup?.viewKey!==viewKey||viewLookup.placeId!==place.id))return;
    const dy=300/111195,dx=dy/Math.cos(place.lat*Math.PI/180);
    const box:[number,number,number,number]=view
      ?[view.west,view.south,view.east,view.north]
      :[place.lon-dx,place.lat-dy,place.lon+dx,place.lat+dy];
    const controller=new AbortController();
    const timer=setTimeout(()=>{void preloadNearbyParcels(box,controller.signal);},500);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[current,place,viewKey,view,viewLookup]);
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
  if (!current) return { phase: "loading", units: [], truncated: false, message: null };
  if (current.kind === "outside") return { phase: "outside", units: [], truncated: false, message: null };
  if (current.kind === "too-wide") return { phase: "zoom", units: [], truncated: false, message: null };
  if (current.kind === "error") return { phase: "error", units: [], truncated: false, message: current.message };
  return { phase: "ready", units, truncated: current.truncated, message: null };
}
