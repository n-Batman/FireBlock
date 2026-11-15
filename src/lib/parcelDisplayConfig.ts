/** Shared server/browser settings; response headers identify the deployed rule. */
/** Legacy combiner threshold; inactive in the individual-only map. */
export const PARCEL_SCREEN_THRESHOLD=.05;
export const PARCEL_DISPLAY_MODE="individual-parcels";
export const MAX_PARCELS=500;

/** Fixed acreage tiers; no screen projection or per-parcel geometry math. */
export function minParcelAcres(zoom=17):number {
  if(!Number.isFinite(zoom)||zoom>=17)return 0;
  if(zoom>=16)return .25;
  if(zoom>=15)return 1;
  if(zoom>=14)return 4;
  if(zoom>=13)return 16;
  return 64;
}
