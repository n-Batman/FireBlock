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
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "severity", "action", "bbox"],
          properties: {
            label: { type: "string" },
            severity: { type: "string", enum: ["risk", "clear"] },
            action: { type: "string" },
            bbox: {
              type: "array",
              description: "[xmin, ymin, xmax, ymax], integers 0 to 999",
              items: { type: "integer" },
            },
          },
        },
      },
    },
  },
} as const;
