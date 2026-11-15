/* Weak labels: one GPT vision call per Commons/own image -> {relevant, dry_pct_estimate, notes}. Cached in eval/cache/label-<sha>.json. Key stays in env. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CACHE, DATA, MANIFEST, mk, pool, sha, type Item } from "./common";

const MODEL = "gpt-6.1-terra"; // same model family the app uses for words
const PROMPT_VERSION = "ground-v2"; // part of the cache key: bump to relabel
const PROMPT = `You rate photos for a wildfire fuel scanner that looks at GROUND vegetation in vineyards, fields and yards: grass, weeds, cover crop and litter only. Ignore vine and tree canopy, trunks and dormant canes entirely.
Return relevant=false if the photo is not a usable outdoor view of ground vegetation or bare ground: people as the subject, maps, diagrams, indoor shots, extreme close-ups of a few stems or bales, aerial/satellite views, text.
Otherwise relevant=true and dry_pct_estimate = of the GROUND VEGETATION visible (grass, weeds, cover crop, litter; not vine or tree canopy, trunks, dormant canes, sky, soil, roads, buildings), what percent is dry, dead, straw or cured (0 to 100). If there is no ground vegetation at all (bare soil, gravel, dirt road, only vines or trees), dry_pct_estimate = 0.
notes: one short sentence on what the scene is.`;
const SCHEMA = {
  name: "label",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relevant", "dry_pct_estimate", "notes"],
    properties: { relevant: { type: "boolean" }, dry_pct_estimate: { type: "number" }, notes: { type: "string" } },
  },
};

async function label(it: Item, key: string) {
  const cache = `${CACHE}/label-${sha(it.file + PROMPT_VERSION)}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const b64 = readFileSync(`${DATA}/${it.file}`).toString("base64");
  for (let a = 0; a < 3; a++) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: "none" },
        instructions: PROMPT,
        input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${b64}`, detail: "low" }] }],
        text: { format: { type: "json_schema", ...SCHEMA } },
        store: false,
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!res || res.status >= 500 || res.status === 429) continue;
    if (!res.ok) throw new Error(`label ${it.id}: HTTP ${res.status}`); // body not printed: it can echo the request
    const reply = await res.json();
    const text = reply.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text;
    const out = JSON.parse(text);
    mk(CACHE);
    writeFileSync(cache, JSON.stringify(out));
    return out;
  }
  throw new Error(`label ${it.id}: failed after retries`);
}

async function main() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing (run via npm run eval:label)");
  const items: Item[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const todo = items.filter((i) => i.source !== "vegann");
  await pool(todo, 4, async (it) => {
    try {
      it.expected = await label(it, key);
    } catch (e) {
      console.error(String(e));
    }
  });
  writeFileSync(MANIFEST, JSON.stringify(items, null, 1));
  const kept = todo.filter((i) => i.expected?.relevant).length;
  console.log(`labelled ${todo.filter((i) => i.expected).length}/${todo.length}, relevant ${kept}`);
}
main();
