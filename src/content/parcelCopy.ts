import type { ScoreSource } from "@/data/types";
import { MAX_PARCELS } from "@/lib/parcelDisplayConfig";

// Words on screen for county parcels. A parcel without a score says so. It never gets a guessed one.
export const NOT_SCORED = "Not scored yet. Scan the rows to score it.";
export const NO_PARCELS = "No parcels found within 300 m of that point.";
export const FINDING_PARCELS = "Finding parcels...";
export const ZOOM_IN = "Zoom in to see property lines";
export const TRUNCATED = `Showing up to ${MAX_PARCELS} parcels; more may be available. Zoom in or search a smaller area.`;
export const PLANNING_ONLY = "County GIS outlines for planning, not a boundary survey.";

/** "~12.4 acres", computed from the parcel's geometry. */
export const acresLabel = (acres: number) => `~${acres >= 100 ? Math.round(acres) : acres.toFixed(1)} acres`;

/** "Before 62, after 48": the first and newest scan in a parcel. */
export const BEFORE_AFTER_TITLE = "Before and after";
export const BEFORE_AFTER_RESET = "Start over";
export const SAVE_RESCAN = "Save rescan";

/** Where a score came from, in a few words. */
export function sourceLabel(source: ScoreSource): string {
  return source.kind === "scan"
    ? `Scan: ${source.risks} of ${source.risks + source.clears} areas flagged`
    : `Risk map: ${Math.round(source.coverage * 100)}% of the parcel covered`;
}
