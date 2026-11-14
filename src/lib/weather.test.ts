import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NWS_USER_AGENT, getWeather, weatherCoordinates } from "./weather";

const NOW = Date.parse("2026-11-14T12:30:00Z");
const hourly = "https://api.weather.gov/gridpoints/LOX/40,70/forecast/hourly";
const period = { startTime: "2026-11-14T12:00:00Z", endTime: "2026-11-14T13:00:00Z", windSpeed: "5 to 10 mph", windDirection: "NW", relativeHumidity: { value: 45 }, temperature: 20, temperatureUnit: "C", shortForecast: "Sunny" };
function mockNws(options: { alertFailure?: boolean; alerts?: unknown[]; period?: object; url?: string } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input);
    if (url.includes("/points/")) return Response.json({ properties: { forecastHourly: options.url ?? hourly } });
    if (url.includes("/alerts/")) return options.alertFailure ? new Response("down", { status: 503 }) : Response.json({ type: "FeatureCollection", features: options.alerts ?? [] });
    return Response.json({ properties: { updateTime: "2026-11-14T12:00:00Z", periods: [options.period ?? period] } });
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("NWS weather", () => {
  it("normalizes forecasts and preserves active alert GeoJSON with application headers", async () => {
    vi.stubEnv("NWS_USER_AGENT", "");
    const geometry = { type: "Polygon", coordinates: [[[-121, 35], [-120, 35], [-121, 36], [-121, 35]]] };
    const fetcher = mockNws({ alerts: [{ type: "Feature", geometry, properties: { event: "Red Flag Warning", status: "Actual", expires: "2026-11-14T14:00:00Z" } }] });
    const result = await getWeather(35.28, -120.66, NOW);
    expect(result.features[0].geometry.coordinates).toEqual([-120.66, 35.28]);
    expect(result.features[0].properties).toMatchObject({ windMph: 10, humidityPct: 45, temperatureF: 68, redFlag: true });
    expect(result.features[1].geometry).toEqual(geometry);
    for (const [, init] of fetcher.mock.calls) expect(init?.headers).toEqual({ "User-Agent": DEFAULT_NWS_USER_AGENT, Accept: "application/geo+json" });
  });
  it("uses configured User-Agent and treats an alert failure as unknown", async () => {
    vi.stubEnv("NWS_USER_AGENT", "FireBlock (https://example.org/support)");
    const fetcher = mockNws({ alertFailure: true });
    expect((await getWeather(35, -120, NOW)).features[0].properties.redFlag).toBeNull();
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "User-Agent": "FireBlock (https://example.org/support)" });
  });
  it("does not count expired, future, cancelled or test alerts", async () => {
    const properties = { event: "Red Flag Warning", status: "Actual", expires: "2026-11-14T14:00:00Z" };
    mockNws({ alerts: [
      { properties: { ...properties, expires: "2026-11-14T11:00:00Z" } },
      { properties: { ...properties, onset: "2026-11-14T13:00:00Z" } },
      { properties: { ...properties, messageType: "Cancel" } },
      { properties: { ...properties, status: "Test" } },
    ] });
    expect((await getWeather(35, -120, NOW)).features[0].properties.redFlag).toBe(false);
  });
  it("retains missing weather values as unknown", async () => {
    mockNws({ period: { ...period, windSpeed: null, relativeHumidity: { value: null }, temperature: null } });
    expect((await getWeather(35, -120, NOW)).features[0].properties).toMatchObject({ windMph: null, humidityPct: null, temperatureF: null });
  });
  it("rejects expired forecast periods", async () => {
    mockNws();
    await expect(getWeather(35, -120, NOW + 3600000)).rejects.toThrow("no current hourly forecast");
  });
  it("never follows a forecast URL outside NWS", async () => {
    const fetcher = mockNws({ url: "https://example.com/forecast" });
    await expect(getWeather(35, -120, NOW)).rejects.toThrow("unsupported forecast address");
    expect(fetcher.mock.calls.every(([input]) => String(input).startsWith("https://api.weather.gov/"))).toBe(true);
  });
  it.each(["", "lat=hello&lon=-120", "lat=91&lon=0", "lat=35&lon=181", "lat=&lon=0"])("rejects invalid coordinates: %s", query => {
    expect(() => weatherCoordinates(new URLSearchParams(query))).toThrow("valid latitude");
  });
  it("rounds coordinates for bounded cache keys", () => {
    expect(weatherCoordinates(new URLSearchParams("lat=35.2828123&lon=-120.6596123"))).toEqual({ lat: 35.2828, lon: -120.6596 });
  });
});
