/* Pulls the eval images into eval/data (gitignored) and writes eval/manifest.json. Run: npm run eval:fetch */
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { CACHE, DATA, MANIFEST, UA, mk, pool, sleep, type Item } from "./common";

const PER_BUCKET = 25;
const CATEGORIES = ["Dry grass", "Grasslands of California", "Vineyards in California", "Cover crops", "Lawns", "Chaparral", "Firebreaks", "Wildfire prevention"];
const SEARCHES = ["brown lawn drought", "leaf litter", "bare soil field", "dirt road", "dormant vineyard"];
const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)? \d)/i;
// EVAL_ONLY=dirt fetches just the two dirt searches and merges them into the existing manifest.
const DIRT_ONLY = process.env.EVAL_ONLY === "dirt";
const VEGANN = Number(process.env.VEGANN ?? 100);
// FETCH_BUDGET_S stops the download phase early; files already on disk are reused, so a rerun resumes.
const DEADLINE = Date.now() + Number(process.env.FETCH_BUDGET_S ?? 1e9) * 1000;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const strip = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, "").trim();

async function get(url: string, tries = 8): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if ((res.status === 429 || res.status >= 500) && i < tries) {
      await sleep(5000 * (i + 1));
      continue;
    }
    return res;
  }
}

async function commons(params: Record<string, string>, bucket: string): Promise<Item[]> {
  const out: Item[] = [];
  let cont: Record<string, string> = {};
  // ponytail: stops at PER_BUCKET kept files or 6 pages; a rarely-licensed bucket may come up short.
  for (let page = 0; page < 6 && out.length < PER_BUCKET; page++) {
    await sleep(1000);
    const q = new URLSearchParams({ action: "query", format: "json", prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "1024", ...params, ...cont });
    const json = await (await get(`https://commons.wikimedia.org/w/api.php?${q}`)).json();
    for (const p of Object.values<any>(json.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime)) continue;
      const m = ii.extmetadata ?? {};
      const license = strip(m.LicenseShortName?.value);
      if (!OK_LICENSE.test(license)) continue;
      const id = `${slug(bucket)}-${p.pageid}`;
      out.push({ id, file: `${slug(bucket)}/${p.pageid}.jpg`, url: ii.descriptionurl, license, author: strip(m.Artist?.value).slice(0, 120) || "unknown", category: bucket, source: "commons", _thumb: ii.thumburl } as Item & { _thumb: string });
      if (out.length >= PER_BUCKET) break;
    }
    if (!json.continue) break;
    cont = json.continue;
  }
  return out;
}

async function download(url: string, file: string) {
  const dest = `${DATA}/${file}`;
  if (existsSync(dest)) return true;
  const res = await get(url);
  if (!res.ok) return false;
  mk(dest.slice(0, dest.lastIndexOf("/")));
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function vegann(): Promise<Item[]> {
  const base = "https://datasets-server.huggingface.co/rows?dataset=simonMadec/VegAnn&config=default&split=train";
  const total = (await (await get(`${base}&offset=0&length=1`)).json()).num_rows_total as number;
  // Seeded so reruns pick the same images.
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const picks = [...new Set(Array.from({ length: VEGANN * 2 }, () => Math.floor(rnd() * total)))].slice(0, VEGANN);
  const out: Item[] = [];
  await pool(picks, 4, async (offset) => {
    if (Date.now() > DEADLINE) return;
    const row = (await (await get(`${base}&offset=${offset}&length=1`)).json()).rows?.[0]?.row;
    if (!row) return;
    const id = `vegann-${offset}`;
    if (!(await download(row.image.src, `vegann/${offset}.jpg`)) || !(await download(row.mask.src, `vegann/${offset}.mask.png`))) return;
    out.push({ id, file: `vegann/${offset}.jpg`, mask: `vegann/${offset}.mask.png`, url: `https://huggingface.co/datasets/simonMadec/VegAnn#${offset}`, license: "CC BY 4.0", author: `VegAnn (${row.Owner ?? "n/a"})`, category: "vegann", source: "vegann" });
  });
  return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function main() {
  mk(DATA);
  mk(CACHE);
  const items: (Item & { _thumb?: string })[] = [];
  const old: Item[] = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
  if (!DIRT_ONLY) for (const c of CATEGORIES) items.push(...(await commons({ generator: "categorymembers", gcmtitle: `Category:${c}`, gcmtype: "file", gcmlimit: "50" }, c)));
  for (const s of DIRT_ONLY ? ["bare soil field", "dirt road"] : SEARCHES) items.push(...(await commons({ generator: "search", gsrsearch: s, gsrnamespace: "6", gsrlimit: "50" }, s)));
  const seen = new Set<string>(DIRT_ONLY ? old.map((o) => o.file.split("/")[1]) : []);
  const unique = items.filter((i) => !seen.has(i.file.split("/")[1]) && seen.add(i.file.split("/")[1]));
  const kept: Item[] = [];
  await pool(unique, 2, async (it) => {
    if (Date.now() > DEADLINE) return;
    await sleep(300);
    if (await download(it._thumb!, it.file)) {
      delete it._thumb;
      kept.push(it);
    }
  });
  kept.sort((a, b) => a.id.localeCompare(b.id));
  const own: Item[] = [];
  const nums = existsSync("test-photos") ? readdirSync("test-photos").flatMap((f) => /^SRV(\d+)\.jpeg$/.exec(f)?.[1] ?? []).map(Number).sort((a, b) => a - b) : [];
  for (const n of nums) {
    const src = `test-photos/SRV${n}.jpeg`;
    mk(`${DATA}/own`);
    copyFileSync(src, `${DATA}/own/SRV${n}.jpg`);
    own.push({ id: `own-srv${n}`, file: `own/SRV${n}.jpg`, url: "local:test-photos", license: "own", author: "FireBlock", category: "own", source: "own" });
  }
  const fresh = [...kept, ...(DIRT_ONLY ? [] : await vegann()), ...own];
  // Keep labels already written by label.ts.
  for (const m of fresh) m.expected = old.find((o) => o.id === m.id)?.expected;
  const ids = new Set(fresh.map((m) => m.id));
  const manifest = DIRT_ONLY ? [...old.filter((o) => !ids.has(o.id)), ...fresh] : fresh;
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  const by: Record<string, number> = {};
  for (const m of manifest) by[m.category] = (by[m.category] ?? 0) + 1;
  console.log(manifest.length, "images", by);
}
main();
