import { describe, expect, it, vi } from "vitest";
import { properties } from "@/data/properties";
import { NO_BLOCKS_MESSAGE, OUTSIDE_COUNTY_MESSAGE } from "@/content/placeMessages";
import { labelPoint } from "./geo";
import { GeocodeError, insideSlo, locate, noticeFor, SLO_EXTENT, suggest } from "./geocode";

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const urlOf = (fetcher: ReturnType<typeof vi.fn>) => new URL(fetcher.mock.calls[0][0] as string);

describe("suggest", () => {
  it("asks ArcGIS for suggestions limited to SLO County, and returns text with its magic key", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({ suggestions: [{ text: "Tablas Creek Vineyard, 9339 Adelaida Rd, Paso Robles, CA", magicKey: "k1", isCollection: false }] }),
    );
    const out = await suggest("Tablas Creek", { fetcher });
    expect(out).toEqual([{ text: "Tablas Creek Vineyard, 9339 Adelaida Rd, Paso Robles, CA", magicKey: "k1" }]);
    const url = urlOf(fetcher);
    expect(url.pathname).toContain("/GeocodeServer/suggest");
    expect(url.searchParams.get("text")).toBe("Tablas Creek");
    expect(url.searchParams.get("f")).toBe("json");
    expect(url.searchParams.get("searchExtent")).toBe(
      `${SLO_EXTENT.west},${SLO_EXTENT.south},${SLO_EXTENT.east},${SLO_EXTENT.north}`,
    );
  });

  it("uses the ArcGIS key when there is one, and the keyless service when there is not", async () => {
    const keyed = vi.fn().mockResolvedValue(reply({ suggestions: [] }));
    await suggest("Paso", { fetcher: keyed, key: " abc123 " });
    expect(urlOf(keyed).host).toBe("geocode-api.arcgis.com");
    expect(urlOf(keyed).searchParams.get("token")).toBe("abc123");

    const keyless = vi.fn().mockResolvedValue(reply({ suggestions: [] }));
    await suggest("Paso", { fetcher: keyless });
    expect(urlOf(keyless).host).toBe("geocode.arcgis.com");
    expect(urlOf(keyless).searchParams.has("token")).toBe(false);
  });

  it("does not call ArcGIS for fewer than 3 characters", async () => {
    const fetcher = vi.fn();
    expect(await suggest("  ab ", { fetcher })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes the abort signal on so a stale search can be cancelled", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ suggestions: [] }));
    const controller = new AbortController();
    await suggest("Paso Robles", { fetcher, signal: controller.signal });
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("throws a GeocodeError on an HTTP error or an ArcGIS error body", async () => {
    await expect(suggest("Paso Robles", { fetcher: vi.fn().mockResolvedValue(reply({}, false)) })).rejects.toBeInstanceOf(GeocodeError);
    const body = reply({ error: { code: 498, message: "Invalid token" } });
    await expect(suggest("Paso Robles", { fetcher: vi.fn().mockResolvedValue(body) })).rejects.toBeInstanceOf(GeocodeError);
  });
});

describe("locate", () => {
  const suggestion = { text: "1000 Spring St, Paso Robles, CA, 93446, USA", magicKey: "k2" };

  it("turns a suggestion into lat and lon (ArcGIS x is longitude, y is latitude)", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({ candidates: [{ address: "1000 Spring St, Paso Robles", location: { x: -120.690662, y: 35.625394 }, score: 100 }] }),
    );
    expect(await locate(suggestion, { fetcher })).toEqual({
      lat: 35.625394,
      lon: -120.690662,
      label: "1000 Spring St, Paso Robles, CA, 93446, USA",
    });
    const url = urlOf(fetcher);
    expect(url.pathname).toContain("/GeocodeServer/findAddressCandidates");
    expect(url.searchParams.get("magicKey")).toBe("k2");
    expect(url.searchParams.get("maxLocations")).toBe("1");
  });

  it("returns null when ArcGIS finds no candidate, and never makes up a location", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ candidates: [] }));
    expect(await locate(suggestion, { fetcher })).toBeNull();
  });

  it("returns null for a candidate with no usable coordinates", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ candidates: [{ location: { x: "NaN", y: null } }] }));
    expect(await locate(suggestion, { fetcher })).toBeNull();
  });
});

describe("insideSlo", () => {
  it("is true for Paso Robles and San Luis Obispo and false for Salinas and Bakersfield", () => {
    expect(insideSlo(35.6254, -120.6907)).toBe(true);
    expect(insideSlo(35.2828, -120.6596)).toBe(true);
    expect(insideSlo(36.6777, -121.6555)).toBe(false);
    expect(insideSlo(35.3733, -119.0187)).toBe(false);
  });
});

describe("noticeFor", () => {
  const place = (lat: number, lon: number) => ({ lat, lon, label: "somewhere" });

  it("says parcel lines cover SLO County only when the place is outside the county", () => {
    expect(noticeFor(place(36.6777, -121.6555), properties)).toBe(OUTSIDE_COUNTY_MESSAGE);
    expect(OUTSIDE_COUNTY_MESSAGE).toBe("Parcel lines cover SLO County only for now.");
  });

  it("says no vineyard blocks are scored when the place is in the county but in none of them", () => {
    expect(noticeFor(place(35.2828, -120.6596), properties)).toBe(NO_BLOCKS_MESSAGE);
    expect(NO_BLOCKS_MESSAGE).toBe("No vineyard blocks scored here yet. Scan the rows to add one.");
  });

  it("says nothing when the place is inside a scored vine block", () => {
    const block = properties[0].blocks.find((b) => b.kind === "vine")!;
    const [lat, lon] = labelPoint(block.polygon);
    expect(noticeFor(place(lat, lon), properties)).toBeNull();
  });

  it("does not count protected habitat as a scored block", () => {
    const habitat = properties[0].blocks.find((b) => b.kind === "habitat")!;
    const [lat, lon] = labelPoint(habitat.polygon);
    expect(noticeFor(place(lat, lon), properties)).toBe(NO_BLOCKS_MESSAGE);
  });
});
