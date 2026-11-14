# FireBlock Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three-screen vineyard fire-prep planner (map with block scores, score breakdown, plan with PDF export) running on 3 cached demo properties.

**Architecture:** Next.js App Router, all data from typed JSON fixtures in `src/data`. Pure logic (scoring, countdown, plan) lives in `src/lib` and is unit-tested; UI components are thin. Screen 2 is a right-side panel over the map, Screen 3 is its own route.

**Tech Stack:** Next.js + TypeScript, Tailwind, react-leaflet, Vitest + Testing Library, window.print() with a print stylesheet for PDF export.

**Spec:** `docs/superpowers/specs/2026-11-13-fireblock-frontend-design.md`

## Global Constraints

- Use the `taste-skill` for ALL UI work. No purple gradients, no generic card grids, no default component-library look.
- Green/amber/red mean risk only. Warm paper background, dark ink-green text, one serif (headings), one sans (numbers), 8px spacing grid.
- Every score shows what drove it, in plain words.
- Map badge text is exactly `0 active fires within 25 mi`.
- Each left-rail block row shows score AND a one-line plain-words reason under it.
- "Data & limits" text is verbatim from the spec section of that name. Never reworded.
- Never call the score a prediction. Habitat blocks are never scored and never mowed.
- After each screen: use `/playwright-cli` to screenshot at desktop and 390px width, look at it, fix anything that looks vibe-coded. A screen is not done until its screenshot was viewed.
- If a check fails 3 times, stop and tell the user instead of guessing.
- Do not commit or push unless the user asks. No attribution lines in any commit message.
- Demo properties: Adelaida Hills (high), Paso Hwy 46 East (medium), Edna Valley (low). All data is sample data cached Nov 13, 2026 and must be labeled as such.

## Review Focus

- Property with a past fire nearby and `activeFires25mi: 0`: badge says 0 active fires while the history factor still cites the old fire. No contradiction, both render.
- Score exactly 35 and exactly 65: boundaries land in `medium` and `high` respectively.
- Hourly rate cleared, `0`, negative, or non-numeric: plan keeps the last valid rate, never shows NaN or $0.
- Edna Valley (all blocks low): plan page shows an explicit "no urgent mowing" state, not a broken or empty table.
- Today is June 1 or after: countdown reads "Deadline today" or counts to next year's June 1, never a negative number.

---

### Task 1: Scaffold, types, fixtures, pure logic

**Files:**
- Create: `package.json` (via create-next-app), `src/data/types.ts`, `src/data/properties.ts`, `src/lib/score.ts`, `src/lib/countdown.ts`, `src/lib/plan.ts`
- Test: `src/lib/score.test.ts`, `src/lib/countdown.test.ts`, `src/lib/plan.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Level = 'low'|'medium'|'high'`; `FactorKey = 'fireWeather'|'fuelDryness'|'slope'|'hazardZone'|'fireHistory'`; `Factor {key, label, points, max, reason, source, asOf}` (maxes 35/25/15/15/10); `Block {id, name, kind:'vine'|'habitat', acres, polygon:[number,number][], factors:Factor[], summary, reason}` (habitat blocks have `factors: []`); `Property {id, name, center:[number,number], blocks:Block[], activeFires25mi:number, cachedAt:string}`.
- Produces (`score.ts`): `scoreOf(block): number` (sum of points, rounded); `levelOf(score): Level` (<35 low, <65 medium, else high); `rankBlocks(blocks): Block[]` (vine blocks only, highest score first).
- Produces (`countdown.ts`): `daysUntilJune1(today: Date): number` (0 on June 1; after June 1 counts to next year's).
- Produces (`plan.ts`): `parseRate(input: string, previous: number): number`; `buildPlan(property, rate): {items:{order, block, hours, cost}[], totalHours, totalCost, urgent:boolean}` using `HOURS_PER_ACRE = 1.2` (my call, labeled "assumption" in UI); habitat excluded; `urgent` false when no block is high or medium.

- [ ] **Step 1:** Scaffold with create-next-app (TypeScript, Tailwind, App Router, src dir) in the repo root; add `react-leaflet leaflet vitest @testing-library/react jsdom`. `npm run dev` serves the default page.
- [ ] **Step 2:** Write `score.test.ts`: `levelOf(34)==='low'`, `levelOf(35)==='medium'`, `levelOf(64)==='medium'`, `levelOf(65)==='high'`; `rankBlocks` returns descending scores and omits habitat; `scoreOf` equals the sum of factor points. Run `npx vitest run`, expect FAIL.
- [ ] **Step 3:** Implement `types.ts` and `score.ts` per Interfaces. Run, expect PASS.
- [ ] **Step 4:** Write `countdown.test.ts`: `daysUntilJune1(new Date(2026, 10, 13))===200`; `new Date(2027, 5, 1)` gives 0; `new Date(2027, 5, 2)` gives 365 (2028 is a leap year). Build dates with local-time constructors, not ISO strings, so timezone can't shift the day. Implement `countdown.ts`. Run, expect PASS.
- [ ] **Step 5:** Write `plan.test.ts`: `parseRate('', 90)===90`, `parseRate('abc', 90)===90`, `parseRate('-5', 90)===90`, `parseRate('0', 90)===90`, `parseRate('75', 90)===75`; `buildPlan` orders by score descending, never includes habitat, `totalCost === sum(items.cost)`, changing rate rescales cost; Edna Valley plan has `urgent === false`. Implement `plan.ts`. Run, expect PASS.
- [ ] **Step 6:** Write `properties.ts` with the 3 properties: 3 to 5 vine blocks each plus one habitat block for Adelaida and Paso, sample polygons near the real areas, `cachedAt: '2026-11-13T07:00:00-08:00'`. Adelaida blocks 3 and 5 score high (3: 78); `activeFires25mi: 0` for all; Adelaida's `fireHistory` factor reason cites an unnamed past perimeter about 4 miles away (sample). Each block has a plain-words `reason` and `summary`. Add a test that every property's block scores match the intended level. Run, expect PASS.

### Task 2: Design system, shell, Data & limits panel

**Files:**
- Create: `src/app/layout.tsx` (fonts, tokens), `src/app/globals.css` (color tokens, spacing, print styles), `src/components/TopBar.tsx`, `src/components/DataLimitsPanel.tsx`, `src/content/dataLimits.ts`
- Test: `src/components/DataLimitsPanel.test.tsx`

**Interfaces:**
- Consumes: `Property` from Task 1.
- Produces: `TopBar({properties, activeId, onChange, cachedAt})`; `DataLimitsPanel({open, onClose})`; `DATA_LIMITS_TEXT: string` (verbatim spec text).

- [ ] **Step 1:** Write `DataLimitsPanel.test.tsx`: when open, it renders the phrases "interim data, final maps expected 2026", "It is not a fire prediction.", and "Demo version: 3 properties, sample data cached Nov 13, 2026."; when closed, none render.
- [ ] **Step 2:** Implement the panel as a slide-over reading `DATA_LIMITS_TEXT`. Run, expect PASS.
- [ ] **Step 3:** Invoke `taste-skill`; define risk color tokens (low/medium/high) and ink/paper neutrals in `globals.css`, plus the type scale. Build `TopBar` with property switcher, "Data as of" timestamp, and the Data & limits link.
- [ ] **Step 4:** Screenshot the shell with `/playwright-cli` at desktop and 390px; fix issues.

### Task 3: Screen 1, property map

**Files:**
- Create: `src/app/page.tsx`, `src/components/RiskMap.tsx` (client-only), `src/components/BlockRail.tsx`, `src/components/HotspotBadge.tsx`, `src/components/Legend.tsx`
- Test: `src/components/BlockRail.test.tsx`, `src/components/HotspotBadge.test.tsx`

**Interfaces:**
- Consumes: `rankBlocks`, `scoreOf`, `levelOf`, `daysUntilJune1`, `Property`.
- Produces: `BlockRail({property, selectedId, onSelect})`; `HotspotBadge({count})` renders exactly `${count} active fires within 25 mi`; `RiskMap({property, selectedId, onSelect})` with risk-colored vine polygons and hatched habitat polygons.

- [ ] **Step 1:** Write tests: `BlockRail` rows appear worst-first, each row shows the score AND that block's `reason` text beneath it, and the June 1 countdown is shown; `HotspotBadge count={0}` text equals `0 active fires within 25 mi`.
- [ ] **Step 2:** Implement components; load `RiskMap` via `dynamic(..., {ssr:false})`. Run tests, expect PASS.
- [ ] **Step 3:** Compose `page.tsx` with `TopBar`, rail, map, badge, legend; selecting a block sets `selectedId` (panel comes in Task 4). Switching property resets selection.
- [ ] **Step 4:** Run `npm run dev`, verify all 3 properties render and switch. Screenshot with `/playwright-cli` at desktop and 390px; fix issues. This completes tonight's checkpoint.

### Task 4: Screen 2, score breakdown panel

**Files:**
- Create: `src/components/BreakdownPanel.tsx`
- Modify: `src/app/page.tsx` (render the panel for the selected block)
- Test: `src/components/BreakdownPanel.test.tsx`

**Interfaces:**
- Consumes: `Block`, `scoreOf`, `levelOf`.
- Produces: `BreakdownPanel({block, onClose})`: score and level, `block.summary`, five factor rows (bar, `+points`, `reason`, `source`, `asOf`), collapsed "Adjust weights" (display-only sliders for now), buttons "Add photos from the rows" and "See plan" (links to `/plan?property=<id>`), empty photo-correction slot labeled for the scan.

- [ ] **Step 1:** Write test: renders 5 factor rows whose displayed points sum to the displayed score, each row shows reason + source + timestamp, and the photo-correction slot is present.
- [ ] **Step 2:** Implement and wire into `page.tsx`. Run tests, expect PASS.
- [ ] **Step 3:** Screenshot with `/playwright-cli` at desktop and 390px (panel becomes a bottom sheet on narrow screens); fix issues.

### Task 5: Screen 3, plan page and PDF export

**Files:**
- Create: `src/app/plan/page.tsx`, `src/components/PlanTable.tsx`, `src/components/RateInput.tsx`
- Test: `src/components/PlanTable.test.tsx`

**Interfaces:**
- Consumes: `buildPlan`, `parseRate`, `daysUntilJune1`, `Property`.
- Produces: `PlanTable({plan})`; `RateInput({value, onChange})` uses `parseRate`; page has an Export PDF button calling `window.print()` with print CSS hiding chrome; shows habitat no-mow note with buffer; countdown shows "Deadline today" at 0.

- [ ] **Step 1:** Write tests: `PlanTable` lists blocks in order with hours and cost and a total equal to the sum; with `urgent:false` it shows a "no urgent mowing" message; entering "abc" in `RateInput` keeps the previous rate and never renders `NaN`.
- [ ] **Step 2:** Implement and run, expect PASS. Label the hourly rate and hours-per-acre as assumptions.
- [ ] **Step 3:** Screenshot desktop, 390px, and print preview with `/playwright-cli`; fix issues. Verify Export PDF produces a clean one-page layout.

### Final check

- [ ] Run `npx vitest run` (all PASS) and `npm run build` (succeeds). Walk all 3 properties through all 3 screens and report to the user with screenshots viewed.
