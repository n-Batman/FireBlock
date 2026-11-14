import type { CellCode, GridFinding, GridScan } from "@/data/types";

export const COLS = 12;
export const ROWS = 8;
export const CELL_COUNT = COLS * ROWS;

export type Tone = "risk" | "clear" | "neutral";

/** What each cell letter means, and how it counts. Bare soil is a fuel break, so it counts as clear. */
export const CLASSES: Record<CellCode, { name: string; tone: Tone; action: string }> = {
  d: { name: "Dry grass", tone: "risk", action: "Mow or cut it before June 1." },
  b: { name: "Dead brush or wood", tone: "risk", action: "Cut it back and haul it away." },
  l: { name: "Leaf litter or mulch", tone: "risk", action: "Rake it up, keep it off structures." },
  w: { name: "Dormant woody plant", tone: "neutral", action: "" },
  g: { name: "Green cover crop", tone: "clear", action: "" },
  v: { name: "Green vine canopy", tone: "clear", action: "" },
  s: { name: "Bare soil", tone: "clear", action: "" },
  o: { name: "Structure, sky or other", tone: "neutral", action: "" },
};

const isCode = (c: string): c is CellCode => c in CLASSES;
export const toneOfCell = (c: CellCode): Tone => CLASSES[c].tone;

/** "C5" -> index 50 (column C = 2, row 5 = 4, 4 * 12 + 2). Null when it is not a cell. */
export function cellIndex(label: string): number | null {
  const m = /^([A-La-l])\s*([1-8])$/.exec(label.trim());
  return m ? (Number(m[2]) - 1) * COLS + (m[1].toUpperCase().charCodeAt(0) - 65) : null;
}

/** Top, middle or bottom, then left, centre or right, from where the cells sit. */
export function whereOf(cells: number[]): string {
  if (cells.length === 0) return "";
  const col = cells.reduce((n, i) => n + (i % COLS), 0) / cells.length;
  const row = cells.reduce((n, i) => n + Math.floor(i / COLS), 0) / cells.length;
  const v = row < ROWS / 3 ? "top" : row < (2 * ROWS) / 3 ? "middle" : "bottom";
  const h = col < COLS / 3 ? "left" : col < (2 * COLS) / 3 ? "centre" : "right";
  return `${v} ${h}`;
}

/** Neighbours of a cell on the grid (up, down, left, right). */
function neighbours(i: number): number[] {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  return [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]
    .filter(([nc, nr]) => nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS)
    .map(([nc, nr]) => nr * COLS + nc);
}

/** The touching cells around `start` that `match`, as a sorted list. */
function grow(start: number, match: (i: number) => boolean, seen = new Set<number>()): number[] {
  const members: number[] = [];
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const i = stack.pop()!;
    members.push(i);
    for (const n of neighbours(i)) {
      if (!seen.has(n) && match(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return members.sort((a, b) => a - b);
}

/**
 * A finding names one fuel class and one cell of it; its cells are the patch of that class touching
 * that cell, and its severity comes from the class, so a finding can never disagree with the colours.
 */
function toFinding(raw: unknown, cells: CellCode[]): GridFinding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { label, where, reason, action, code, anchor } = raw as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "" || typeof reason !== "string") return null;
  if (typeof code !== "string" || !isCode(code) || typeof anchor !== "string") return null;
  const start = cellIndex(anchor);
  if (start === null || cells[start] !== code) return null;
  const severity = CLASSES[code].tone;
  if (severity === "neutral") return null;
  return {
    label: label.trim(),
    where: typeof where === "string" ? where.trim() : "",
    severity,
    reason: reason.trim(),
    action: severity === "risk" && typeof action === "string" ? action.trim() : "",
    cells: grow(start, (i) => cells[i] === code),
  };
}

/**
 * Reads the model's JSON: 8 rows of 12 class letters (spaces ignored) and the grouped findings.
 * Anything off the grid shape is rejected whole, because a half-read grid would show wrong colours.
 */
export function parseGrid(text: string): GridScan | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const { rows, findings } = (data ?? {}) as { rows?: unknown; findings?: unknown };
  if (!Array.isArray(rows) || rows.length !== ROWS) return null;
  const cells: CellCode[] = [];
  for (const row of rows) {
    if (typeof row !== "string") return null;
    const letters = [...row.toLowerCase().replace(/[\s,]/g, "")];
    if (letters.length !== COLS || !letters.every(isCode)) return null;
    cells.push(...(letters as CellCode[]));
  }
  const list = Array.isArray(findings) ? findings.map((f) => toFinding(f, cells)).filter((f): f is GridFinding => f !== null) : [];
  return { cells, findings: list };
}

export interface Region {
  tone: "risk" | "clear";
  cells: number[];
  /** Cell-grid line segments [x1, y1, x2, y2] on the outside of the region, for the outline. */
  edges: [number, number, number, number][];
}

/** Touching cells of the same colour (risk or clear) become one region. Neutral cells make none. */
export function regions(cells: CellCode[]): Region[] {
  const tone = (i: number) => toneOfCell(cells[i]);
  const seen = new Set<number>();
  const out: Region[] = [];
  for (let start = 0; start < cells.length; start++) {
    const t = tone(start);
    if (t === "neutral" || seen.has(start)) continue;
    const members = grow(start, (i) => tone(i) === t, seen);
    const inRegion = new Set(members);
    const edges: Region["edges"] = [];
    for (const i of members) {
      const x = i % COLS;
      const y = Math.floor(i / COLS);
      if (!inRegion.has(i - COLS) || y === 0) edges.push([x, y, x + 1, y]);
      if (!inRegion.has(i + COLS) || y === ROWS - 1) edges.push([x, y + 1, x + 1, y + 1]);
      if (x === 0 || !inRegion.has(i - 1)) edges.push([x, y, x, y + 1]);
      if (x === COLS - 1 || !inRegion.has(i + 1)) edges.push([x + 1, y, x + 1, y + 1]);
    }
    out.push({ tone: t, cells: members, edges });
  }
  return out;
}

export type Level = "none" | "clear" | "low" | "moderate" | "high";

export interface Verdict {
  risk: number;
  clear: number;
  /** risk / (risk + clear), 0 to 1. Null when nothing could be rated. */
  share: number | null;
  level: Level;
  text: string;
}

/** The overall call comes from the share of risk cells. "All clear" only when there are no risk cells at all. */
export function verdict(cells: CellCode[]): Verdict {
  const risk = cells.filter((c) => toneOfCell(c) === "risk").length;
  const clear = cells.filter((c) => toneOfCell(c) === "clear").length;
  if (risk + clear === 0) return { risk, clear, share: null, level: "none", text: "Nothing to rate in this frame." };
  const share = risk / (risk + clear);
  const pct = Math.round(share * 100);
  if (risk === 0) return { risk, clear, share, level: "clear", text: "No risk cells in this frame." };
  const level: Level = share >= 0.4 ? "high" : share >= 0.15 ? "moderate" : "low";
  const word = { high: "High risk", moderate: "Moderate risk", low: "Some risk" }[level];
  return { risk, clear, share, level, text: `${word}: ${pct}% of rated cells (${risk} of ${risk + clear}).` };
}

const MAX_FINDINGS = 6;

/**
 * The findings to show: the model's, plus one plain finding for every risk region the model did
 * not mention, so nothing red is left unexplained. Risks first, bigger first, six at most.
 */
export function listFindings(scan: GridScan): GridFinding[] {
  const inRange = scan.findings.map((f) => ({ ...f, cells: f.cells.filter((i) => i < CELL_COUNT) }));
  const riskCovered = new Set(inRange.filter((f) => f.severity === "risk").flatMap((f) => f.cells));
  const extra: GridFinding[] = regions(scan.cells)
    .filter((r) => r.tone === "risk" && !r.cells.some((i) => riskCovered.has(i)))
    .map((r) => {
      const counts = new Map<CellCode, number>();
      r.cells.forEach((i) => counts.set(scan.cells[i], (counts.get(scan.cells[i]) ?? 0) + 1));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return {
        label: CLASSES[top].name,
        where: whereOf(r.cells),
        severity: "risk" as const,
        reason: `${CLASSES[top].name} marked in this part of the frame.`,
        action: CLASSES[top].action,
        cells: r.cells,
      };
    });
  return [...inRange, ...extra]
    .sort((a, b) => Number(b.severity === "risk") - Number(a.severity === "risk") || b.cells.length - a.cells.length)
    .slice(0, MAX_FINDINGS);
}
