import { describe, it, expect } from "vitest";
import { tileSource } from "./tiles";

const KEYLESS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

describe("tileSource", () => {
  it("uses the Esri keyed service when a key is given", () => {
    const { url } = tileSource("abc123");
    expect(url).toBe(
      "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=abc123",
    );
  });

  it("falls back to the keyless tiles when the key is missing or blank", () => {
    expect(tileSource(undefined).url).toBe(KEYLESS);
    expect(tileSource("").url).toBe(KEYLESS);
    expect(tileSource("   ").url).toBe(KEYLESS);
  });

  it("encodes the key so it cannot break the URL", () => {
    expect(tileSource("a b&c").url).toContain("token=a%20b%26c");
  });

  it("always carries the Esri attribution", () => {
    expect(tileSource("abc123").attribution).toMatch(/Esri/);
    expect(tileSource(undefined).attribution).toMatch(/Esri/);
  });
});
