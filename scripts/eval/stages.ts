/* RISK pixels per region after each stage of scan() for one photo. Run: npx tsx --env-file=.env.local scripts/eval/stages.ts eval/data/own/vineyard-dog.jpg
   Calls SAM and the estimate once per photo (cached in eval/cache), then logs the share of RISK in the whole frame and in each quarter. */
import sharp from "sharp";
import { MAP_WIDTH, RISK, scan } from "../../src/lib/fuelMask";
import { estimate, frame, segment } from "./replies";

async function main() {
  const file = process.argv[2];
  const rf = process.env.ROBOFLOW_API_KEY?.trim();
  if (!file || !rf || !process.env.OPENAI_API_KEY) throw new Error("usage: stages.ts <photo>; ROBOFLOW_API_KEY and OPENAI_API_KEY from env");
  const { jpeg, w: sw, h: sh } = await frame(file);
  const w = MAP_WIDTH;
  const h = Math.max(1, Math.round((sh / sw) * w));
  const rgba = await sharp(jpeg).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const [masks, est] = await Promise.all([segment(jpeg, rf), estimate(jpeg)]);
  console.log(`estimate: dry ${est.dryPct}% of vegetation, vegetation ${Math.round(est.vegFrac * 100)}% of frame`);
  const quarters = { "top-left": [0, 0], "top-right": [1, 0], "bottom-left": [0, 1], "bottom-right": [1, 1] } as const;
  const show = (stage: string, labels: Uint8Array) => {
    const cells = Object.entries(quarters).map(([name, [qx, qy]]) => {
      let n = 0;
      for (let y = Math.floor((qy * h) / 2); y < Math.floor(((qy + 1) * h) / 2); y++) for (let x = Math.floor((qx * w) / 2); x < Math.floor(((qx + 1) * w) / 2); x++) if (labels[y * w + x] === RISK) n++;
      return `${name} ${((n / ((w * h) / 4)) * 100).toFixed(1)}%`;
    });
    const all = labels.reduce((n, l) => n + (l === RISK ? 1 : 0), 0);
    console.log(`${stage.padEnd(11)} frame ${((all / (w * h)) * 100).toFixed(1)}%  ${cells.join("  ")}`);
  };
  const map = scan(rgba, w, h, sw, masks, est.grid, est.dryPct, est.vegFrac, show);
  if (process.argv[3]) {
    // Optional picture: the photo with RISK in red (opaque for 3 checks, fainter for fewer) and hard excludes in blue.
    const out = Buffer.from(rgba);
    for (let i = 0; i < w * h; i++) {
      if (map.labels[i] !== RISK) continue;
      const a = [0, 0.3, 0.55, 0.85][map.agree?.[i] ?? 3];
      out[i * 4] = out[i * 4] * (1 - a) + 255 * a;
      out[i * 4 + 1] *= 1 - a;
      out[i * 4 + 2] *= 1 - a;
    }
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).resize(768).png().toFile(process.argv[3]);
  }
}
main();
