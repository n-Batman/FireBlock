import type { ScoreSource } from "@/data/types";

// Words on screen for county parcels. A parcel without a score says so. It never gets a guessed one.
export const NOT_SCORED = "Not scored yet. Scan the rows to score it.";
export const NO_PARCELS = "No parcels found within 300 m of that point.";
export const FINDING_PARCELS = "Finding parcels...";
export const TRUNCATED = "The county returned its limit of 200 parcels. Zoom in or search a smaller area.";
export const PLANNING_ONLY = "County GIS outlines for planning, not a boundary survey.";

/** "~12.4 acres", computed from the parcel's geometry. */
export const acresLabel = (acres: number) => `~${acres >= 100 ? Math.round(acres) : acres.toFixed(1)} acres`;

/** Where a score came from, in a few words. */
export function sourceLabel(source: ScoreSource): string {
  return source.kind === "scan"
    ? `Scan: ${source.risks} of ${source.risks + source.clears} areas flagged`
    : `Risk map: ${Math.round(source.coverage * 100)}% of the parcel covered`;
}
