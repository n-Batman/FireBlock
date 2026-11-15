export const RISK_STOPS = [
  { score: 0, rgb: [239, 246, 156] },
  { score: 8, rgb: [252, 224, 86] },
  { score: 16, rgb: [255, 184, 65] },
  { score: 24, rgb: [249, 137, 42] },
  { score: 32, rgb: [234, 94, 26] },
  { score: 45, rgb: [221, 62, 38] },
  { score: 60, rgb: [196, 36, 36] },
  { score: 75, rgb: [155, 24, 55] },
  { score: 90, rgb: [113, 20, 47] },
] as const;

/** Shared colour scale for absolute risk scores, with more stops where mapped scores cluster. */
export function scaleColor(score: number, alpha?: number): string {
  const s = Math.min(100, Math.max(0, score));
  const index = RISK_STOPS.findIndex(stop => stop.score >= s);
  const upper = RISK_STOPS[index] ?? RISK_STOPS[RISK_STOPS.length - 1];
  const lower = RISK_STOPS[index - 1] ?? upper;
  const progress = lower === upper ? 0 : (s - lower.score) / (upper.score - lower.score);
  const rgb = lower.rgb.map((channel, i) => Math.round(channel + (upper.rgb[i] - channel) * progress)).join(", ");
  return alpha === undefined ? `rgb(${rgb})` : `rgba(${rgb}, ${alpha})`;
}
