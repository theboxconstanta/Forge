# Forge PWA — Typography Overhaul Inspired by btwb

A third typography-only pass on top of `TYPOGRAPHY_2_0_REFINEMENT_REPORT.md`, targeting a btwb (Beyond the Whiteboard) iOS-style scale: more compact, more restrained, with weight differences used deliberately rather than as a default. No layout, spacing, padding, margin, color, border, radius, shadow, component-structure, navigation, calendar-behavior, backend, database, or state-management changes.

## Font

Unchanged from Typography 2.0 — `-apple-system, BlinkMacSystemFont` already lead the stack (the only correct way to request the real SF Pro / SF Pro Text on the web), falling back to the self-hosted Inter Variable everywhere else. Nothing to add for this pass.

## Typography scale — 2.0 vs. btwb

| Element | Typography 2.0 | btwb pass |
|---|---|---|
| Month title ("August 2026") | 26px/600, line-height 30px | **24px/600**, line-height **28px** (letter-spacing -0.02em unchanged) |
| Greeting | 14px/400, line-height 20px | unchanged — already matched the target |
| Section labels (TODAY, WORKOUT OF THE DAY) | 12px/600, uppercase, 0.08em | unchanged — already matched the target |
| Calendar — weekday letter | 11px/400 | **11px/500** |
| Calendar — day number | 20px/500 | unchanged — already matched the target |
| Calendar — month abbreviation | 11px/400 | unchanged — already matched the target |
| Class card — class name | 18px/500 | **18px/600** |
| Class card — coach name | 14px/400 | unchanged — already matched the target |
| Class card — occupancy | 15px/500 | unchanged — already matched the target |
| Class card — time | 21px/600 | **20px/600** |
| WOD card — "No WOD today" / title | 20px/500 | **20px/600** |
| WOD card — metadata line(s) | 13px/400, line-height 1.5 | 13px/400, line-height **18px** (explicit px per spec, same visual ratio) |
| Membership — "Unlimited" | 18px/500 | **18px/600** |
| Membership — session count ("4 ședințe") | 17px/500 | unchanged — already matched the target |
| Membership — "days left" | 13px/400 | unchanged — already matched the target |
| Roster — participant name | 17px/500 | unchanged — already matched the target |
| Roster — "Check in" button/label | 14px/600 | unchanged — already matched the target |
| Roster — "Checked in" (button + read-only span) | 14px/**500** | 14px/**600** — the btwb brief gives one weight for "Check in / Checked in" as a single scale entry, so both states now read the same weight (consistent with the existing "don't make the selected calendar day bolder" precedent: state is signaled by color, not boldness) |
| Tab bar label | 10px, weight 600 active / 400 inactive | **11px, weight 500 both states** — active/inactive is now signaled by color alone (`#111111` vs `#9CA3AF`), matching the calendar day-number precedent |

Everything not listed (WOD badge label, "Reserved"/"Waitlisted"/"Full" pills, CTA buttons, bottom-sheet header, avatar initials) was left exactly as Typography 2.0 set it — not named in this pass's scale, and already inside the 400/500/600 range the brief asks for.

## Numeric refinement (`tabular-nums`)

Unchanged — 13 occurrences in source both before and after this pass, confirmed still present in the deployed bundle.

## Confirmation: no layout, spacing, color, or architecture changes

- Zero changes to `padding`, `margin`, `width`, `height`, `gap`, `borderRadius`, `border`, `boxShadow`, or background colors.
- Zero new components, zero changed DOM structure.
- Zero changes to navigation, calendar date-selection logic, booking, attendance, check-in, membership, or realtime code — every `onClick`/handler/state reference in every touched block is identical to before this pass. The check-in button's `fontWeight` reverted from a conditional (Typography 2.0) back to a flat `'600'` — a pure style-object change, no logic touched.
- Zero backend, database, RPC, or Supabase query changes.

## Testing

- ESLint on `src/App.jsx`: 0 errors, same 11 pre-existing `Unused eslint-disable directive` warnings as every prior mission.
- Full test suite: 495/495 real tests passing (same pre-existing, unrelated Deno Edge-Function `@std/assert` resolution issue in 9 test files, unchanged from every prior mission this session).
- Production build: clean, same pre-existing single-chunk size warning (deliberately-deferred code-splitting item).

## Deployment verification

- Commit `2e9663c` pushed to `main`, deployed.
- Live JS bundle (`index-B0MxN7fM.js`, confirmed full 1,087,959 bytes via verbose `curl` header check): `tabular-nums` × 13 (matches source), `text-[11px]` (new tab-bar label class) present, `24px` (new month title) present.
- CSS bundle hash unchanged (`index-CEUxf1cw.css`) since this pass touched no CSS.
- `app_version` bumped to `2e9663c` so already-open PWA sessions refresh within seconds.

## Visual self-review

As with every prior UI mission on this codebase this session, no dedicated component-rendering harness exists for this single-file `App.jsx` and I never log in as any user — so a literal tap-through on a real device was not performed. What this pass's own construction guarantees: every named element in the btwb brief was cross-checked against its exact target and updated where it differed; the two places where the brief gives one weight for a two-state element (check-in button, tab bar label) were resolved by unifying weight and relying on color for state, consistent with the app's own existing convention for the calendar's selected day. This remains the user's own next step to confirm visually.

BTWB TYPOGRAPHY REFINEMENT COMPLETE
