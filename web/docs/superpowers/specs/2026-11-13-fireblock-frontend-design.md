# FireBlock frontend design (2026-11-13)

## Intent
A fire-prep planner for SLO vineyard owners. Hero user: an owner like Dr. Vidya Schalk, who must clear dry growth by the county's June 1 deadline, pays $34-150/hr for mowing, and must protect habitat areas. The frontend is the part judges see: it must look like a real product, not a hackathon template (25 pts execution and design).

## Goals
- Three screens: property map with block scores, score breakdown for one block, plan page with mowing order, hours, cost, PDF export.
- Every score shows what drove it, in plain words.
- Runs on 3 demo properties from cached sample data: Adelaida Hills (high), Paso Hwy 46 East (medium), Edna Valley (low).
- Tonight's checkpoint: map plus scores working on all 3 properties.

## Non-goals
- Live data fetching, accounts, storage, alerts, homeowner scanner, insurer features. (The partner swaps the cached JSON for real data later.)
- Photo scan UI beyond an empty "photo correction" slot and an "Add photos" button.

## Anti-goals
- Calling the score a "prediction". It is an estimate to decide where to work first.
- Purple gradients, generic card grids, default component-library look.
- Green/amber/red used for anything other than risk.

## Constraints
- Mobile-friendly; judges may open it on a phone.
- "Data & limits" text is the user's, used exactly as written (below).
- Consistency: the hotspot badge counts ACTIVE fires only; fire history is a separate factor. The two must never contradict (e.g. a historical fire 4 miles away with a badge reading 0 active fires is correct and intended).

## Approaches considered
1. Next.js + Leaflet + Tailwind with JSON fixtures (chosen, my call): matches the team's plan, deploys free on Vercel, partner can wire real data into the same shapes.
2. Plain Vite + React: lighter, but loses Vercel/Next conventions the partner expects.
3. Static HTML mockups: fastest, but throwaway.

## Layout (APPROVED by user, with two fixes applied)
- Screen 1 map: top bar (property switcher, data timestamp, Data & limits link); left rail with June 1 countdown and blocks sorted worst-first; map with risk-colored blocks, hatched no-mow habitat zones, hotspot badge, legend. Clicking a block opens screen 2 as a right-side panel.
  - FIX 1: the badge text is exactly "0 active fires within 25 mi" (not "0 fires...").
  - FIX 2: each block row in the left rail shows the score AND a one-line plain-words reason underneath (e.g. "Dry cover crop, Red Flag wind this week"), not just the score.
- Screen 2 breakdown: score and level, one-sentence summary, five factor bars (fire weather, fuel dryness, slope, hazard zone, fire history) with points, plain-words reason, source and timestamp each; collapsed "Adjust weights"; "Add photos" and "See plan" actions; empty photo-correction slot.
- Screen 3 plan: ordered mowing list (block, reason, hours, cost), no-mow habitat note with buffer, totals with editable hourly rate, deadline countdown, Export PDF.

## Look and feel (my call)
Warm paper background, dark ink-green text, muted map style. Risk colors green/amber/red only for risk. One serif for headings, one sans for numbers, 8px spacing grid. The taste skill governs UI work.

## Data & limits panel (verbatim from user)
Data & limits

What this score uses:
- Vegetation and fuel: Pacific Veg Map, fine-scale mapping
  for SLO County (interim data, final maps expected 2026)
- Fire hazard zones: CAL FIRE
- Weather: fire weather forecast, updated daily
- Fire history: recorded perimeters near this property

What it does not do:
- This is an estimate to help you decide where to work
  first. It is not a fire prediction.
- Map data can be months old. Dry grass on the ground
  today may not match the map. Walking the rows and
  the photo scan correct the score.
- Demo version: 3 properties, sample data cached
  Nov 13, 2026.

## Left to the builder
Exact block geometry for the 3 properties (sample polygons are fine), fixture file shape, map tile style, PDF export library. The June 1 countdown is computed from today's date, not hardcoded (the sketch's "199 days" was illustrative; from Nov 13, 2026 it is 200).
