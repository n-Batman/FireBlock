// Verbatim from the user's "Data & limits" text. Do not reword.
// Hard-wrapped lines in the source are joined with a single space.
export const DATA_LIMITS = {
  title: "Data & limits",
  sections: [
    {
      heading: "What this score uses:",
      items: [
        "Vegetation and fuel: Pacific Veg Map, fine-scale mapping for SLO County (interim data, final maps expected 2026)",
        "Fire hazard zones: CAL FIRE",
        "Weather: fire weather forecast, updated daily",
        "Fire history: recorded perimeters near this property",
      ],
    },
    {
      heading: "What it does not do:",
      items: [
        "This is an estimate to help you decide where to work first. It is not a fire prediction.",
        "Map data can be months old. Dry grass on the ground today may not match the map. Walking the rows and the photo scan correct the score.",
        "Demo version: 3 properties. Scores use sample values that stand in for the live data feed, cached Nov 13, 2026.",
      ],
    },
  ],
} as const;
