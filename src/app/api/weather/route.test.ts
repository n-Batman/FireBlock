import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { getWeather, WeatherError } from "@/lib/weather";
vi.mock("@/lib/weather", async original => ({ ...await original<typeof import("@/lib/weather")>(), getWeather: vi.fn() }));
beforeEach(() => { vi.mocked(getWeather).mockReset(); });
describe("weather route", () => {
  it("returns downloadable GeoJSON", async () => {
    vi.mocked(getWeather).mockResolvedValue({ type: "FeatureCollection", features: [] } as unknown as Awaited<ReturnType<typeof getWeather>>);
    const res = await GET(new Request("http://localhost/api/weather?lat=35.28&lon=-120.66"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/geo+json");
    expect(getWeather).toHaveBeenCalledWith(35.28, -120.66);
  });
  it("rejects bad coordinates before calling NWS", async () => {
    expect((await GET(new Request("http://localhost/api/weather"))).status).toBe(400);
    expect(getWeather).not.toHaveBeenCalled();
  });
  it("returns NWS coverage errors without caching them", async () => {
    vi.mocked(getWeather).mockRejectedValue(new WeatherError("Unavailable here", 404));
    const response = await GET(new Request("http://localhost/api/weather?lat=0&lon=0"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not expose upstream error details", async () => {
    vi.mocked(getWeather).mockRejectedValue(new Error("private detail"));
    const response = await GET(new Request("http://localhost/api/weather?lat=35&lon=-120"));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private detail");
  });
});
