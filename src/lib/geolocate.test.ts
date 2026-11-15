import { describe, expect, it, vi } from "vitest";
import { currentPosition, LocationError, metresBetween, RESCAN_RADIUS_M } from "./geolocate";

type Success = (p: { coords: { latitude: number; longitude: number } }) => void;
type Failure = (e: { code: number }) => void;
const fake = (run: (ok: Success, fail: Failure) => void) => ({
  getCurrentPosition: vi.fn((ok: Success, fail: Failure) => run(ok, fail)),
});

describe("currentPosition", () => {
  it("resolves with the device's latitude and longitude", async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 35.6363, longitude: -120.8597 } }));
    expect(await currentPosition(geo)).toEqual({ lat: 35.6363, lon: -120.8597 });
  });

  it("asks for a high accuracy fix, with a timeout", async () => {
    const geo = fake((ok) => ok({ coords: { latitude: 35, longitude: -120 } }));
    await currentPosition(geo);
    const options = (geo.getCurrentPosition.mock.calls[0] as unknown[])[2] as { enableHighAccuracy: boolean; timeout: number };
    expect(options.enableHighAccuracy).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("explains a blocked location in plain words", async () => {
    const geo = fake((_ok, fail) => fail({ code: 1 }));
    await expect(currentPosition(geo)).rejects.toThrow(
      "Location access was blocked. Allow location for this site to save a scan to a parcel.",
    );
  });

  it("explains an unavailable location", async () => {
    const geo = fake((_ok, fail) => fail({ code: 2 }));
    await expect(currentPosition(geo)).rejects.toThrow("Your device could not find its location. Try again outdoors.");
  });

  it("explains a timeout", async () => {
    const geo = fake((_ok, fail) => fail({ code: 3 }));
    await expect(currentPosition(geo)).rejects.toThrow("Finding your location took too long. Try again.");
  });

  it("says so when the browser has no location support", async () => {
    await expect(currentPosition(undefined)).rejects.toBeInstanceOf(LocationError);
    await expect(currentPosition(undefined)).rejects.toThrow("This browser cannot share its location.");
  });

  it("rejects a position that is not a real latitude and longitude", async () => {
    const geo = fake((ok) => ok({ coords: { latitude: Number.NaN, longitude: -120 } }));
    await expect(currentPosition(geo)).rejects.toBeInstanceOf(LocationError);
  });
});

describe("metresBetween", () => {
  it("is zero for the same point and about 111 km per degree of latitude", () => {
    const here = { lat: 35.632, lon: -120.853 };
    expect(metresBetween(here, here)).toBe(0);
    expect(metresBetween(here, { lat: here.lat + 1, lon: here.lon })).toBeGreaterThan(111_000);
    expect(metresBetween(here, { lat: here.lat + 1, lon: here.lon })).toBeLessThan(111_400);
  });

  it("tells 12 m from 40 m around the 25 m rescan radius", () => {
    const first = { lat: 35.632, lon: -120.853 };
    const north = (m: number) => ({ lat: first.lat + m / 111_195, lon: first.lon });
    expect(metresBetween(first, north(12))).toBeCloseTo(12, 0);
    expect(metresBetween(first, north(12))).toBeLessThan(RESCAN_RADIUS_M);
    expect(metresBetween(first, north(40))).toBeGreaterThan(RESCAN_RADIUS_M);
    expect(RESCAN_RADIUS_M).toBe(25);
  });
});
