import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWeather } from "./useWeather";
const payload = (windMph = 10) => ({ type: "FeatureCollection", features: [{ properties: { kind: "forecast", windMph, validTo: new Date(Date.now() + 3600000).toISOString() } }] });
afterEach(() => { vi.restoreAllMocks(); });
describe("weather connection", () => {
  it("loads for the selected place and clears old weather when it changes", async () => {
    let resolveSecond: (r: Response) => void = () => {};
    const second = new Promise<Response>(resolve => { resolveSecond = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(payload())).mockReturnValueOnce(second);
    const hook = renderHook(({ lat }) => useWeather(lat, -120.66), { initialProps: { lat: 35.28 } });
    await waitFor(() => expect(hook.result.current.weather?.windMph).toBe(10));
    hook.rerender({ lat: 35.6 });
    expect(hook.result.current.weather).toBeNull();
    await act(async () => { resolveSecond(Response.json(payload(20))); });
    expect(hook.result.current.weather?.windMph).toBe(20);
    expect(fetcher.mock.calls[1][0]).toBe("/api/weather?lat=35.6000&lon=-120.6600");
  });
  it("cancels a pending request when the place changes", async () => {
    let resolveOld: (r: Response) => void = () => {};
    const old = new Promise<Response>(resolve => { resolveOld = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(old).mockResolvedValueOnce(Response.json(payload(20)));
    const hook = renderHook(({ lat }) => useWeather(lat, -120), { initialProps: { lat: 35 } });
    const signal = fetcher.mock.calls[0][1]?.signal;
    hook.rerender({ lat: 36 });
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(hook.result.current.weather?.windMph).toBe(20));
    await act(async () => { resolveOld(Response.json(payload(5))); });
    expect(hook.result.current.weather?.windMph).toBe(20);
  });
  it("shows backend errors and retains no sample values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "NWS unavailable" }, { status: 502 }));
    const hook = renderHook(() => useWeather(35, -120));
    await waitFor(() => expect(hook.result.current.error).toBe("NWS unavailable"));
    expect(hook.result.current.weather).toBeNull();
  });
});
