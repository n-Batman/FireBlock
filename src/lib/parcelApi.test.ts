import { describe, expect, it, vi } from "vitest";
import { lookupParcels, lookupParcelsInView } from "./parcelApi";

const square = (lon: number, lat: number, w: number) => [
  [lon, lat], [lon + w, lat], [lon + w, lat + w], [lon, lat + w], [lon, lat],
];
const body = (truncated = false) => ({
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: [square(-120.86, 35.63, 0.004)] }, properties: { parcelId: "014-331-010", source: "s", fetchedAt: "t" } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [square(-120.85, 35.63, 0.004)] }, properties: { parcelId: "014-331-011", source: "s", fetchedAt: "t" } },
  ],
  metadata: { source: "s", truncated, limit: 200, fetchedAt: "t", note: "n" },
});
const reply = (json: unknown, status = 200) => ({ ok: status < 400, status, json: async () => json });

describe("lookupParcels", () => {
  it("asks his /api/parcels for the point with a 300 metre radius", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(body()));
    await lookupParcels(35.6363, -120.8597, { fetcher });
    const url = new URL(fetcher.mock.calls[0][0] as string, "http://localhost");
    expect(url.pathname).toBe("/api/parcels");
    expect(url.searchParams.get("lat")).toBe("35.6363");
    expect(url.searchParams.get("lon")).toBe("-120.8597");
    expect(url.searchParams.get("radius")).toBe("300");
  });

  it("returns the parcels as map units, flipped to [lat, lng]", async () => {
    const result = await lookupParcels(35.6363, -120.8597, { fetcher: vi.fn().mockResolvedValue(reply(body())) });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.units.map((u) => u.id)).toEqual(["014-331-010", "014-331-011"]);
    expect(result.units[0].parts[0][0][0]).toEqual([35.63, -120.86]);
    expect(result.units[0].score).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("marks the parcel the point is inside, and only that one", async () => {
    // 35.632, -120.858 is inside the first square (-120.86 to -120.856) and not the second.
    const result = await lookupParcels(35.632, -120.858, { fetcher: vi.fn().mockResolvedValue(reply(body())) });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.units.map((u) => [u.id, u.atPoint === true])).toEqual([
      ["014-331-010", true],
      ["014-331-011", false],
    ]);
  });

  it("says so when the county cut the list off", async () => {
    const result = await lookupParcels(35.6363, -120.8597, { fetcher: vi.fn().mockResolvedValue(reply(body(true))) });
    expect(result).toMatchObject({ kind: "ok", truncated: true });
  });

  describe("when the county cuts the list off", () => {
    const pointBody = (...ids: string[]) => ({
      ...body(false),
      features: ids.map((id) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [square(-120.859, 35.631, 0.001)] },
        properties: { parcelId: id, source: "s", fetchedAt: "t" },
      })),
    });
    /** The first call is the 300 m search, the second (no radius) is the exact point. */
    const twoCalls = (second: () => Promise<unknown>) =>
      vi.fn().mockResolvedValueOnce(reply(body(true))).mockImplementationOnce(second);

    it("also asks for the parcel at the exact point, and puts it first so it is never missing", async () => {
      const fetcher = twoCalls(async () => reply(pointBody("AT-THE-POINT")));
      const result = await lookupParcels(35.6363, -120.8597, { fetcher });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.units.map((u) => u.id)).toEqual(["AT-THE-POINT", "014-331-010", "014-331-011"]);
      expect(result.truncated).toBe(true);
      const second = new URL(fetcher.mock.calls[1][0] as string, "http://localhost");
      expect(second.searchParams.get("lat")).toBe("35.6363");
      expect(second.searchParams.get("lon")).toBe("-120.8597");
      expect(second.searchParams.has("radius")).toBe(false);
    });

    it("does not list a parcel twice when it is in both answers", async () => {
      const fetcher = twoCalls(async () => reply(pointBody("014-331-011")));
      const result = await lookupParcels(35.6363, -120.8597, { fetcher });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.units.map((u) => u.id)).toEqual(["014-331-011", "014-331-010"]);
    });

    it("keeps the list it has when the exact-point lookup fails", async () => {
      const fetcher = twoCalls(async () => reply({ error: "down" }, 502));
      const result = await lookupParcels(35.6363, -120.8597, { fetcher });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.units.map((u) => u.id)).toEqual(["014-331-010", "014-331-011"]);
    });

    it("makes only one request when the list was not cut off", async () => {
      const fetcher = vi.fn().mockResolvedValue(reply(body(false)));
      await lookupParcels(35.6363, -120.8597, { fetcher });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it("asks for the map view's bbox, and skips a view over 25 km2", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(body()));
    await lookupParcelsInView({ west: -120.86, south: 35.63, east: -120.85, north: 35.64 }, { fetcher });
    const url = new URL(fetcher.mock.calls[0][0] as string, "http://localhost");
    expect(url.searchParams.get("bbox")).toBe("-120.86,35.63,-120.85,35.64");
    expect(url.searchParams.has("lat")).toBe(false);

    const wide = { west: -121, south: 35, east: -120, north: 36 }; // thousands of km2
    expect(await lookupParcelsInView(wide, { fetcher })).toEqual({ kind: "too-wide" });
    expect(fetcher).toHaveBeenCalledTimes(1); // the wide view never reached the API
  });

  it('does not request parcel boundaries for an overview zoom even in a small city viewport',async()=>{
    const fetcher=vi.fn();
    expect(await lookupParcelsInView({west:-120.86,south:35.63,east:-120.85,north:35.64,zoom:16},{fetcher})).toEqual({kind:'too-wide'});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not call the API outside SLO County", async () => {
    const fetcher = vi.fn();
    expect(await lookupParcels(36.6777, -121.6555, { fetcher })).toEqual({ kind: "outside" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("explains a 502 from the county in plain words", async () => {
    const result = await lookupParcels(35.6363, -120.8597, {
      fetcher: vi.fn().mockResolvedValue(reply({ error: "Parcel provider is unavailable" }, 502)),
    });
    expect(result).toEqual({ kind: "error", message: "The county parcel service is not answering. Try again in a moment." });
  });

  it("passes on his message for a bad request", async () => {
    const result = await lookupParcels(35.6363, -120.8597, {
      fetcher: vi.fn().mockResolvedValue(reply({ error: "radius must be 0–2000 metres" }, 400)),
    });
    expect(result).toEqual({ kind: "error", message: "radius must be 0–2000 metres" });
  });

  it("explains a network failure in plain words", async () => {
    const result = await lookupParcels(35.6363, -120.8597, { fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    expect(result).toEqual({ kind: "error", message: "Could not reach the parcel service. Check your connection." });
  });

  it("lets an abort through so a stale lookup can be dropped", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const pending = lookupParcels(35.6363, -120.8597, { fetcher, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
