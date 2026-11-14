# FireBlock design system

Every UI change follows this file. If a change needs something this file does not allow, update this file first, in the same commit.

Format: the standard DESIGN.md sections (theme, color, type, components, layout, depth, do and don't, responsive, agent guide).

## 1. Visual theme and atmosphere

A map-first night instrument for a vineyard manager. Think Watch Duty (the map is the product), Apple Maps (floating controls, nothing boxed in), and the Tesla app (dark, calm, confident). It is not a dashboard.

- The satellite map fills the screen. Everything else floats on it as frosted glass.
- The map tiles are desaturated and dimmed so the only strong colors on screen are risk colors.
- One theme only: dark. A dimmed map needs dark chrome, so there is no light mode. This is deliberate and replaces the earlier light/dark pair.
- Quiet by default. Motion and color appear only to show change in risk.
- Honest. It is an estimate of where to work first, never a prediction. Every number says where it came from and when.
- Dials: variance 4, motion 4, density 5.

## 2. Color palette and roles

Green, amber and red are used for risk and for nothing else. There is no brand accent. The primary action is the light ink color itself.

### Neutrals

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#0e1512` | Page background, visible only while the map loads |
| `--surface` | `#141d18` | Solid panels, and the fallback when glass is unsupported |
| `--ink` | `#e9eee8` | Primary text, primary buttons (never pure white) |
| `--ink-2` | `#a4b4aa` | Secondary text, captions, sources |
| `--line` | `#26362d` | Solid dividers and borders |

### Risk (the only color)

| Level | Strong | Chip background | Chip text |
|---|---|---|---|
| Low | `#5db67f` | `#173325` | `#8fd6ab` |
| Medium | `#e0a83a` | `#392c10` | `#f0c879` |
| High | `#e5675a` | `#3d1c17` | `#f5a398` |

Levels: score under 35 is low, 35 to 64 is medium, 65 and up is high.

### Glass

| Token | Value |
|---|---|
| `--glass-bg` | `rgba(16, 24, 20, 0.62)` (allowed range 0.55 to 0.7) |
| `--glass-border` | `rgba(233, 238, 232, 0.14)` |
| `--glass-highlight` | `rgba(255, 255, 255, 0.06)` (1px inner top edge) |

### Map and scanner colors

- Map tile filter (tile layer only): `saturate(.65) brightness(.72) contrast(1.15)`. Overlays are never filtered.
- Scanner: risk boxes use the High red, cleared boxes use the Low green, status chip follows the same two colors. Dimmed camera edges are `rgba(0, 0, 0, 0.45)`.

## 3. Typography

Geist for text, Geist Mono for numbers. No serif. Numbers use tabular figures so they do not jump while counting.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| Score | 48 / 48 | 600, mono | The block score |
| Title large | 24 / 32 | 600, tracking -0.02em | Panel headings, days left |
| Title | 18 / 24 | 600 | Block names |
| Body | 15 / 22 | 400 | Reasons, summaries |
| Small | 13 / 20 | 400 to 500 | Labels, weather strip |
| Caption | 12 / 16 | 400 | Sources, timestamps |

Body text maximum width 65ch. Sentence case everywhere. No em-dashes in any visible text; use a hyphen or two sentences.

## 4. Components

- **Glass panel.** Background `--glass-bg`, `backdrop-filter: blur(20px) saturate(1.2)` plus the `-webkit-` version, 1px `--glass-border`, inner top highlight, radius 16px. No drop shadow beyond `0 1px 2px rgb(0 0 0 / 0.2)`. If `backdrop-filter` is unsupported or `prefers-reduced-transparency` is set, use solid `--surface`.
- **Button primary.** Ink background, paper text, 44px high, radius 8px. Hover opacity .9, active scale .98.
- **Button secondary.** Transparent, 1px `--glass-border`, ink text, 44px high. Disabled: ink-2 text, no hover.
- **Risk chip.** Level word plus optional score, tinted background from the risk table, radius 8px, 12px semibold.
- **Block row.** Name, chip, then one plain-words reason under it. Selected: 3px ink bar on the left plus a slightly lighter glass.
- **Factor row.** Label, `+points of max`, thin bar (fills left to right), reason, then source and timestamp in caption size.
- **Weather strip.** One glass pill: wind with direction, humidity, Red Flag status, active fires within 25 mi, and "Updated X ago". Every value comes from data. No placeholders.
- **Status chip (scanner).** Glass pill, top center. "Scanning..." neutral, "Area looks clear" green, "N risks found" red. Announced with `aria-live="polite"`.
- **Focus.** 2px ink outline, 2px offset, on every interactive element, never removed.
- **States.** Every data view has loading (skeleton shaped like the content), empty (says what to do next) and error (says what happened and offers retry).

## 5. Layout principles

- 8px grid. Spacing scale: 4 (tight inside a control), 8, 16, 24, 32, 48.
- Floating panels sit 16px from the viewport edges.
- Radius scale (one rule): controls, chips, inputs 8px. Glass panels and sheets 16px. Pills (status chip) fully round.
- No cards inside cards. Group with spacing and a 1px divider.
- Desktop: map full-bleed. Left glass panel (blocks), top-center weather strip, right glass panel (breakdown, slides in), bottom-center legend.
- The map re-fits to the free space whenever a panel opens, so a selected block is never hidden.

## 6. Depth and elevation

Depth comes from blur and a hairline border, not shadow. Three levels only: map (0), glass panels (1), modal slide-over such as Data and limits (2, with a 40% ink-tinted scrim).

## 7. Do and don't

Do:
- Let the map be the hero.
- Show what drove every score, in plain words, with source and time.
- Use risk color only where risk is meant.
- Keep numbers in mono with tabular figures.

Don't:
- No purple, no gradients as decoration, no neon glows, no pure black or pure white.
- No generic card grids, no three-equal-boxes rows.
- No decorative dots, no emoji, no scroll cues, no version stamps.
- No em-dashes in copy. No words like seamless, elevate, unleash.
- Never call the score a prediction, never certify a property as safe.
- Never animate map tiles. Animate overlays and panels only, with transform and opacity.

## 8. Responsive behavior

- Breakpoints: 640, 768, 1024, 1280. Main layout switches at 1024.
- Minimum tap target 44 by 44px. Minimum body size 15px.
- Under 1024px: top controls stack in two glass rows; blocks and breakdown become glass bottom sheets (max 45% of viewport height for blocks, 70% for the breakdown) over the full-bleed map; the map re-fits above the sheet.
- Camera screen is full-bleed on every size.
- Keyboard: every control reachable in a logical order, Escape closes panels.

## Motion

- Timings: press and hover 150ms, panels and bars 220ms, block fade and score count-up 300ms. Nothing is longer than 300ms. Stagger steps are 60ms.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Blocks fade in ordered by risk (high first). Score counts up. Factor bars fill from the left. Panels slide in (24px) while fading.
- Only `transform` and `opacity` animate. Map tiles never animate.
- `prefers-reduced-motion: reduce` turns all of it into instant state changes (motion library `reducedMotion="user"` plus CSS).

## Scanner visual language

- Full-bleed camera. Edges dimmed by a soft radial vignette so attention goes to the center.
- Corner-bracket reticle: four L-shaped corners, 2px stroke, 28px arms, inset 12% from the edges, ink color.
- Sweep line: a 2px line with a soft fade, travels top to bottom in a 1.5s linear loop, transform only. Paused when reduced motion is on.
- Detection boxes: 2px border plus 12% tint of the risk color. Red means risk (dry growth over 4 ft, brush touching a structure). Green means cleared. Below each box a short label and the action, for example "Dry growth - mow by June 1".
- Boxes ease to new positions in 200ms, stay for 2 to 3 missed frames, then fade out. The status chip flips only after 2 consistent frames.
- Result line: "Scan changed score from 58 to 71", with the score in mono.

## 9. Agent prompt guide

Quick reference when generating UI for this project:
- Dark only. Background `#0e1512`, text `#e9eee8`, secondary `#a4b4aa`.
- Risk colors `#5db67f` `#e0a83a` `#e5675a`. Nothing else is colored.
- Panels use the `.glass` utility. Controls radius 8, panels 16, buttons 44px high.
- Motion with `motion/react`, 150 to 300ms, transform and opacity only, honor reduced motion.
- Copy is plain and short, sentence case, no em-dashes.

Ready-to-use prompts:
- "Add a floating glass panel (`.glass`) that slides in from the right over the map, with a 44px ink primary button."
- "Show this number in Geist Mono with tabular figures and count it up over 300ms."
