export interface LiveWeather {
  kind: "forecast";
  basis: "observed" | "forecast";
  station: string | null;
  observedAt: string | null;
  windMph: number | null;
  windDir: string | null;
  humidityPct: number | null;
  temperatureF: number | null;
  shortForecast: string | null;
  redFlag: boolean | null;
  updatedAt: string;
  validFrom: string;
  validTo: string;
  source: "National Weather Service";
}

export interface WeatherGeoJSON {
  type: "FeatureCollection";
  features: [{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: LiveWeather;
  }, ...{
    type: "Feature";
    geometry: unknown;
    properties: { kind: "alert"; event: string; headline: string | null; expires: string | null };
  }[]];
}
