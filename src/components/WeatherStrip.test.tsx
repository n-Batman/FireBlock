import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeatherStrip } from "./WeatherStrip";
import { useWeather } from "@/lib/useWeather";
vi.mock("@/lib/useWeather", () => ({ useWeather: vi.fn() }));
const weather = { kind: "forecast" as const, source: "National Weather Service" as const, windMph: 12, windDir: "NW", humidityPct: 20, temperatureF: 70, shortForecast: "Sunny", redFlag: true, updatedAt: new Date().toISOString(), validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 3600000).toISOString() };
describe("live weather strip", () => {
  it("uses the map location and displays live weather without sample fire counts", () => {
    vi.mocked(useWeather).mockReturnValue({ weather, error: null });
    render(<WeatherStrip lat={35.28} lon={-120.66} />);
    expect(useWeather).toHaveBeenCalledWith(35.28, -120.66);
    expect(screen.getByText(/12 mph/)).toBeInTheDocument();
    expect(screen.getByText("Red Flag Warning")).toBeInTheDocument();
    expect(screen.queryByText(/fires within/)).toBeNull();
    expect(screen.getByRole("link", { name: "National Weather Service" })).toHaveAttribute("href", "https://forecast.weather.gov/MapClick.php?lat=35.28&lon=-120.66");
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
