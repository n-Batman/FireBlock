const KEYLESS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const KEYED =
  "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";

/** Esri World Imagery. Uses the ArcGIS key when there is one, the keyless tiles otherwise. */
export function tileSource(key?: string): { url: string; attribution: string } {
  const token = key?.trim();
  return {
    url: token ? `${KEYED}?token=${encodeURIComponent(token)}` : KEYLESS,
    attribution: ATTRIBUTION,
  };
}
