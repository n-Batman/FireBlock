export type Level = "low" | "medium" | "high";

export type FactorKey =
  | "fireWeather"
  | "fuelDryness"
  | "slope"
  | "hazardZone"
  | "fireHistory"
  | "photoScan";

export interface Factor {
  key: FactorKey;
  label: string;
  points: number;
  max: number;
  /** Plain-words reason this factor added its points. */
  reason: string;
  source: string;
  /** ISO timestamp of the cached data. */
  asOf: string;
}

export interface Block {
  id: string;
  name: string;
  kind: "vine" | "habitat";
  acres: number;
  /** [lat, lng] corners. */
  polygon: [number, number][];
  /** Empty for habitat blocks: they are never scored. */
  factors: Factor[];
  /** One sentence shown at the top of the breakdown. */
  summary: string;
  /** One plain-words line shown under the block in the rail. */
  reason: string;
}

export interface Weather {
  windMph: number;
  /** Compass direction the wind blows from, for example "NW". */
  windDir: string;
  humidityPct: number;
  /** True while a Red Flag Warning is in effect for the property's weather zone. */
  redFlag: boolean;
  /** ISO timestamp of the forecast. */
  updatedAt: string;
}

export interface Property {
  id: string;
  name: string;
  center: [number, number];
  blocks: Block[];
  activeFires25mi: number;
  weather: Weather;
  /** ISO timestamp the sample data was cached. */
  cachedAt: string;
}

/** A ring of [lat, lng] points. GeoJSON is [lon, lat]; only `toParcelUnits` flips it. */
export type Ring = [number, number][];
/** One polygon part: the outer ring first, then any holes. */
export type PolygonRings = Ring[];

/** Where a parcel's score came from. A parcel with no source has no score. */
export type ScoreSource =
  | { kind: "scan"; at: string; risks: number; clears: number }
  /** `coverage` is the share of the parcel (0 to 1) that scored cells cover. */
  | { kind: "risk-map"; asOf: string; modelId: string; coverage: number };

export interface ParcelScore {
  score: number;
  level: Level;
  source: ScoreSource;
}

/** A county parcel as a unit on the map. Replaces the sample `Block` when a real place is chosen. */
export interface ParcelUnit {
  /** The parcel id (APN) from the county service. */
  id: string;
  /** One part per Polygon, or per piece of a MultiPolygon. Holes are kept. */
  parts: PolygonRings[];
  /** Computed from the geometry, not read from the county. */
  acres: number;
  /** [lat, lng] of a point inside the parcel, for its label. */
  center: [number, number];
  /** Null means "Not scored yet". Never filled in with a guess. */
  score: ParcelScore | null;
  /** True for the parcel the searched point is inside, so it can be listed first. */
  atPoint?: boolean;
}

/** An AI scan saved with the device's location, so it can be placed inside a parcel. */
export interface ParcelScan {
  lat: number;
  lon: number;
  risks: number;
  clears: number;
  /** ISO timestamp of the scan. */
  at: string;
}

export type Severity = "risk" | "clear";

/** One thing the scanner found in a camera frame. */
export interface Finding {
  /** Short name, for example "Dry growth". */
  label: string;
  severity: Severity;
  /** What to do about it, for example "Mow by June 1". */
  action: string;
  /** [xmin, ymin, xmax, ymax], each 0 to 999, relative to the frame that was sent. */
  bbox: [number, number, number, number];
  /** How sure the model is, 0 to 1. The canned demo clip has none. */
  confidence?: number;
}

/** Body of a successful POST /api/scan response. */
export interface ScanResponse {
  findings: Finding[];
}

/**
 * JSON Schema for ScanResponse, ready for OpenAI structured outputs
 * (Responses API, text.format type "json_schema", strict true).
 */
export const SCAN_JSON_SCHEMA = {
  name: "scan_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "severity", "action", "bbox", "confidence"],
          properties: {
            label: { type: "string" },
            severity: { type: "string", enum: ["risk", "clear"] },
            action: { type: "string" },
            bbox: {
              type: "array",
              description: "[xmin, ymin, xmax, ymax], integers 0 to 999",
              items: { type: "integer" },
            },
            confidence: { type: "number", description: "How sure you are, 0 to 1" },
          },
        },
      },
    },
  },
} as const;
