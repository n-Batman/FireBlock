# FireBlock task board (single source of truth)

**Every AI (Claude, Codex) and every human reads this file first, before writing any code.**
When you finish or start a task, update its status here in the same commit. Don't delete rows; mark them.

Status keys: `TODO` · `DOING (who)` · `DONE` · `BLOCKED: why`

> **Repo layout:** the Next.js app lives at the repo root (`src/`, `package.json`), next to the C++ and Python pipeline, so every `src/...` path on this board means `src/...`. `web/` is an old copy of the app, kept only until it is removed.

## The story (don't drift from this)
- **Hero user:** SLO vineyard and ranch owners getting ready for the county's June 1 dry-growth clearing deadline. Mowing costs $34–150/hr, and habitat areas can't be mowed.
- **Who pays:** owners use the planner. Insurers (and later agencies) pay for the parcel-level, ground-truthed risk data it produces. The pitch covers both.
- **Score honesty:** it's an *estimate of where to work first*, never a "prediction", and never certifies a property as safe. Risk comes from a defined model (fire weather index + fuel + slope + hazard zone + history). The LLM only explains and reads photos; it never invents the number.
- **Proof sources:** Vidya (vineyard owner call), Sam Alvarez (Coastal San Luis RCD), Spencer Gordon. Don't name Vidya on screen or in the pitch until she says yes.

## Deadlines (Pacific time)
| When | What |
|---|---|
| Fri 8:50 PM | Team lock |
| **Sat 2:00 PM** | Project link submitted |
| **Sat 8:00 PM** | Sunday commit with live link |
| **Sun 12:00 PM** | Final submission |
| Milo's shifts | Sat 9:15–9:45 PM close-out (rooms 0111–0114) · Sun 9:30 AM–12 PM room host (Cotchett 2nd floor) |

## Who owns which files (prevents AI collisions)
| Owner | Folders | Notes |
|---|---|---|
| **Milo (Claude)** | `src/components/`, `src/app/` (layout, pages, styles), `src/content/` (all words on screen) | UI, copy, design |
| **Partner (Codex)** | `src/lib/` (scoring, data fetch, vision call), `src/data/` fixtures, `scripts/`, API routes | Engine and data |
| **Shared contract** | `src/data/types.ts` | Change only after telling the other person. Both UI and engine depend on it. |

Workflow: pull before you start → work on your own branch (`milo/...` or `partner/...`) → `npm test` passes → push → open PR → the other person (or Grok Bot) reviews → merge. Commit small and often.

## Checkpoints
1. **Fri night:** map plus scores working on the 3 demo properties, deployed to Vercel.
2. **Sat midday:** photo scan plus plan export working.
3. **Sat evening onward:** polish, rehearse, backup video.

## Task board

### Partner (engine)

P16 — DONE (Codex): replaceable mathematical cloud risk model and verified frontend publication pointer. See `docs/mathematical-risk.md`.
| ID | Task | Status |
|---|---|---|
| P1 | Repo shared with Milo, Vercel project connected, auto-deploys from `main` | TODO |
| P2 | Accounts: NASA FIRMS key, OpenAI key (~$10 credit), keys in Vercel env vars (never committed) | TODO |
| P3 | Data check: FIRMS, Open-Meteo, NWS Red Flag, CAL FIRE hazard zones and perimeters, vegetation index (MODIS / Sentinel Hub stats) return SLO data | TODO |
| P4 | Lock 3 demo property coordinates and block outlines (Adelaida Hills, Paso Hwy 46 East, Edna Valley) | TODO |
| P5 | Data layer: fetch and cache the 3 properties to JSON in the exact `types.ts` shape | TODO |
| P6 | Scoring: fire weather index + fuel + slope + zone + history per block, with points and reason per factor | TODO |
| P7 | Photo/video scan: ~6 frames pulled in the browser go to the OpenAI vision model and return issues, action, priority, confidence; block score updates and shows "photo changed score from X to Y" | TODO |
| P8 | Plan engine: mowing order, hours, cost, habitat buffers; PDF export | TODO |
| P9 | (Stretch) Backtest slide: would the score have flagged the Gifford Fire area beforehand? | TODO |
| P10 | Point/area parcel lookup API and transparent boundary overlay on the risk map | DONE (Codex; source attribution and coverage documented in docs/parcel-boundaries.md) |
| P11 | Display backend risk grid as area-weighted parcel/plot colors, retaining grid and unknown coverage | DONE (Codex; docs/parcel-risk-display.md) |
| P12 | Verified cloud persistence, cloud grid serving, parcel archives and safe working-file cleanup | DONE (Codex; docs/cloud-retention.md; parcel licensing and completed-run ID require configuration) |
| P13 | Seed-centered spiral collection controls (default 1 km); separate 200 m analysis grid; box progress and plans | DONE (Codex; docs/scraper-control.md) |
| P14 | UUID-based satellite reuse, bounded metadata-only index, shared cloud references and restore compatibility | DONE (Codex; docs/satellite-deduplication.md) |
| P15 | Bound scraper events and cloud discovery memory; reap failed scraper children | DONE (Codex; 43 Python tests and 13 native checks pass; frontend: 59 tests pass, BreakdownPanel suite blocked by missing component) |
| P17 | Bounded Backblaze 5xx retries, upload receipt recovery, and durable scraper error notifications | DONE (Codex; four attempts with 1/2/4 second waits; 14 native checks and 47 Python tests pass; docs/storage-retries.md) |
| P18 | Run the real Silver River 50-box risk model and publish a portable result snapshot | DONE (Codex; verified cloud publication, 1,476 scored cells; src/data/real-runs/silver-river-20261114/) |
| P19 | Prepare real risk results for website display | READY (Codex; static result page, verified snapshot API and visible grid; live Vercel deployment awaits account connection) |
| P20 | Move generated map grids out of HTML into separate GeoJSON | DONE (Codex; HTML reduced 99.35%, unchanged grid, offline file-picker fallback; generator and public snapshots updated) |
| P22 | Preload nearby parcels with bounded session and score caches | DONE (Codex; 48 targeted checks and changed-file type checks pass; cancellation, private-field stripping and no persistent cache writes; docs/parcel-preloading.md) |
| P23 | Simplify dense city parcels into zoom-dependent area summaries | DONE (Codex; approximate blocks below zoom 17, original property ratings on zoom-in, selected properties retained; docs/parcel-detail-levels.md) |
| P24 | Analyze and publish the completed downtown SLO satellite collection | DONE (Codex; 50 boxes, 1,466/1,476 scored cells, verified cloud manifest/pointer and dated website snapshot; src/data/real-runs/slo-town-20261114/) |
| P25 | Analyze West Foothill Madonna Ranch neighborhood without duplicating SLO coverage | DONE (Codex; 60 new scored cells, 180 overlapping candidates excluded, reused cloud satellite IDs, regional Backblaze publication; fresh FIRMS unavailable because no key is configured; 8 risk tests pass) |
| P26 | Discover and display all published cloud risk regions automatically | DONE (Codex; per-run catalog, viewport loading and 60-second refresh, overlap-safe mosaic and parcel scoring, three regions registered; 33 targeted JS and 48 Python checks, TypeScript, production build and live B2 API pass; hosted site needs deployment; docs/risk-catalog.md) |
| P27 | Connect NWS hourly forecasts and active alerts to the real parcel map with GeoJSON and application User-Agent | DONE (Codex; 41 focused checks and production build pass; 421 total tests pass, 2 pre-existing scan failures; live request blocked by network; docs/weather.md) |
| P28 | Load area overview before individual parcel detail | DONE (Codex; zero parcel requests below zoom 17, bounded area tiles from saved risk cells, viewport-only detail requests and zoom-out cancellation; docs/parcel-detail-levels.md) |
| P29 | Remove parcel preloading regression and redundant hidden map work | DONE (Codex; automatic preload disabled, full-response score cache retained within existing byte bound, duplicate lookup/projection and hidden grid clipping skipped; targeted regression checks) |
| P30 | Integrate cloud maps with both agents' local frontend and parcel changes | DONE (Codex; preserved Downtown SLO/weather and zoom-dependent parcel loading; aligned individual-parcel rendering tests with zoom 17) |
| P32 | Restore parcel visibility and group by visible screen area | DONE (Codex; removed zoom cutoff, retained loaded geometry, union outlines below 10% of viewport area, zoom/resize restoration; 432 website tests, TypeScript and production build pass) |
| P33 | Lower parcel grouping to 5% and identify deployed behavior | DONE (Codex; dynamic neighborhood count and deployed-rule headers; 433 tests and production build pass; live demo still serves old square overview, Vercel deployment access required) |
| P34 | Fix browser parcel requests failing before HTTP | DONE (Codex; native fetch called with global receiver; reproduced failure before fix, receiver-sensitive cache and hook regressions pass; 437 tests and production build pass) |
| P35 | Analyze confirmed added Santa Margarita collection | DONE (Codex; 50 completed boxes, 1,440/1,440 scored cells at nominal 200 m; satellite reused, FIRMS parsed with stale detections excluded, verified B2 publication/catalog and website fallback) |
| P37 | Use direct shoelace parcel screen area and clip only at viewport edges | DONE (Codex; contained parcels use outer area minus holes, outside parcels skip clipping; 443 tests and TypeScript pass; local changes only, no deployment) |
| P38 | Reuse merged parcel outlines across map movements | DONE (Codex; bounded per-map cache reuses outline references across pan/zoom and score refresh, invalidates changed membership/coordinates; 446 tests and TypeScript pass; no deployment) |
| P39 | Memoize parcel point/scoring work independently of the viewport | DONE (Codex; split scoring and bbox filtering; 42 touched tests and TypeScript pass; local branch partner/parcel-pan-performance; PR not opened, GitHub checks stopped at user request; no deployment) |
| P40 | Cache parcel label centers and reduce label search refinement | DONE (Codex; 256-entry LRU keyed by ID and part/ring lengths, copied centers, three refinement rounds; 50 touched tests and TypeScript pass; local only, no PR or deployment) |
| P41 | Document parcel system architecture and current performance behavior | DONE (Codex; PARCEL_CONTEXT.md covers lookup, scoring paths, screen-area grouping, caches, limits and verification; documentation only) |
| P42 | Disable parcel combining and raise lookup capacity to 500 | DONE (Codex; individual-only pass-through skips camera/grouping math, shared 500-parcel service/cache/projection limit and 512-entry score/center caches; 456 tests and TypeScript pass) |
| P43 | Skip small parcels efficiently when zooming out | DONE (Codex; fixed zoom/acreage tiers, verified provider area predicate, cached bounds and exact filtered-query cache keys; immediate retained-parcel filtering; 477 tests and TypeScript pass; no combining) |
| P44 | Replace per-cell Turf scoring intersections with rectangular clipping | DONE (Codex; consistent planar shoelace area, 40-unit real SLO fixture with hole/multipart, 68 requested tests and TypeScript pass; median Turf 16.82 ms vs clipping 1.09 ms; partner/parcel-rectangle-scoring) |
| P46 | Reuse padded risk-grid coverage and remove periodic refresh | DONE (Codex; 50%-per-side bbox padding, containment-gated movement, forced manual reload and stale request cancellation; 17 overlay tests and TypeScript pass; no parcel scoring/loading changes) |

### Milo (product, words, proof, pitch)
| ID | Task | Status |
|---|---|---|
| M1 | Commit current frontend and push to GitHub (nothing is committed yet) | DONE |
| M2 | Screen 1, property map: rail, map, badge, legend, Data & limits (plan Tasks 1–3) | DONE |
| M3 | Screen 2, score breakdown panel (plan Task 4) | DONE |
| M4 | Screen 3, plan page and PDF layout (plan Task 5) | DONE |
| M5 | Vision prompt: write and test in ChatGPT with real dry-row, brush-line and barn photos; hand final prompt to Partner (`src/content/visionPrompt.md`) | TODO |
| M6 | Demo photos and video: dry rows, brush line, barn (real local or clear stock) | TODO |
| M7 | Email Vidya: thanks, permission to name her, one quote ("I'd use this before June 1") | TODO |
| M8 | Spencer: CAL FIRE SLO intro, and whether grant money could pay for a tool like this | TODO |
| M9 | Nudge Sam on the two open questions | TODO |
| M10 | Hourly test: use the deployed app as Vidya would, and log confusing things below | TODO |
| M11 | One-pager with quotes and numbers (June 1, $34–150/hr, 88,000 vs 230 acres) | TODO |
| M12 | Slides + 60-second script; judge-style dry run against the 100-point rubric | TODO |
| M13 | Record backup demo video once the app works | TODO |
| M14 | Submit project link by Sat 2 PM | TODO |
| M15 | `web/DESIGN.md`: palette, type, glass spec, motion, scanner visual language | DONE |
| M16 | Premium map shell: full-bleed satellite map, glass panels, weather strip, motion | DONE |
| M17 | Live scanner UI at `/scan`: camera, reticle, boxes, stub `/api/scan`, demo mode, score feed | DONE (needs real demo clip: M6) |
| M18 | Polish pass on every screen: focus, tap targets, contrast, keyboard, states | DONE |
| M19 | Map styling for any polygon: 2px outline, 15% fill, glow on selected, score pills, fly-to, zoom on phones | DONE |
| M20 | Hide the demo button when `/demo/vineyard.mp4` is missing | DONE |
| M22 | Real county parcels as the clickable units (radius 300 m around a chosen place), scored only from a saved scan's GPS or a risk_map.geojson, otherwise "Not scored yet"; sample properties kept as "Demo" | DONE |
| M21 | Address search on the map ("Search an address or vineyard", ArcGIS, SLO County only) that flies there and runs the parcel lookup; honest notices when nothing is scored or the place is outside the county | DONE |
| M23 | Remove demo property navigation and default to Downtown SLO while keeping address search | DONE (Codex; 18 focused tests and TypeScript pass; full suite: 395 pass, 2 failures in unchanged useScanSession tests) |
| M24 | Eval: headline-vs-overlay gap metric (VLM mode also runs SAM; report line plus worst-10 table) | DONE |
| M25 | Reconcile the SAM overlay to the headline dry_pct inside `scan()` (gate, fill, trim) | DONE (v2 VLM gap 54/153 to 38/153, mean 19.8 to 12.0; pass/MAE and dirt FP unchanged) |
| M26 | Scan screen survives a demo with the camera or APIs down: offline sample photos, request timeouts, Retry, capture guidance | DONE (2 own SRV stills with saved masks and estimate; no saved notes yet) |

## Rubric reminder (100 pts)
Execution & design 25 · Real problem/real user 25 (tiebreaker) · Path to customers 20 · Pitch & demo 15 · Creative AI 15

## Bugs / confusing things (from testing)
- _none yet_

## Decisions log
- Fri Nov 13: Stack is Next.js + Leaflet + Tailwind with JSON fixtures, deployed on Vercel. Hero user is the vineyard owner; insurers are the buyer of the data.
- Fri Nov 13: Detailed frontend plan in `docs/superpowers/plans/2026-11-13-fireblock-frontend.md`, design in `docs/superpowers/specs/`.
- Fri Nov 13: Shared contract `web/src/data/types.ts` changed (partner, please read): `Weather` added to `Property` (wind, humidity, Red Flag, updatedAt), `"photoScan"` added to `FactorKey`, and the scan types `Finding`, `ScanResponse` and `SCAN_JSON_SCHEMA` added. Block names in the fixtures are now real names ("Ridge Top"), not "Block N".
- Fri Nov 13: `/api/scan` is a STUB (canned findings, 400-800 ms delay). Partner swaps in the OpenAI call (gpt-4.1-mini, Responses API, strict `json_schema` from `SCAN_JSON_SCHEMA`) and keeps the response shape. Requests with `demoTime` must keep using `demoFindingsAt` so the judges' run is the same every time.
- Fri Nov 13: Block outlines will come from the partner's backend (`properties.json`, P4/P5). The UI keeps the placeholder shapes until then and already handles any polygon shape (label points stay inside L and U shapes). Public field-level outlines exist if needed: California DWR statewide crop mapping, 2023, `MAIN_CROP = 'V'` for vineyards.
- Sat Nov 14: Shared contract `src/data/types.ts` changed again (partner, please read): `Finding` gets an optional `confidence` (0 to 1), and `SCAN_JSON_SCHEMA` now requires `confidence` from the model and caps `findings` at 3 (`maxItems: 3`). `/api/scan` now calls the real model (`gpt-6.1-terra`, Responses API) from `src/lib/vision.ts`; a missing key, timeout (8 s) or API error returns 503, 504 or 502, never fake findings. The scan screen hides findings under 0.6 confidence and shows at most 3.
- Sat Nov 14: The app moved from `web/` to the repo root, on top of the parcel lookup (P10). His parcel files are unchanged except for hook-ins in `src/lib/ParcelOverlay.tsx`: an optional `lookup` prop (an address-search pick runs a parcel lookup), a guard that skips the API outside SLO County and says "Parcel lines cover SLO County only for now.", and two eslint-disable comments. Address search lives in `src/components/AddressSearch.tsx` and `src/lib/geocode.ts` (Esri geocoder; `NEXT_PUBLIC_ARCGIS_KEY` if set, keyless otherwise). Vercel's Root Directory must change from `web` to the repo root.
- Sat Nov 14: County parcels replace the sample rectangles as the map's units when a place is chosen (`src/data/types.ts` gets new types next to `Block` and `Property`: `ParcelUnit`, `ParcelScore`, `ScoreSource`, `ParcelScan`, `Ring`, `PolygonRings`; no existing field changed). A parcel is scored only if (a) a scan saved with the device's GPS is inside it (score = share of scanned areas flagged), or (b) `public/data/risk_map.geojson` exists, as the area-weighted mean of the overlapping scored cells when they cover at least 60% of the parcel, the same cutoff as Nick's display (the file is read as the generator writes it: `layer: "relative_risk"`, `risk_score` or null). Otherwise "Not scored yet. Scan the rows to score it." A scan wins over the risk map. Partner: `ParcelOverlay` gets one more optional prop, `onPoint`, called with the point of a latitude/longitude or "Pick on map" lookup so every way of choosing a place runs the same 300 m search; the sample properties are still reachable as "Demo: ...".
- Fri Nov 13: Look is dark only (see `DESIGN.md`). The demo clip `public/demo/vineyard.mp4` is not in the repo yet: needs real footage (M6), then retime `web/src/content/demoFindings.ts`.
- Sat Nov 14: Scan quality pass. Frames go up at JPEG 0.85, up to 1280 px, blurry camera frames skipped. `src/lib/vision.ts` prompt rewritten as a fuel checklist (partner, please read). Shared contract `src/data/types.ts`: `SCAN_JSON_SCHEMA` now allows 5 findings (was 3), bbox described as a tight box. Vision detail is "high", timeout 15 s. `/scan` has "Upload a photo" (same downscale, one request, same overlay and Save).
- Sat Nov 14: Scan rebuilt as a 12x8 grid heatmap (partner, please read). `src/lib/vision.ts` now calls `gpt-6.1-sol` (no `temperature`: the API rejects it) with a grid-labelled 1536 px frame and returns one class per cell; `src/lib/grid.ts` parses, merges regions, gives the verdict (score = risk cells / (risk + clear cells), `scanDelta` is now share-based). Shared contract `src/data/types.ts`: `ScanResponse.grid?`, `GridScan`, `GridFinding`, `CellCode`, `GRID_JSON_SCHEMA` added. The demo clip still uses boxes. A live scan call takes about 8 to 25 s.
- Sat Nov 14: Scan overlay is now real segmentation (partner, please read). `/api/segment` sends a 1024 px frame to Roboflow SAM3 (`ROBOFLOW_API_KEY`, server only; retries a 5xx twice); the browser colours each mask pixel by HSV (`src/lib/fuelMask.ts`: straw/tan = risk, green = clear, dirt/sky/posts/dark trunks = neutral) and scores risk / (risk + clear). `/api/findings` has gpt-6.1-terra write words for the measured areas only. Grid scan removed. Shared contract `src/data/types.ts`: grid types and `GRID_JSON_SCHEMA` removed; `RiskAreaInput`, `AreaNote`, `FINDINGS_JSON_SCHEMA` added. If Roboflow fails the overlay falls back to colour only.
- Sat Nov 14: Scanner eval harness (`npm run eval:fetch|label|run`, scripts in `scripts/eval/`, report in `eval/report.md`, images/cache gitignored). Scan core is now pure TS (`scan()`/`rasterise()` in `src/lib/fuelMask.ts`; browser `analyse()` wraps it) and `src/lib/segment.ts` exports `segmentBody()` so the eval sends the app's exact request. First baseline ran on 66 images; VegAnn and the dirt buckets did not download yet.
- Sat Nov 14: Scan accuracy pass (partner, please read). `/api/segment` now returns `{ masks: [{ group: "dry"|"live"|"exclude", polys }] }` instead of `{ polygons }`; `src/lib/segment.ts` has 16 prompts in three groups (exclude includes snow and autumn grape leaves), `output_prob_thresh` 0.3 with per-group confidence filters. `src/lib/fuelMask.ts`: exclude masks win, dry masks use a wide pale/pink band, unmasked tan needs grassy texture, risk specks are dropped from the map itself, "All clear" only at zero risk pixels, smoothing r=1. Cache keys are v2. Eval report now lists probable GPT label errors separately instead of counting them.
- Sat Nov 14: `/api/estimate` wired into the scan flow (partner, please read). The hook calls it in parallel with `/api/segment` (12 s client timeout, aborted with the scan) and the headline dry % and risk level use `dry_pct` when it returns, else the SAM share. The SAM overlay is unchanged. `src/lib/scanView.ts` gets `ScanEstimate` and `headlineVerdict`.
- Sat Nov 14: One headline share drives every dry number on the scan screen (partner, please read). `src/lib/useScanSession.ts`: `fetchNotes` takes the headline share (the estimate's `dry_pct` when it is in, else the SAM share) and sends it to `/api/findings`; the notes cache key is now `notes:v2:{c|s}:{share %}:{area boxes}:{hash}`. The status chip says "N dry areas" for fuel maps (old "N risks found" stays for the demo clip), and the findings list adds "Smaller patches: X% of the dry fuel" when unlisted areas hold 5% or more.
- Sat Nov 14: `scan()` takes the estimate's 6x8 grid (partner, please read): risk pixels in "soil"/"other" tiles go neutral before smoothing, specks and areas; no grid gives the same map as before. `useScanSession` builds with the grid if `/api/estimate` is back, else rebuilds once when it lands (no extra requests); the VLM eval passes the cached grid into the overlay scan. v2 VLM eval: headline-vs-overlay gap 60/153 to 54/153 (mean 19.8 both), dirt FP 2/29 and pass 73% / MAE 14.2 unchanged.
- Sat Nov 14: `scan()` takes the estimate's `dryPct` next to the grid and reconciles the overlay to it (partner, please read). With both: soil/other tiles drop RISK (except SAM dry-mask pixels) and CLEAR; then if the share is over 15 pts below the headline, "dry" tiles fill with pixels `dryColourOf` calls RISK (no texture check, exclude masks still win); if over 15 pts above, "live" tiles lose RISK outside SAM dry masks. Then smooth, specks, verdict, areas as before. No grid or no dryPct gives the PR 20 map. `useScanSession` passes the estimate's grid and `dry_pct` (same single rebuild); the VLM eval passes `dryPct`. v2 VLM eval: gap 54/153 to 38/153 (mean 19.8 to 12.0), dirt FP 2/29 and pass 73% / MAE 14.2 unchanged.
- Sat Nov 14: Offline sample photos and request timeouts on the scan screen (partner, please read). `public/demo/sample-hillside.jpg` and `sample-row.jpg` are own SRV2/SRV6 at 1024 px, JPEG 0.85 (266 and 275 KB); `public/demo/samples.json` holds each still's `/api/segment` masks (from the eval cache for that exact frame) and its `/api/estimate` reply (one call each, made once), no notes yet. `src/lib/samples.ts` imports it. `useScanSession` gets `startSample(id)` (puts the saved masks and estimate into the in-memory cache under the still's hash, so the normal photo path runs with no requests, words = saved notes or none) and `retry()` (maps the same photo or frozen frame again). Client timeouts: `/api/segment` 20 s (then colour only), `/api/findings` 12 s (then no words), `/api/estimate` still 12 s via the same `timed()` helper. A photo with no map and no estimate sets `problem`; the screen then says "Could not reach the scanner. Try again, or use a sample photo." with Retry and the samples. Nothing warms the APIs.
