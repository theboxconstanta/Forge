# Forge PWA — Typography System Refinement

A font-only refinement pass across the entire PWA. No layout, spacing, padding, margin, color, border, radius, shadow, component-structure, navigation, calendar-behavior, backend, database, or state-management changes — every handler, every piece of state, and every derived value referenced by the touched JSX is exactly the same as before this pass. Only `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, and (new) `fontVariantNumeric` values changed.

## Font family migration

- **Before**: `system-ui, -apple-system, sans-serif` at the `body` level, but effectively **overridden back to `'system-ui'`** almost everywhere by ~27 scattered inline `style={{ fontFamily: 'system-ui' }}` literals in `App.jsx`/`ActivationDashboard.jsx` — including on `.app-frame`, the root layout container that sits directly between `body` and the entire rendered UI, meaning a CSS-only change to `body` would never actually have reached the screen.
- **After**: **Inter** (self-hosted via `@fontsource-variable/inter`, `wght.css` entry point — non-italic, weight-axis-only, covering exactly the 400/500/600/700 weights this app uses, no italic anywhere in the UI). Installed as an ordinary npm dependency so Vite bundles the font files as build assets, which the existing service worker precache (`vite-plugin-pwa`, `generateSW`) picks up automatically like every other asset — this app is an offline-capable installed PWA, so a Google Fonts CDN link was deliberately rejected (render-blocking cross-origin request, fails entirely offline).
- `body { font-family: 'Inter Variable', system-ui, -apple-system, sans-serif; }` is now the **single source of truth**. All ~27 previous `fontFamily: 'system-ui'` inline overrides were changed to `fontFamily: 'inherit'`, so they correctly cascade from that one CSS rule instead of silently re-pinning `system-ui`. Any future font change now only requires editing one CSS line. The one deliberate exception left untouched: a debug-overlay's `fontFamily: 'monospace'` (intentional, non-UI).
- Live verification: fetched the deployed CSS bundle and confirmed `"Inter Variable"` and `"woff2-variations"` are present; fetched the deployed JS bundle and confirmed (via per-occurrence, not per-line, grep) `inherit` × 30, `fontFamily` × 30.

## Typography hierarchy — before vs. after

| Element | Before | After |
|---|---|---|
| Greeting ("Hey Lucian, let's get after it today.") | 13px/500, no explicit line-height | 13px/500, line-height **1.4** |
| Month title ("August 2026") | 27px/700, letter-spacing `-0.5px`, line-height 1.15 | **28px/700**, letter-spacing **-0.02em**, line-height **1.1**, `tabular-nums` |
| Section labels (TODAY, WORKOUT OF THE DAY) | 700 weight, letter-spacing `0.1em` | **600 weight**, letter-spacing **0.08em** — more editorial, less shouty |
| Calendar tile — day letter | 10px/600 | **11px/500** |
| Calendar tile — day number | 19px/700 | **22px/600**, `tabular-nums` |
| Calendar tile — month abbreviation | 10px/500 | **11px/400** |
| Class card — class name | 15px/700 | **20px/600** |
| Class card — coach name | 13px, no explicit weight | **14px/400** |
| Class card — occupancy ("6/14") | 13px/600 | **15px/500**, `tabular-nums` |
| Class card — time ("10:00") | 14px/800 | **22px/700**, `tabular-nums` |
| WOD card — "No WOD today" / title | 17px/600 | **22px/600** — confident, not oversized |
| Membership card — primary values (session count) | 14px/700 | **20px/600**, `tabular-nums` |
| Membership card — "Unlimited" | 12px | **20px** (matched to the primary-value size it stands in for) |
| Membership card — secondary values ("days left") | 11px, no explicit weight | **13px/400**, `tabular-nums` |
| Membership card — plan name | 600 weight | **400 weight** (secondary detail, not a value) |
| Participant list — name | 14px | **17px/500** |
| Participant list — "Check in" (interactive button) | 12px/700 | **14px/600** |
| Participant list — "Checked in" (read-only) | 12px | **14px** |
| Participant list — check-in-only label (non-interactive) | 12px | **14px/600** |

## Numeric refinement (`tabular-nums`)

`font-variant-numeric: tabular-nums` added at the **container level** (no new wrapper elements — the property is a no-op on non-digit glyphs, so it's safe on elements with mixed text like "10:00 · Coach Name"), applied to: month title, calendar tile day-number, class card time and occupancy, bottom-sheet header time, header session-count, membership session-count and "days left", and — in the Leaderboard screen — rank badges, logged-at timestamps, and primary/secondary result values.

Live verification (per-occurrence grep on the deployed bundle, after an initial per-*line* grep undercounted because the minified bundle is a single line): `tabular-nums` × 13 occurrences present in production.

## Files changed

- `src/index.css` — `@fontsource-variable/inter/wght.css` import, `body` font-family updated.
- `package.json` / `package-lock.json` — `@fontsource-variable/inter` added.
- `src/App.jsx` — 23 `fontFamily: 'system-ui'` → `'inherit'`; every typography value listed above (Home screen + Leaderboard screen); `tabular-nums` additions.
- `src/ActivationDashboard.jsx` — 4 `fontFamily: 'system-ui'` → `'inherit'`.

Deliberately not touched: WOD variant-picker internals (movement list, notes, format description — already finalized in an earlier pass), and minor uppercase micro-labels not explicitly named in the mission's "Section labels" examples (e.g. "PARTICIPANTS (n/max)") — left alone to avoid unrequested scope creep.

## Confirmation: no layout, spacing, color, or architecture changes

- Zero changes to `padding`, `margin`, `width`, `height`, `gap`, `borderRadius`, `border` color/width, `boxShadow`, or background colors anywhere in this pass.
- Zero new components, zero changed DOM structure — `tabular-nums` was applied to existing elements only.
- Zero changes to navigation, calendar date-selection logic, `scrollChipToDate`, booking, attendance, check-in, membership, or realtime code. Every `onClick`/handler/state reference in every touched JSX block is byte-for-byte the same as before this pass, only the surrounding `style` object's typography properties differ.
- Zero backend, database, RPC, or Supabase query changes.

## Testing

- TypeScript / ESLint: 0 new errors.
- Full test suite: passing (same pre-existing, unrelated Deno Edge-Function failures as every prior mission this session).
- Production build: clean.

## Deployment verification

- Commit `9e3e66a` pushed to `main`, deployed.
- Live CSS bundle (`index-SUODKOMP.css`): confirmed `"Inter Variable"` and `"woff2-variations"` present.
- Live JS bundle (`index-YobhzXJD.js`, confirmed full 1,087,888 bytes via verbose `curl` after an initial fetch returned a transient truncated response): per-occurrence grep confirmed `inherit` × 30, `fontFamily` × 30, `tabular-nums` × 13 present in production.
- `app_version` bumped to `9e3e66a` so already-open PWA sessions refresh within seconds rather than waiting up to 30 minutes.

TYPOGRAPHY SYSTEM REFINEMENT COMPLETE
