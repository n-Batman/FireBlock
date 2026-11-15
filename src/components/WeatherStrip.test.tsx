import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeatherStrip } from "./WeatherStrip";
import { useWeather } from "@/lib/useWeather";
import type { LiveWeather } from "@/lib/weatherTypes";
vi.mock("@/lib/useWeather", () => ({ useWeather: vi.fn() }));
const weather: LiveWeather = { kind: "forecast", basis: "forecast", station: null, observedAt: null, source: "National Weather Service", windMph: 12, windDir: "NW", humidityPct: 20, temperatureF: 70, shortForecast: "Sunny", redFlag: true, updatedAt: new Date().toISOString(), validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 3600000).toISOString() };
describe("live weather strip", () => {
  it("uses the map location and displays live weather without sample fire counts", () => {
    const updatedAt = new Date(Date.now() - 12 * 60_000).toISOString();
    vi.mocked(useWeather).mockReturnValue({ weather: { ...weather, updatedAt }, error: null });
    render(<WeatherStrip lat={35.28} lon={-120.66} />);
    expect(useWeather).toHaveBeenCalledWith(35.28, -120.66);
    expect(screen.getByText("NW up to 12 mph")).toBeInTheDocument();
    expect(screen.getByText("70°F · Sunny")).toBeInTheDocument();
    expect(screen.getByText("Hourly forecast · issued 12 min ago")).toBeInTheDocument();
    expect(screen.getByText("Red Flag Warning")).toBeInTheDocument();
    expect(screen.queryByText(/fires within/)).toBeNull();
    expect(screen.getByRole("link", { name: "National Weather Service" })).toHaveAttribute("href", "https://forecast.weather.gov/MapClick.php?lat=35.28&lon=-120.66");
  });
  it("shows the station and reading time for observed conditions", () => {
    const observedAt = new Date(2026, 10, 14, 22, 45).toISOString();
    vi.mocked(useWeather).mockReturnValue({ weather: { ...weather, basis: "observed", station: "KSBP", observedAt, temperatureF: 52, shortForecast: "Clear", windDir: "E", windMph: 3 }, error: null });
    render(<WeatherStrip lat={35.28} lon={-120.66} />);
    expect(screen.getByText("52°F · Clear · KSBP, 10:45 PM")).toBeInTheDocument();
    expect(screen.getByText("E 3 mph")).toBeInTheDocument();
    expect(screen.queryByText(/Hourly forecast/)).toBeNull();
  });
  it("shows the loading ellipsis", () => {
    vi.mocked(useWeather).mockReturnValue({ weather: null, error: null });
    render(<WeatherStrip lat={35.28} lon={-120.66} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading NWS weather…");
  });
  it("does not call unknown alerts a clear day", () => {
    vi.mocked(useWeather).mockReturnValue({ weather: { ...weather, redFlag: null, humidityPct: null }, error: null });
    render(<WeatherStrip lat={35} lon={-120} />);
    expect(screen.getByText("Red Flag alerts unavailable")).toBeInTheDocument();
    expect(screen.getByText("Humidity unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No active Red Flag Warning")).toBeNull();
  });
  it("shows errors without substituting demo weather", () => {
    vi.mocked(useWeather).mockReturnValue({ weather: null, error: "Weather unavailable" });
    render(<WeatherStrip lat={35} lon={-120} />);
    expect(screen.getByRole("status")).toHaveTextContent("Weather unavailable");
    expect(screen.queryByText(/mph/)).toBeNull();
  });
  it("hides an expired forecast", () => {
    vi.mocked(useWeather).mockReturnValue({ weather: { ...weather, validTo: new Date(Date.now() - 60000).toISOString() }, error: null });
    render(<WeatherStrip lat={35} lon={-120} />);
    expect(screen.getByRole("status")).toHaveTextContent("expired");
    expect(screen.queryByText("Red Flag Warning")).toBeNull();
  });
});
