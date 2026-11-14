"use client";

import { useEffect, useMemo, useState } from "react";
import type { ParcelUnit } from "@/data/types";
import { lookupParcels, type ParcelLookup } from "./parcelApi";
import { loadRiskCells, scoreParcel, type RiskCell } from "./parcelScore";
import { useParcelScans } from "./useParcelScans";

export interface ParcelState {
  phase: "idle" | "loading" | "ready" | "outside" | "error";
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

/**
 * The county parcels within 300 m of a chosen place, each with a score only if a saved scan's GPS
 * falls inside it or public/data/risk_map.geojson covers it. Everything else stays unscored.
 */
export function useParcels(place: Place | null): ParcelState {
  const scans = useParcelScans();
  const [cells, setCells] = useState<RiskCell[]>([]);
  const [lookup, setLookup] = useState<{ id: number; result: ParcelLookup } | null>(null);

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

  const current = place && lookup?.id === place.id ? lookup.result : null;
  const units = useMemo(
    () => (current?.kind === "ok" ? current.units.map((u) => ({ ...u, score: scoreParcel(u, scans, cells) })) : []),
    [current, scans, cells],
  );

  if (!place) return { phase: "idle", units: [], truncated: false, message: null };
  if (!current) return { phase: "loading", units: [], truncated: false, message: null };
  if (current.kind === "outside") return { phase: "outside", units: [], truncated: false, message: null };
  if (current.kind === "error") return { phase: "error", units: [], truncated: false, message: current.message };
  return { phase: "ready", units, truncated: current.truncated, message: null };
}
