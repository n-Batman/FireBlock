"use client";

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { useEffect, useMemo, useState } from "react";
import type { ParcelUnit } from "@/data/types";
import { lookupParcelsInView, type View, type ViewLookup } from "./parcelApi";
import { scoreParcel, type RiskCell } from "./parcelScore";
import { toGeoJSON } from "./parcelUnits";
import { useParcelScans } from "./useParcelScans";
import { ParcelScoreCache } from "./parcelScoreCache";
import { insideSlo } from "./geocode";
import { minParcelAcres } from "./parcelDisplayConfig";

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
const EMPTY_CELLS: RiskCell[] = [];

/** Diff by APN while retaining geometry references for unchanged parcels. */
function reuseParcelUnits(previous: ParcelUnit[], incoming: ParcelUnit[]): ParcelUnit[] {
  const old = new Map(previous.map(unit => [unit.id, unit]));
  const next = new Map(incoming.map(unit => {
    const saved = old.get(unit.id);
    const same = saved && saved.acres === unit.acres && saved.center[0] === unit.center[0] && saved.center[1] === unit.center[1] &&
      (saved.parts === unit.parts || saved.parts.length === unit.parts.length && unit.parts.every((part, i) =>
        part.length === saved.parts[i].length && part.every((ring, j) => ring.length === saved.parts[i][j].length &&
          ring.every((point, k) => point[0] === saved.parts[i][j][k][0] && point[1] === saved.parts[i][j][k][1]))));
    return [unit.id, same ? saved : unit] as const;
  }));
  if (next.size === old.size && [...next].every(([id, unit]) => old.get(id) === unit)) return previous;
  return [...next.values()];
}

/**
 * Load a bounded visible viewport at every zoom and retain loaded geometry while
 * the next request completes. Each has a score only if a saved scan's GPS
 * falls inside it or the shared regional API grid covers it. Everything else stays unscored.
 */
export function useParcels(place: Place | null, view: View | null = null, cells: RiskCell[] = EMPTY_CELLS): ParcelState {
  const scans = useParcelScans();
  const [lookups,setLookups]=useState<{
    viewLookup:{placeId:number;viewKey:string;result:ViewLookup}|null;
    retained:{placeId:number;result:Extract<ViewLookup,{kind:"ok"}>}|null;
  }>({viewLookup:null,retained:null});
  const {viewLookup,retained}=lookups;
  // A new map or scan array creates a fresh memo, so stale scores cannot survive
  // new evidence. The cache never stores raw scans, photos or GPS coordinates.
  const scoreCache=useMemo(()=>new ParcelScoreCache(),[cells,scans]);
  useEffect(()=>{
    const clear=()=>scoreCache.clear();
    const timer=setInterval(clear,5*60_000);
    window.addEventListener("pagehide",clear);
    return ()=>{clearInterval(timer);window.removeEventListener("pagehide",clear);clear();};
  },[scoreCache]);

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
          setLookups(previous=>{
            let next=result,retained=previous.retained;
            if(result.kind==="ok"){
              const saved=retained?.placeId===forPlace?retained:null;
              const units=saved?reuseParcelUnits(saved.result.units,result.units):result.units;
              next=saved&&units===saved.result.units&&result.truncated===saved.result.truncated?saved.result:{...result,units};
              if(next!==saved?.result)retained={placeId:forPlace,result:next};
            }
            if(previous.viewLookup?.placeId===forPlace&&previous.viewLookup.viewKey===viewKey&&previous.viewLookup.result===next)return previous;
            return {viewLookup:{placeId:forPlace,viewKey,result:next},retained};
          });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setLookups(previous=>({...previous,viewLookup:{ placeId: forPlace, viewKey, result: { kind: "error", message: "The parcel lookup failed. Try again." } }}));
        }
      },
    );
    return () => controller.abort();
  }, [viewKey,id,outside]);

  // Match replies to the current view; retain successful geometry for this place.
  const current = place&&viewLookup?.placeId===place.id&&viewLookup.viewKey===viewKey?viewLookup.result:null;
  const display=current?.kind==="ok"?current:retained?.placeId===place?.id?retained?.result:null;
  const displayUnits=display?.units;
  // Retain scored wrappers too when the raw parcel survives a response diff.
  // Weak keys do not keep removed parcels alive; evidence/place changes reset it.
  const scoredCache=useMemo(()=>new WeakMap<ParcelUnit,ParcelUnit>(),[id,lat,lon,scans,cells,scoreCache]);
  // Fetch only the requested point/view. Speculative envelopes competed with
  // visible lookups and repeatedly downloaded larger parcel geometries.
  // Camera changes only filter these units; point tests and score-cache lookups
  // belong to the geometry/evidence version, not every pan or resize.
  const scoredUnits = useMemo(() => {
    if (!displayUnits) return [];
    const here = place ? point([place.lon, place.lat]) : null;
    return displayUnits.map((u) => {
      const saved=scoredCache.get(u);
      if(saved)return saved;
      const unit={
        ...u,
        atPoint: u.atPoint ?? (here ? booleanPointInPolygon(here, toGeoJSON(u)) : false),
        score: scoreCache.get(u,()=>scoreParcel(u, scans, cells)),
      };
      scoredCache.set(u,unit);
      return unit;
    });
  }, [displayUnits, place, scans, cells, scoreCache,scoredCache]);
  // Compute bounds once per scored response, not by walking vertices on each pan.
  const boundedUnits=useMemo(()=>scoredUnits.map(unit=>({unit,boxes:unit.parts.map(part=>
    part[0].reduce((b,p)=>[Math.min(b[0],p[1]),Math.min(b[1],p[0]),Math.max(b[2],p[1]),Math.max(b[3],p[0])],
      [Infinity,Infinity,-Infinity,-Infinity]))})),[scoredUnits]);
  const units = useMemo(() => {
    const minAcres=minParcelAcres(view?.zoom);
    return boundedUnits.filter(({unit,boxes})=>(minAcres===0||unit.acres>=minAcres)&&
      (!view||boxes.some(([w,s,e,n])=>w<=view.east&&e>=view.west&&s<=view.north&&n>=view.south))).map(({unit})=>unit);
  }, [boundedUnits, view]);

  if (!place) return { phase: "idle", units: [], truncated: false, message: null };
  if (outside) return { phase: "outside", units: [], truncated: false, message: null };
  if (!current) return { phase: "loading", units, truncated: display?.truncated??false, message: null };
  if (current.kind === "too-wide") return { phase: "zoom", units, truncated: true, message: "Showing loaded properties. Zoom in to load more boundaries." };
  if (current.kind === "error") return { phase: "error", units, truncated: display?.truncated??false, message: current.message };
  return { phase: "ready", units, truncated: current.truncated, message: null };
}
