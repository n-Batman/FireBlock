"use client";

import { useSyncExternalStore } from "react";
import { Drop, Warning, Wind } from "@phosphor-icons/react";
import { timeAgo } from "@/lib/relativeTime";
import { useWeather } from "@/lib/useWeather";

function subscribeMinute(onChange: () => void) {
  const id = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(id);
}

export function WeatherStrip({ lat, lon }: { lat: number; lon: number }) {
  const { weather, error } = useWeather(lat, lon);
  const ago = useSyncExternalStore(
    subscribeMinute,
    () => weather ? timeAgo(weather.updatedAt, new Date()) : "",
    () => "",
  );
  const expired = useSyncExternalStore(subscribeMinute, () => weather ? Date.parse(weather.validTo) <= Date.now() : false, () => false);
  const forecastURL = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
  return (
    <div aria-label="Local weather" className="glass pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs lg:min-h-[60px] lg:gap-x-5 lg:px-4 lg:py-3 lg:text-[13px]">
      {!weather || expired ? (
        <span role="status">{error ?? (expired ? "Weather forecast expired. Refreshing shortly." : "Loading NWS weather?")}</span>
      ) : (
        <>
          <span className="inline-flex items-center gap-2">
            <Wind size={16} aria-hidden="true" />
            <span className="num">{weather.windMph === null ? "Wind unavailable" : `${weather.windDir ?? ""} up to ${weather.windMph} mph`.trim()}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <Drop size={16} aria-hidden="true" />
            <span>{weather.humidityPct === null ? "Humidity unavailable" : `${weather.humidityPct}% humidity`}</span>
          </span>
          {weather.redFlag === true ? (
            <span className="inline-flex items-center gap-2 font-semibold text-high-ink">
              <Warning size={16} weight="fill" aria-hidden="true" />Red Flag Warning
            </span>
          ) : <span className="text-ink-2">{weather.redFlag === null ? "Red Flag alerts unavailable" : "No active Red Flag Warning"}</span>}
          {weather.temperatureF !== null && <span>{weather.temperatureF}?F{weather.shortForecast ? ` ? ${weather.shortForecast}` : ""}</span>}
          <span className="text-ink-2">Hourly forecast{ago ? ` ? issued ${ago}` : ""}</span>
        </>
      )}
      <a href={forecastURL} target="_blank" rel="noreferrer" className="underline underline-offset-2">National Weather Service</a>
    </div>
  );
}
