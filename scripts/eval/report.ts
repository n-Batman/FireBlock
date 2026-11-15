import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { CLEAR, RISK } from "../../src/lib/fuelMask";
import type { Result } from "./run";
import { DATA, mk } from "./common";

const CW = 256;
const CH = 192;
const TXT = 300;
const ROWS = 8;

const sev = (r: Result) => (r.pass ? 0 : r.err ?? (r.bgFp ?? 0) * 100 + r.riskFrame * 100);

const base0 = (r: Result) => r.map.labels.length;
async function row(r: Result): Promise<Buffer> {
  const fit = { fit: "contain" as const, background: "#111" };
  const orig = await sharp(r.jpeg).resize(CW, CH, fit).toBuffer();
  const { w, h, labels } = r.map;
  const ov = Buffer.alloc(w * h * 4);
  if (base0(r) !== w * h) throw new Error(`size mismatch ${r.item.id}`);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i];
    if (l === RISK) ov.set([255, 40, 20, 150], i * 4);
    else if (l === CLEAR) ov.set([40, 200, 80, 90], i * 4);
  }
  const base = await sharp(r.jpeg).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blended = await sharp(base.data, { raw: base.info }).composite([{ input: ov, raw: { width: base.info.width, height: base.info.height, channels: 4 } }]).png().toBuffer();
  const over = await sharp(blended).resize(CW, CH, fit).toBuffer();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const exp = r.expected == null ? "n/a" : `${r.expected.toFixed(0)}%`;
  const lines = [r.item.id, `ours ${r.ours.toFixed(0)}%  |  expected ${exp}`, r.item.source === "vegann" ? `bg risk ${((r.bgFp ?? 0) * 100).toFixed(1)}%` : `risk px ${(r.riskFrame * 100).toFixed(1)}% of frame`, r.pass ? "PASS" : `FAIL: ${r.why}`, r.item.expected?.notes ?? ""];
  const svg = `<svg width="${TXT}" height="${CH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${r.pass ? "#10261a" : "#33161a"}"/>${lines
    .map((t, i) => `<text x="10" y="${24 + i * 30}" font-family="Helvetica" font-size="${i ? 15 : 14}" fill="#eee">${esc(t.slice(0, 44))}</text>`)
    .join("")}</svg>`;
  return sharp({ create: { width: CW * 2 + TXT, height: CH, channels: 3, background: "#000" } })
    .composite([{ input: orig, left: 0, top: 0 }, { input: over, left: CW, top: 0 }, { input: Buffer.from(svg), left: CW * 2, top: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function sheet(rs: Result[], name: string) {
  const rows = await Promise.all(rs.map(row));
  await sharp({ create: { width: CW * 2 + TXT, height: CH * rows.length, channels: 3, background: "#000" } })
    .composite(rows.map((input, i) => ({ input, left: 0, top: i * CH })))
    .jpeg({ quality: 82 })
    .toFile(`eval/sheets/${name}.jpg`);
}

export async function report(all: Result[], meta: { total: number; dropped: number; failed: string[] }) {
  mk("eval/sheets");
  const flagged = all.filter((r) => r.suspect);
  const results = all.filter((r) => !r.suspect); // pass rates leave out obvious label errors
  const cats = [...new Set(results.map((r) => r.item.category))].sort();
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
  const lines = [
    "# Scanner eval",
    "",
    `Images in manifest: ${meta.total}. Dropped as irrelevant by GPT: ${meta.dropped}. Scored: ${all.length} (${flagged.length} flagged as probable label errors and left out of the rates). Failed: ${meta.failed.length}.`,
    "Pass = dry% within 15 pts of GPT's estimate; dirt buckets also need risk under 3% of the frame; VegAnn needs risk on under 5% of background pixels.",
    "",
    "| Bucket | n | Pass | Mean abs err (pts) |",
    "|---|---|---|---|",
  ];
  for (const c of cats) {
    const rs = results.filter((r) => r.item.category === c);
    const errs = rs.flatMap((r) => (r.err == null ? [] : [r.err]));
    lines.push(`| ${c} | ${rs.length} | ${pct(rs.filter((r) => r.pass).length, rs.length)} | ${errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : "n/a"} |`);
  }
  lines.push(`| **all** | ${results.length} | ${pct(results.filter((r) => r.pass).length, results.length)} | |`, "");
  const dirt = results.filter((r) => ["bare soil field", "dirt road"].includes(r.item.category));
  const veg = results.filter((r) => r.bgFp != null);
  const meanBg = veg.reduce((a, r) => a + (r.bgFp ?? 0), 0) / (veg.length || 1);
  const acr = all.filter((r) => r.allClearWithRisk);
  lines.push(
    `- Dirt false positives (bare-soil + dirt-road buckets, risk over 3% of frame): ${dirt.filter((r) => r.riskFrame > 0.03).length}/${dirt.length}`,
    `- VegAnn background false positives: mean ${(meanBg * 100).toFixed(1)}% of background pixels read as risk; ${veg.filter((r) => (r.bgFp ?? 0) > 0.05).length}/${veg.length} images over 5%`,
    `- "All clear" while risk is drawn (must be 0): **${acr.length}**${acr.length ? " — " + acr.slice(0, 10).map((r) => r.item.id).join(", ") : ""}`,
    "",
    "## Worst 20",
    "",
    "| Image | Bucket | Ours | Expected | Why |",
    "|---|---|---|---|---|",
  );
  const worst = [...results].filter((r) => !r.pass).sort((a, b) => sev(b) - sev(a)).slice(0, 20);
  for (const r of worst) lines.push(`| [${r.item.id}](${r.item.url}) | ${r.item.category} | ${r.ours.toFixed(0)}% | ${r.expected == null ? "n/a" : r.expected.toFixed(0) + "%"} | ${r.why} |`);
  lines.push("", "## Probable label errors (GPT estimate looks wrong; not tuned to)", "", "| Image | Bucket | Ours | GPT | Reason |", "|---|---|---|---|---|");
  for (const r of flagged) lines.push(`| [${r.item.id}](${r.item.url}) | ${r.item.category} | ${r.ours.toFixed(0)}% | ${r.expected?.toFixed(0)}% | ${r.suspect} |`);
  if (meta.failed.length) lines.push("", "## Failed to run", "", ...meta.failed.map((f) => `- ${f}`));
  writeFileSync("eval/report.md", lines.join("\n") + "\n");
  await sheet(flagged.slice(0, ROWS), "label-errors");
  await sheet(worst.slice(0, ROWS), "worst-a");
  await sheet(worst.slice(ROWS, ROWS * 2), "worst-b");
  for (const c of cats) {
    const rs = results.filter((r) => r.item.category === c);
    for (let i = 0; i * ROWS < rs.length && i < 2; i++) await sheet(rs.slice(i * ROWS, (i + 1) * ROWS), `${c.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${i + 1}`);
  }
  console.log(lines.slice(0, 40).join("\n"));
}
