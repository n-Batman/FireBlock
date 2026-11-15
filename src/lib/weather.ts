import type { LiveWeather, WeatherGeoJSON } from "./weatherTypes";

const BASE = "https://api.weather.gov";
export const DEFAULT_NWS_USER_AGENT = "FireBlock/0.1 (https://github.com/n-Batman/FireBlock)";
export class WeatherError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

type ObjectData = Record<string, unknown>;
function object(value: unknown): ObjectData {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectData : {};
}
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function weatherCoordinates(params: URLSearchParams) {
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!params.get("lat")?.trim() || !params.get("lon")?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new WeatherError("Provide valid latitude and longitude.", 400);
  }
  return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
}

async function nws(url: string, revalidate: number, signal: AbortSignal): Promise<ObjectData> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.NWS_USER_AGENT?.trim() || DEFAULT_NWS_USER_AGENT,
      Accept: "application/geo+json",
    },
    next: { revalidate },
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    if (response.status === 404) throw new WeatherError("NWS forecasts are unavailable for this location.", 404);
    throw new WeatherError("National Weather Service is unavailable. Try again shortly.", response.status === 429 ? 503 : 502);
  }
  return object(await response.json());
}

function hourlyURL(value: unknown): string {
  if (typeof value !== "string") throw new WeatherError("NWS did not provide an hourly forecast for this location.");
  const url = new URL(value);
  if (url.origin !== BASE || !/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/.test(url.pathname) || url.search || url.hash) {
    throw new WeatherError("NWS returned an unsupported forecast address.");
  }
  return url.href;
}

function windMph(value: unknown): number | null {
  if (typeof value === "string") {
    if (!/^\d+(?:\s+to\s+\d+)? mph$/.test(value)) return null;
    return Math.max(...value.match(/\d+/g)!.map(Number));
  }
  const quantity = object(value);
  const speed = numeric(quantity.value);
  if (speed === null || speed < 0) return null;
  if (quantity.unitCode === "wmoUnit:km_h-1") return Math.round(speed / 1.609344);
  if (quantity.unitCode === "wmoUnit:m_s-1") return Math.round(speed * 2.236936);
  return quantity.unitCode === "wmoUnit:mi_h-1" ? Math.round(speed) : null;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

async function latestObservation(value: unknown, signal: AbortSignal, now: number) {
  const address = string(value);
  if (!address) return null;
  const url = new URL(address);
  if (url.origin !== BASE || !/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/stations$/.test(url.pathname) || url.search || url.hash) return null;
  const stations = await nws(url.href, 86400, signal);
  const first = Array.isArray(stations.features) ? object(stations.features[0]) : {};
  const station = string(object(first.properties).stationIdentifier);
  if (!station || !/^[A-Z0-9]+$/.test(station)) return null;
  const data = await nws(`${BASE}/stations/${station}/observations/latest`, 300, signal);
  const props = object(data.properties);
  const observedAt = string(props.timestamp);
  if (!observedAt) return null;
  const age = now - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < 0 || age >= 90 * 60_000) return null;

  const temperature = object(props.temperature);
  const celsius = temperature.unitCode === "wmoUnit:degC" ? numeric(temperature.value) : null;
  const humidity = numeric(object(props.relativeHumidity).value);
  const degrees = numeric(object(props.windDirection).value);
  return {
    basis: "observed" as const,
    station,
    observedAt,
    windMph: windMph(props.windSpeed),
    windDir: degrees !== null && degrees >= 0 && degrees <= 360 ? COMPASS[Math.round(degrees / 22.5) % COMPASS.length] : null,
    humidityPct: humidity !== null && humidity >= 0 && humidity <= 100 ? Math.round(humidity) : null,
    temperatureF: celsius === null ? null : Math.round(celsius * 9 / 5 + 32),
    shortForecast: string(props.textDescription),
  };
}

/** NWS GeoJSON in, point weather and active warning geometries out. No sample fallback. */
export async function getWeather(lat: number, lon: number, now = Date.now()): Promise<WeatherGeoJSON> {
  const signal = AbortSignal.timeout(10_000);
  const point = `${lat},${lon}`;
  const location = nws(`${BASE}/points/${point}`, 86400, signal).then(data => object(data.properties));
  const forecastRequest = async () => {
    const data = await nws(hourlyURL((await location).forecastHourly), 300, signal);
    const props = object(data.properties);
    const periods = Array.isArray(props.periods) ? props.periods : [];
    const period = periods.map(object).find(p => Date.parse(String(p.startTime)) <= now && Date.parse(String(p.endTime)) > now);
    if (!period || !Number.isFinite(Date.parse(String(props.updateTime)))) throw new WeatherError("NWS has no current hourly forecast for this location.");
    return { props, period };
  };
  const [forecast, alerts, observation] = await Promise.allSettled([
    forecastRequest(),
    nws(`${BASE}/alerts/active?point=${point}`, 60, signal).then(data => {
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new WeatherError("NWS alerts are unavailable.");
      return data.features.map(object).filter(feature => {
        const p = object(feature.properties);
        return p.status === "Actual" && p.messageType !== "Cancel" && Date.parse(String(p.expires)) > now && (!p.onset || Date.parse(String(p.onset)) <= now);
      });
    }),
    location.then(props => latestObservation(props.observationStations, signal, now)),
  ]);
  if (forecast.status === "rejected") throw forecast.reason;
  const { props, period } = forecast.value;
  const humidity = numeric(object(period.relativeHumidity).value);
  const temperature = numeric(period.temperature);
  const activeAlerts = alerts.status === "fulfilled" ? alerts.value : null;
  const weather: LiveWeather = {
    kind: "forecast",
    basis: "forecast",
    station: null,
    observedAt: null,
    windMph: windMph(period.windSpeed),
    windDir: string(period.windDirection),
    humidityPct: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
    temperatureF: temperature === null ? null : period.temperatureUnit === "F" ? temperature : period.temperatureUnit === "C" ? Math.round(temperature * 9 / 5 + 32) : null,
    shortForecast: string(period.shortForecast),
    redFlag: activeAlerts === null ? null : activeAlerts.some(f => object(f.properties).event === "Red Flag Warning"),
    updatedAt: String(props.updateTime),
    validFrom: String(period.startTime),
    validTo: String(period.endTime),
    source: "National Weather Service",
    ...(observation.status === "fulfilled" ? observation.value : null),
  };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: weather },
      ...(activeAlerts ?? []).map(f => {
        const p = object(f.properties);
        return { type: "Feature" as const, geometry: f.geometry ?? null, properties: { kind: "alert" as const, event: string(p.event) ?? "Weather alert", headline: string(p.headline), expires: string(p.expires) } };
      })],
  };
}
