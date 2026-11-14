# FireBlock task board (single source of truth)

**Every AI (Claude, Codex) and every human reads this file first, before writing any code.**
When you finish or start a task, update its status here in the same commit. Don't delete rows; mark them.

Status keys: `TODO` · `DOING (who)` · `DONE` · `BLOCKED: why`

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

### Milo (product, words, proof, pitch)
| ID | Task | Status |
|---|---|---|
| M1 | Commit current frontend and push to GitHub (nothing is committed yet) | DONE |
| M2 | Screen 1, property map: rail, map, badge, legend, Data & limits (plan Tasks 1–3) | DONE |
| M3 | Screen 2, score breakdown panel (plan Task 4) | TODO |
| M4 | Screen 3, plan page and PDF layout (plan Task 5) | TODO |
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

## Rubric reminder (100 pts)
Execution & design 25 · Real problem/real user 25 (tiebreaker) · Path to customers 20 · Pitch & demo 15 · Creative AI 15

## Bugs / confusing things (from testing)
- _none yet_

## Decisions log
- Fri Nov 13: Stack is Next.js + Leaflet + Tailwind with JSON fixtures, deployed on Vercel. Hero user is the vineyard owner; insurers are the buyer of the data.
- Fri Nov 13: Detailed frontend plan in `docs/superpowers/plans/2026-11-13-fireblock-frontend.md`, design in `docs/superpowers/specs/`.
