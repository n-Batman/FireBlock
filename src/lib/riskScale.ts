/**
 * The colour of a 0 to 100 score, yellow at 0 to red at 100. This is the same arithmetic Nick's parcel
 * display uses for its fill (ParcelOverlay.tsx), so a parcel's pill and chip match its fill. His
 * formula is inline there and is not exported, so it is repeated here; riskScale.test.ts reads his
 * source and fails if the two ever differ.
 */
export function scaleColor(score: number, alpha?: number): string {
  const s = Math.min(100, Math.max(0, score));
  const hue = 45 - s * 0.45;
  const light = 75 - s * 0.38;
  return alpha === undefined ? `hsl(${hue} 75% ${light}%)` : `hsl(${hue} 75% ${light}% / ${alpha})`;
}
