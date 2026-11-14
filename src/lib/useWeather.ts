"use client";

import { useEffect, useState } from "react";
import type { LiveWeather, WeatherGeoJSON } from "./weatherTypes";

export function useWeather(lat: number, lon: number): { weather: LiveWeather | null; error: string | null } {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const [state, setState] = useState<{ key: string; weather: LiveWeather | null; error: string | null }>({ key, weather: null, error: null });
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const [latitude, longitude] = key.split(",");
    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`, { signal: requestController.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Weather is unavailable.");
        const weather = (data as WeatherGeoJSON).features?.[0]?.properties;
        if (data.type !== "FeatureCollection" || weather?.kind !== "forecast" || (!Number.isFinite(Date.parse(weather.validTo)) || Date.parse(weather.validTo) <= Date.now())) throw new Error("Weather is unavailable.");
        if (alive) setState({ key, weather, error: null });
      } catch (error) {
        if (alive && !requestController.signal.aborted) setState({ key, weather: null, error: error instanceof Error ? error.message : "Weather is unavailable." });
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => { alive = false; controller?.abort(); clearInterval(timer); };
  }, [key]);
  return state.key === key ? state : { weather: null, error: null };
}
