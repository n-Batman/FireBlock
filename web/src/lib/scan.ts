import type { Block, Factor, Finding } from "@/data/types";
import { scoreOf } from "./score";

export type BBox = Finding["bbox"];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps a 0 to 999 box onto the on-screen video, which `object-fit: cover` crops. */
export function mapBoxToRect(
  bbox: BBox,
  video: { w: number; h: number },
  box: { w: number; h: number },
): Rect {
  const scale = Math.max(box.w / video.w, box.h / video.h);
  const shownW = video.w * scale;
  const shownH = video.h * scale;
  const offsetX = (box.w - shownW) / 2;
  const offsetY = (box.h - shownH) / 2;
  const [x0, y0, x1, y1] = bbox;
  return {
    x: offsetX + (x0 * shownW) / 1000,
    y: offsetY + (y0 * shownH) / 1000,
    width: ((x1 - x0) * shownW) / 1000,
    height: ((y1 - y0) * shownH) / 1000,
  };
}

/** Intersection over union of two boxes, 0 to 1. */
export function iou(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const area = (r: BBox) => (r[2] - r[0]) * (r[3] - r[1]);
  return inter / (area(a) + area(b) - inter);
}

export type ScanStatus = "scanning" | "clear" | "risks";

export interface Track extends Finding {
  id: number;
  /** Frames in a row this box was not seen. */
  missed: number;
}

export interface TrackerState {
  tracks: Track[];
  nextId: number;
  status: ScanStatus;
  pending: ScanStatus | null;
  pendingCount: number;
}

const MATCH_IOU = 0.2;
const EASE = 0.6;
const FLIP_AFTER = 2;
/** A box stays fully visible this many frames after it was last seen. */
export const KEEP_FRAMES = 2;
/** A box is dropped once it has been missing this many frames. */
export const REMOVE_AFTER = 5;

export const createTracker = (): TrackerState => ({
  tracks: [],
  nextId: 1,
  status: "scanning",
  pending: null,
  pendingCount: 0,
});

export const isVisible = (t: Track) => t.missed <= KEEP_FRAMES;

const ease = (from: BBox, to: BBox): BBox =>
  from.map((v, i) => v + (to[i] - v) * EASE) as BBox;

/**
 * Folds one frame of findings into the tracker. Boxes are matched across frames by
 * label and overlap, eased toward their new position, kept for a few missed frames,
 * and the overall status only flips after two consistent frames.
 */
export function updateTracker(
  state: TrackerState,
  findings: Finding[],
): { state: TrackerState; newRisks: Track[] } {
  const pairs: { ti: number; fi: number; overlap: number }[] = [];
  state.tracks.forEach((t, ti) =>
    findings.forEach((f, fi) => {
      if (t.label !== f.label) return;
      const overlap = iou(t.bbox, f.bbox);
      if (overlap >= MATCH_IOU) pairs.push({ ti, fi, overlap });
    }),
  );
  pairs.sort((a, b) => b.overlap - a.overlap);

  const findingForTrack = new Map<number, number>();
  const usedFindings = new Set<number>();
  for (const p of pairs) {
    if (findingForTrack.has(p.ti) || usedFindings.has(p.fi)) continue;
    findingForTrack.set(p.ti, p.fi);
    usedFindings.add(p.fi);
  }

  const tracks: Track[] = state.tracks.map((t, ti) => {
    const fi = findingForTrack.get(ti);
    if (fi === undefined) return { ...t, missed: t.missed + 1 };
    const f = findings[fi];
    return { ...t, severity: f.severity, action: f.action, bbox: ease(t.bbox, f.bbox), missed: 0 };
  });

  let nextId = state.nextId;
  const newRisks: Track[] = [];
  findings.forEach((f, fi) => {
    if (usedFindings.has(fi)) return;
    const track: Track = { ...f, id: nextId++, missed: 0 };
    tracks.push(track);
    if (f.severity === "risk") newRisks.push(track);
  });

  const kept = tracks.filter((t) => t.missed < REMOVE_AFTER);

  // Only boxes seen in this very frame count toward the status.
  const raw: ScanStatus = kept.some((t) => t.missed === 0 && t.severity === "risk") ? "risks" : "clear";
  let { status, pending, pendingCount } = state;
  if (raw === status) {
    pending = null;
    pendingCount = 0;
  } else if (raw === pending) {
    pendingCount += 1;
  } else {
    pending = raw;
    pendingCount = 1;
  }
  if (pending && pendingCount >= FLIP_AFTER) {
    status = pending;
    pending = null;
    pendingCount = 0;
  }

  return { state: { tracks: kept, nextId, status, pending, pendingCount }, newRisks };
}

/** Counts the visible boxes by kind. */
export function summarize(tracks: Track[]): { risks: number; clears: number } {
  const visible = tracks.filter(isVisible);
  return {
    risks: visible.filter((t) => t.severity === "risk").length,
    clears: visible.filter((t) => t.severity === "clear").length,
  };
}

/** Score change from a scan: +6 per risk, -3 per cleared area, kept within -15 and +25. */
export function scanDelta(risks: number, clears: number): number {
  return Math.max(-15, Math.min(25, risks * 6 - clears * 3));
}

/** Adds the scan to a block as its own factor, keeping the score between 0 and 100. */
export function withScan(
  block: Block,
  delta: number,
  asOf: string,
  reason = "The scan checked the rows by camera.",
): Block {
  const base = scoreOf(block);
  const applied = Math.max(-base, Math.min(100 - base, delta));
  if (applied === 0) return block;
  const factor: Factor = {
    key: "photoScan",
    label: "Photo scan",
    points: applied,
    max: 25,
    reason,
    source: "Photo scan",
    asOf,
  };
  return { ...block, factors: [...block.factors, factor] };
}
