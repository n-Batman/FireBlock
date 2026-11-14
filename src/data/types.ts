export type Level = "low" | "medium" | "high";

export type FactorKey =
  | "fireWeather"
  | "fuelDryness"
  | "slope"
  | "hazardZone"
  | "fireHistory";

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

export interface Property {
  id: string;
  name: string;
  center: [number, number];
  blocks: Block[];
  activeFires25mi: number;
  /** ISO timestamp the sample data was cached. */
  cachedAt: string;
}
