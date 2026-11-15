/* Saves one photo and its cached replies as a test fixture: a 384 px JPEG, the parsed SAM masks (both calls) and the estimate.
   Run: npx tsx --env-file=.env.local scripts/eval/fixture.ts eval/data/own/vineyard-dog.jpg src/lib/fixtures/vineyard-dog */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { MAP_WIDTH } from "../../src/lib/fuelMask";
import { estimate, frame, segment } from "./replies";

async function main() {
  const [file, dir] = process.argv.slice(2);
  const rf = process.env.ROBOFLOW_API_KEY?.trim();
  if (!file || !dir || !rf) throw new Error("usage: fixture.ts <photo> <dir>; ROBOFLOW_API_KEY and OPENAI_API_KEY from env");
  const { jpeg, w } = await frame(file);
  mkdirSync(dir, { recursive: true });
  await sharp(jpeg).resize(MAP_WIDTH).jpeg({ quality: 85 }).toFile(`${dir}/photo.jpg`);
  // Mask points are in pixels of the 1024 px frame (`srcW`); rounded to 0.1 px to keep the file small.
  const masks = (await segment(jpeg, rf)).map((m) => ({ ...m, polys: m.polys.map((p) => p.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])) }));
  writeFileSync(`${dir}/replies.json`, JSON.stringify({ srcW: w, masks, estimate: await estimate(jpeg) }));
}
main();
