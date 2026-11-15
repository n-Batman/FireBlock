import type { Finding } from "@/data/types";
import type { FuelMap, Verdict } from "./fuelMask";
import { iou, isVisible, type Rect, type Track } from "./scan";

const MIN_CONFIDENCE = 0.6;
/** Smallest box kept, as a share of the frame. */
const MIN_AREA = 0.04;
/** Boxes overlapping by more than this (IoU) become one. */
const MERGE_IOU = 0.4;
const MAX_SHOWN = 5;
/** A risk below this confidence is drawn amber ("watch") instead of red. */
const WATCH_BELOW = 0.8;

type BBox = Finding["bbox"];
const areaOf = (b: BBox) => ((b[2] - b[0]) * (b[3] - b[1])) / 1_000_000;
const conf = (f: Finding) => f.confidence ?? 1;
/** Risk before clear, then the more confident first. */
const byPriority = (a: Finding, b: Finding) =>
  Number(b.severity === "risk") - Number(a.severity === "risk") || conf(b) - conf(a);

function merge(a: Finding, b: Finding): Finding {
  const [winner, other] = byPriority(a, b) <= 0 ? [a, b] : [b, a];
  const bbox: BBox = [
    Math.min(a.bbox[0], b.bbox[0]),
    Math.min(a.bbox[1], b.bbox[1]),
    Math.max(a.bbox[2], b.bbox[2]),
    Math.max(a.bbox[3], b.bbox[3]),
  ];
  const confidence = winner.confidence === undefined ? undefined : Math.max(winner.confidence, other.confidence ?? 0);
  return { ...winner, bbox, confidence };
}

/**
 * What the screen shows for one frame: hide shaky and tiny findings, merge ones that cover the
 * same spot, put risks first, and keep five at most.
 */
export function selectFindings(findings: Finding[]): Finding[] {
  const list = findings.filter((f) => conf(f) >= MIN_CONFIDENCE && areaOf(f.bbox) >= MIN_AREA);
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length && !merged; j++) {
        if (iou(list[i].bbox, list[j].bbox) > MERGE_IOU) {
          const [other] = list.splice(j, 1);
          list[i] = merge(list[i], other);
          merged = true;
        }
      }
    }
  }
  return list.sort(byPriority).slice(0, MAX_SHOWN);
}

/** The tracks on screen right now: seen recently, risk first, five at most. Overlay, card and score all use this. */
export function shownTracks(tracks: Track[]): Track[] {
  return tracks.filter(isVisible).sort(byPriority).slice(0, MAX_SHOWN);
}

export type Tone = "risk" | "watch" | "clear";

export function toneOf(f: Finding): Tone {
  if (f.severity === "clear") return "clear";
  return conf(f) < WATCH_BELOW ? "watch" : "risk";
}

/** One line for the result card: "Dry grass, mow by June 1". */
export function findingLine(f: Finding): string {
  const action = f.action.trim().replace(/\.$/, "");
  return `${f.label}, ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
}

export const PILL_H = 24;
const GAP = 4;
const pillWidth = (label: string) => Math.ceil(label.length * 7 + 20);

export interface LabelItem {
  key: number;
  rect: Rect;
  label: string;
}
export interface Safe {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface PillBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: PillBox, b: PillBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Places each label pill above its box, or below it when there is no room above, or inside it
 * as a last resort. Pills stay inside the safe area and never overlap each other.
 */
export function layoutLabels(items: LabelItem[], area: { w: number; h: number }, safe: Safe): Map<number, PillBox> {
  const placed = new Map<number, PillBox>();
  const minY = safe.top;
  const maxY = area.h - safe.bottom - PILL_H;
  const free = (p: PillBox) => [...placed.values()].every((q) => !overlaps(p, q));

  for (const { key, rect, label } of items) {
    const w = Math.min(pillWidth(label), area.w - safe.left - safe.right);
    const x = Math.min(Math.max(rect.x, safe.left), area.w - safe.right - w);
    const ys = [
      rect.y - PILL_H - GAP, // above
      rect.y + rect.height + GAP, // below
      rect.y + GAP, // inside, top
      rect.y + rect.height - PILL_H - GAP, // inside, bottom
    ].filter((y) => y >= minY && y <= maxY);
    const boxes = ys.map((y): PillBox => ({ x, y, w, h: PILL_H }));
    const fallback: PillBox = { x, y: Math.min(Math.max(rect.y + GAP, minY), maxY), w, h: PILL_H };
    let pill = boxes.find(free);
    if (!pill) {
      // Slide down the column to the first gap.
      const first = boxes[0] ?? fallback;
      for (let y = first.y; y <= maxY && !pill; y += PILL_H + GAP) {
        const slot = { ...first, y };
        if (free(slot)) pill = slot;
      }
      pill ??= first;
    }
    placed.set(key, pill);
  }
  return placed;
}

/** The model's rating of one frame, as /api/estimate returns it. */
export interface ScanEstimate {
  dry_pct: number;
  veg_frac: number;
  grid: string[][];
}

/** Below this vegetation share the model had little to rate, so its dry % is shaky. */
const MIN_VEG_FRAC = 0.05;
/** Points the overlay share may differ from the estimate's dry % before the number is called shaky. */
const MAX_GAP_PTS = 15;

/** The overlay's RISK area and the dry area the estimate implies may differ by this factor before the number is called shaky ... */
const MAX_AREA_FACTOR = 2;
/** ... as long as they are also this share of the frame apart, so two tiny areas never count as a disagreement. */
const MIN_AREA_GAP = 0.02;

/**
 * "uncertain" when the headline number is a fallback or the two measures disagree: on the dry share (over MAX_GAP_PTS) or
 * on how much of the frame is dry (overlay RISK area vs dry_pct / 100 x veg_frac, over MAX_AREA_FACTOR), so a tiny blob
 * never sits under a confident 25%. Never changes the number itself.
 */
export function headlineCertainty(fuel: FuelMap | null, est: ScanEstimate | null): "exact" | "uncertain" {
  if (!est) return fuel?.verdict.share != null ? "uncertain" : "exact";
  if (est.veg_frac > 0 && est.veg_frac < MIN_VEG_FRAC) return "uncertain";
  const overlay = fuel?.verdict.share;
  if (!fuel || overlay == null) return "exact";
  if (Math.abs(est.dry_pct - overlay * 100) > MAX_GAP_PTS + 1e-9) return "uncertain";
  const drawn = fuel.verdict.risk / (fuel.w * fuel.h);
  const implied = (est.dry_pct / 100) * est.veg_frac;
  const apart = Math.abs(drawn - implied) > MIN_AREA_GAP && Math.max(drawn, implied) > MAX_AREA_FACTOR * Math.min(drawn, implied);
  return apart ? "uncertain" : "exact";
}

/**
 * The headline verdict: the estimate's dry_pct when it came back, else the SAM share, else null.
 * Same 0.15 / 0.4 cut-offs as the SAM verdict. When the number is shaky the text says "About N%";
 * the share stays the exact number.
 */
export function headlineVerdict(fuel: FuelMap | null, est: ScanEstimate | null): Verdict | null {
  const v = rate(fuel, est);
  if (!v || v.share === null || v.share <= 0 || headlineCertainty(fuel, est) === "exact") return v;
  return { ...v, text: `${wordOf(v.level)}: About ${pctOf(v.share)} of the ${est ? "ground cover" : "vegetation"} looks dry. This photo is hard to read.` };
}

const wordOf = (level: Verdict["level"]) => ({ high: "High risk", moderate: "Moderate risk", low: "Some risk", clear: "", none: "" })[level];
const pctOf = (share: number) => (share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

function rate(fuel: FuelMap | null, est: ScanEstimate | null): Verdict | null {
  if (!est) return fuel?.verdict ?? null;
  if (est.veg_frac <= 0) return { risk: 0, clear: 0, share: null, level: "none", text: "No ground cover to rate in this frame." };
  const share = est.dry_pct / 100;
  if (share <= 0) return { risk: 0, clear: 0, share, level: "clear", text: "All clear: no dry vegetation found." };
  const level = share >= 0.4 ? "high" : share >= 0.15 ? "moderate" : "low";
  return { risk: 0, clear: 0, share, level, text: `${wordOf(level)}: ${pctOf(share)} of the ground cover looks dry.` };
}
