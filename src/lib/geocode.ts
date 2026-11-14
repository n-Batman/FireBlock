/** Rough bounding box of San Luis Obispo County. Address search is limited to it. */
export const SLO_EXTENT = { west: -121.35, south: 34.89, east: -119.44, north: 35.8 } as const;

const KEYED = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer";
const KEYLESS = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

export interface Suggestion {
  text: string;
  magicKey: string;
}
export interface Place {
  lat: number;
  lon: number;
  label: string;
}

/** The part of `fetch` the geocoder uses, so tests can stand in for it. */
export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface Options {
  /** ArcGIS API key (NEXT_PUBLIC_ARCGIS_KEY). Without one, Esri's keyless service is used. */
  key?: string;
  signal?: AbortSignal;
  fetcher?: Fetcher;
}

export class GeocodeError extends Error {}

export const insideSlo = (lat: number, lon: number) =>
  lat >= SLO_EXTENT.south && lat <= SLO_EXTENT.north && lon >= SLO_EXTENT.west && lon <= SLO_EXTENT.east;

async function call(path: string, params: Record<string, string>, { key, signal, fetcher = fetch }: Options) {
  const token = key?.trim();
  const url = new URL(`${token ? KEYED : KEYLESS}/${path}`);
  url.searchParams.set("f", "json");
  url.searchParams.set("countryCode", "USA");
  url.searchParams.set("searchExtent", `${SLO_EXTENT.west},${SLO_EXTENT.south},${SLO_EXTENT.east},${SLO_EXTENT.north}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (token) url.searchParams.set("token", token);

  const res = await fetcher(url.toString(), { signal });
  if (!res.ok) throw new GeocodeError(`The geocoder answered ${res.status}.`);
  const body = (await res.json()) as { error?: { message?: string } } & Record<string, unknown>;
  if (body?.error) throw new GeocodeError(body.error.message ?? "The geocoder returned an error.");
  return body;
}

/** Autocomplete suggestions inside SLO County for what the person has typed so far. */
export async function suggest(text: string, options: Options = {}): Promise<Suggestion[]> {
  const query = text.trim();
  if (query.length < 3) return [];
  const body = await call("suggest", { text: query, maxSuggestions: "6" }, options);
  const list = Array.isArray(body.suggestions) ? (body.suggestions as Record<string, unknown>[]) : [];
  return list
    .filter((s) => typeof s.text === "string" && typeof s.magicKey === "string" && !s.isCollection)
    .map((s) => ({ text: s.text as string, magicKey: s.magicKey as string }));
}

/** The point for a chosen suggestion, or null when the geocoder has none. Never guesses. */
export async function locate(suggestion: Suggestion, options: Options = {}): Promise<Place | null> {
  const body = await call(
    "findAddressCandidates",
    { magicKey: suggestion.magicKey, maxLocations: "1", outFields: "Addr_type" },
    options,
  );
  const candidates = body.candidates as { location?: { x?: unknown; y?: unknown } }[] | undefined;
  const lon = candidates?.[0]?.location?.x;
  const lat = candidates?.[0]?.location?.y;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: suggestion.text };
}
