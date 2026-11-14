import type { Block, Factor, Property } from "./types";

// All values below are SAMPLE data cached Nov 13, 2026, not live measurements.
const CACHED_AT = "2026-11-13T07:00:00-08:00";

type Pair = [points: number, reason: string];
interface FactorInput {
  weather: Pair;
  fuel: Pair;
  slope: Pair;
  hazard: Pair;
  history: Pair;
}

function factors(i: FactorInput): Factor[] {
  const f = (
    key: Factor["key"],
    label: string,
    max: number,
    [points, reason]: Pair,
    source: string,
  ): Factor => ({ key, label, points, max, reason, source, asOf: CACHED_AT });
  return [
    f("fireWeather", "Fire weather", 35, i.weather, "Fire weather forecast"),
    f("fuelDryness", "Fuel dryness", 25, i.fuel, "Pacific Veg Map and dryness index"),
    f("slope", "Slope", 15, i.slope, "Terrain data"),
    f("hazardZone", "Fire hazard zone", 15, i.hazard, "CAL FIRE hazard zones"),
    f("fireHistory", "Fire history", 10, i.history, "Recorded fire perimeters"),
  ];
}

// Grid of rectangular blocks: each cell is ~160 m x 130 m (about 5 acres).
const W = 0.0018;
const H = 0.0012;
const GAP = 0.0002;
function cell(lat0: number, lng0: number, col: number, row: number): [number, number][] {
  const lat = lat0 + row * (H + GAP);
  const lng = lng0 + col * (W + GAP);
  return [
    [lat, lng],
    [lat, lng + W],
    [lat + H, lng + W],
    [lat + H, lng],
  ];
}

const ADEL = { lat: 35.6905, lng: -120.8105 };
const adelWeather: Pair = [24, "Sample forecast: gusty wind near 22 mph and humidity near 14%."];
const adelHazard = (pts: number): Pair => [pts, "CAL FIRE rates this area high fire hazard."];
const adelHistory = (pts: number): Pair => [
  pts,
  "A past fire perimeter sits about 4 miles away (sample data).",
];

const adelaidaBlocks: Block[] = [
  {
    id: "adelaida-1",
    name: "Cabernet East",
    kind: "vine",
    acres: 5.5,
    polygon: cell(ADEL.lat, ADEL.lng, 0, 1),
    summary: "Moderate risk. Fire weather is the main driver; recent mowing holds the fuel score down.",
    reason: "Mowed in October, but this week's wind keeps it a watch block.",
    factors: factors({
      weather: adelWeather,
      fuel: [10, "Cover crop was mowed in October, so less dry material is standing."],
      slope: [5, "Gentle 4% grade, so fire would not run fast here."],
      hazard: adelHazard(6),
      history: adelHistory(4),
    }),
  },
  {
    id: "adelaida-2",
    name: "Creek Bottom",
    kind: "vine",
    acres: 5,
    polygon: cell(ADEL.lat, ADEL.lng, 1, 1),
    summary: "Low risk. Irrigated and green, so there is little dry fuel to burn.",
    reason: "Irrigated and green, so there is little dry fuel.",
    factors: factors({
      weather: adelWeather,
      fuel: [3, "Rows are irrigated and green, with almost no dry cover."],
      slope: [2, "Nearly flat ground."],
      hazard: adelHazard(3),
      history: adelHistory(1),
    }),
  },
  {
    id: "adelaida-3",
    name: "Ridge Top",
    kind: "vine",
    acres: 6,
    polygon: cell(ADEL.lat, ADEL.lng, 2, 1),
    summary: "High risk. Tall dry cover crop, a steep uphill slope and a windy week are driving this score.",
    reason: "Tall dry cover crop on a steep slope, with wind this week.",
    factors: factors({
      weather: adelWeather,
      fuel: [22, "Tall cover crop has dried out between the rows."],
      slope: [12, "A 14% grade, so fire would run uphill faster."],
      hazard: adelHazard(12),
      history: adelHistory(8),
    }),
  },
  {
    id: "adelaida-4",
    name: "Old Vine Row",
    kind: "vine",
    acres: 5.5,
    polygon: cell(ADEL.lat, ADEL.lng, 0, 0),
    summary: "Moderate risk. Some dry cover remains and the slope adds to it.",
    reason: "Patches of dry cover crop left in the rows.",
    factors: factors({
      weather: adelWeather,
      fuel: [14, "Patches of dry cover crop are still standing in the rows."],
      slope: [7, "A 9% grade, moderate for fire spread."],
      hazard: adelHazard(8),
      history: adelHistory(5),
    }),
  },
  {
    id: "adelaida-5",
    name: "South Slope",
    kind: "vine",
    acres: 5,
    polygon: cell(ADEL.lat, ADEL.lng, 1, 0),
    summary: "High risk. Dry cover crop on a slope, and it sits next to the habitat zone.",
    reason: "Dry cover crop on a slope, next to the habitat zone.",
    factors: factors({
      weather: adelWeather,
      fuel: [19, "Dry cover crop covers most of the row middles."],
      slope: [10, "An 11% grade that funnels fire uphill."],
      hazard: adelHazard(12),
      history: adelHistory(6),
    }),
  },
  {
    id: "adelaida-habitat",
    name: "Oak woodland habitat",
    kind: "habitat",
    acres: 5.5,
    polygon: cell(ADEL.lat, ADEL.lng, 2, 0),
    summary: "Protected habitat. Not scored and never mowed.",
    reason: "Protected habitat: do not mow.",
    factors: [],
  },
];

const PASO = { lat: 35.628, lng: -120.58 };
const pasoWeather: Pair = [20, "Sample forecast: breezy afternoons near 15 mph, humidity near 22%."];
const pasoHazard = (pts: number): Pair => [pts, "CAL FIRE rates this area moderate to high fire hazard."];
const pasoHistory = (pts: number): Pair => [
  pts,
  "The nearest past fire perimeter is about 11 miles away (sample data).",
];

const pasoBlocks: Block[] = [
  {
    id: "paso-1",
    name: "Highway Edge",
    kind: "vine",
    acres: 6,
    polygon: cell(PASO.lat, PASO.lng, 0, 0),
    summary: "Moderate risk. Dry grass along the highway edge raises the fuel score.",
    reason: "Dry grass along the highway edge.",
    factors: factors({
      weather: pasoWeather,
      fuel: [15, "Dry grass is standing along the highway side of the block."],
      slope: [7, "A gentle 6% grade."],
      hazard: pasoHazard(9),
      history: pasoHistory(4),
    }),
  },
  {
    id: "paso-2",
    name: "Zinfandel Flats",
    kind: "vine",
    acres: 5,
    polygon: cell(PASO.lat, PASO.lng, 1, 0),
    summary: "Moderate risk. Cover crop is drying but the ground is flat.",
    reason: "Cover crop is drying out on flat ground.",
    factors: factors({
      weather: pasoWeather,
      fuel: [10, "Cover crop is starting to dry in the row middles."],
      slope: [4, "Nearly flat ground."],
      hazard: pasoHazard(9),
      history: pasoHistory(2),
    }),
  },
  {
    id: "paso-3",
    name: "Syrah North",
    kind: "vine",
    acres: 4.5,
    polygon: cell(PASO.lat, PASO.lng, 0, 1),
    summary: "Low risk. Recently mowed and irrigated.",
    reason: "Mowed last week and irrigated.",
    factors: factors({
      weather: pasoWeather,
      fuel: [5, "Mowed last week, so very little dry material is standing."],
      slope: [2, "Flat ground."],
      hazard: pasoHazard(4),
      history: pasoHistory(1),
    }),
  },
  {
    id: "paso-habitat",
    name: "Creek habitat",
    kind: "habitat",
    acres: 5,
    polygon: cell(PASO.lat, PASO.lng, 1, 1),
    summary: "Protected habitat. Not scored and never mowed.",
    reason: "Protected habitat: do not mow.",
    factors: [],
  },
];

const EDNA = { lat: 35.225, lng: -120.585 };
const ednaWeather: Pair = [8, "Sample forecast: light wind near 6 mph, cool and humid, with humidity near 55%."];
const ednaHazard = (pts: number): Pair => [pts, "CAL FIRE rates this area low to moderate fire hazard."];
const ednaHistory = (pts: number): Pair => [
  pts,
  "No recorded fire perimeter within 15 miles (sample data).",
];

const ednaBlocks: Block[] = [
  {
    id: "edna-1",
    name: "Chardonnay Terrace",
    kind: "vine",
    acres: 5,
    polygon: cell(EDNA.lat, EDNA.lng, 0, 0),
    summary: "Low risk. Green cover crop and calm, humid weather.",
    reason: "Green cover crop and calm, humid weather.",
    factors: factors({
      weather: ednaWeather,
      fuel: [4, "Cover crop is still green."],
      slope: [3, "A gentle 3% grade."],
      hazard: ednaHazard(3),
      history: ednaHistory(1),
    }),
  },
  {
    id: "edna-2",
    name: "Pinot Slope",
    kind: "vine",
    acres: 5.5,
    polygon: cell(EDNA.lat, EDNA.lng, 1, 0),
    summary: "Low risk. A little dry grass at the edge, but everything else is calm.",
    reason: "A little dry grass at the edge, otherwise calm.",
    factors: factors({
      weather: ednaWeather,
      fuel: [6, "A strip of dry grass at the block edge."],
      slope: [5, "A 7% grade."],
      hazard: ednaHazard(4),
      history: ednaHistory(2),
    }),
  },
  {
    id: "edna-3",
    name: "Home Block",
    kind: "vine",
    acres: 4.5,
    polygon: cell(EDNA.lat, EDNA.lng, 0, 1),
    summary: "Low risk. Recently mowed, flat and irrigated.",
    reason: "Recently mowed, flat and irrigated.",
    factors: factors({
      weather: ednaWeather,
      fuel: [3, "Mowed recently, with little dry material."],
      slope: [2, "Flat ground."],
      hazard: ednaHazard(3),
      history: ednaHistory(1),
    }),
  },
];

const centerOf = (o: { lat: number; lng: number }, cols: number, rows: number): [number, number] => [
  o.lat + (rows * (H + GAP)) / 2,
  o.lng + (cols * (W + GAP)) / 2,
];

export const properties: Property[] = [
  {
    id: "adelaida-hills",
    name: "Adelaida Hills",
    center: centerOf(ADEL, 3, 2),
    weather: { windMph: 22, windDir: "NW", humidityPct: 14, redFlag: true, updatedAt: CACHED_AT },
    blocks: adelaidaBlocks,
    activeFires25mi: 0,
    cachedAt: CACHED_AT,
  },
  {
    id: "paso-hwy-46-east",
    name: "Paso Hwy 46 East",
    center: centerOf(PASO, 2, 2),
    weather: { windMph: 15, windDir: "W", humidityPct: 22, redFlag: false, updatedAt: CACHED_AT },
    blocks: pasoBlocks,
    activeFires25mi: 0,
    cachedAt: CACHED_AT,
  },
  {
    id: "edna-valley",
    name: "Edna Valley",
    center: centerOf(EDNA, 2, 2),
    weather: { windMph: 6, windDir: "SW", humidityPct: 55, redFlag: false, updatedAt: CACHED_AT },
    blocks: ednaBlocks,
    activeFires25mi: 0,
    cachedAt: CACHED_AT,
  },
];
