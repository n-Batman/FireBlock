"use client";

import { useEffect, useState } from "react";
import { metresBetween } from "./geolocate";

/**
 * Metres from the device to `spot`, kept current while the page is open. Null until the device reports a location, and
 * when there is no spot or the browser cannot share one. Asking for location only happens when there is a spot.
 */
export function useDistanceTo(spot: { lat: number; lon: number } | null): number | null {
  const [metres, setMetres] = useState<number | null>(null);
  const lat = spot?.lat;
  const lon = spot?.lon;
  useEffect(() => {
    if (lat === undefined || lon === undefined || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) setMetres(metresBetween({ lat, lon }, { lat: coords.latitude, lon: coords.longitude }));
      },
      () => setMetres(null),
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      setMetres(null);
    };
  }, [lat, lon]);
  return metres;
}
