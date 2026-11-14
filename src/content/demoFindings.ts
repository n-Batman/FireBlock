import type { Finding } from "@/data/types";

type BBox = Finding["bbox"];

interface Segment {
  label: string;
  severity: Finding["severity"];
  action: string;
  /** Seconds into the demo video. */
  start: number;
  end: number;
  from: BBox;
  to: BBox;
}

/** Length of /demo/vineyard.mp4 in seconds. Findings loop with the video. */
export const DEMO_DURATION = 24;

// Timed to the demo video so the judges' run is the same every time.
// Retime these when the real footage is dropped in (TASKS.md, M6).
const SEGMENTS: Segment[] = [
  { label: "Dry growth", severity: "risk", action: "Mow by June 1", start: 2, end: 8, from: [120, 520, 420, 820], to: [200, 520, 500, 820] },
  { label: "Brush touching barn", severity: "risk", action: "Cut back 5 ft from the wall", start: 5, end: 13, from: [560, 300, 860, 640], to: [560, 300, 860, 640] },
  { label: "Dry growth", severity: "risk", action: "Mow by June 1", start: 9, end: 16, from: [420, 560, 700, 860], to: [400, 560, 680, 860] },
  { label: "Cleared firebreak", severity: "clear", action: "Keep it trimmed", start: 14, end: 22, from: [60, 700, 940, 940], to: [60, 700, 940, 940] },
];

/** What the scanner finds `t` seconds into the demo video. Boxes drift between their two positions. */
export function demoFindingsAt(t: number): Finding[] {
  const time = ((t % DEMO_DURATION) + DEMO_DURATION) % DEMO_DURATION;
  return SEGMENTS.filter((s) => time >= s.start && time < s.end).map((s) => {
    const progress = (time - s.start) / (s.end - s.start);
    return {
      label: s.label,
      severity: s.severity,
      action: s.action,
      bbox: s.from.map((v, i) => Math.round(v + (s.to[i] - v) * progress)) as BBox,
    };
  });
}
