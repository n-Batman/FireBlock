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
