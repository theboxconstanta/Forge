# Forge PWA — Typography 2.0 (Premium Apple-Like UI)

A second, deliberately lighter typography pass on top of `TYPOGRAPHY_SYSTEM_REFINEMENT_REPORT.md`. Strictly typography — no layout, spacing, padding, margin, color, border, radius, shadow, component-structure, navigation, calendar-behavior, backend, database, or state-management changes. The goal: reduce the number of Bold(700)/Extrabold(800) weights on the Home screen, shift the hierarchy onto Medium(500)/Semibold(600), and shrink the two most oversized elements (month title, WOD title) so the screen reads as quieter and more premium — closer to Apple Fitness/Calendar, Linear, ClassPass, Notion.

## Font family

`-apple-system, BlinkMacSystemFont` now lead the stack, ahead of the self-hosted Inter Variable from Typography 1.0. These are the only correct way to request the real SF Pro on the web — Apple does not license SF Pro for `@font-face` distribution outside its own platforms, so `-apple-system` (Safari iOS/macOS) and `BlinkMacSystemFont` (Chrome on macOS) resolve to it at zero extra network cost. Every other platform (Android, Windows, Linux) falls through to Inter Variable, unchanged from Typography 1.0.

```css
font-family: -apple-system, BlinkMacSystemFont, 'Inter Variable', system-ui, sans-serif;
```

## Typography hierarchy — 1.0 vs. 2.0

| Element | Typography 1.0 | Typography 2.0 |
|---|---|---|
| Greeting | 13px/500, line-height 1.4 | **14px/400**, line-height **20px** |
| Header session count (small stat) | 16px/**800** | 16px/**600** |
| Month title ("August 2026") | 28px/600, letter-spacing -0.02em, line-height 1.1 | **26px/600**, letter-spacing -0.02em (unchanged), line-height **30px** |
| Section labels (TODAY, WORKOUT OF THE DAY) | 12px/600, uppercase, letter-spacing 0.08em | unchanged — already matched the target |
| Calendar tile — day letter | 11px/500 | **11px/400** |
| Calendar tile — day number | 22px/600 | **20px/500** |
| Calendar tile — month abbreviation | 11px/400 | unchanged — already matched the target |
| Class card — class name | 20px/600 | **18px/500** |
| Class card — coach name | 14px/400 | unchanged — already matched the target |
| Class card — occupancy ("6/14") | 15px/500 | unchanged — already matched the target |
| Class card — time ("10:00") | 22px/**700** | **21px/600** |
| Class card — "Reserved" badge | 11px/**700** | 11px/**600** |
| Class detail sheet — header time+name | 19px/**800** | 19px/**600** |
| Class detail sheet — "PARTICIPANTS (n/max)" label | 11px/**700** | 11px/**600** |
| WOD card — "No WOD today" / title | 22px/600 | **20px/500** |
| WOD card — duration/format line | 12px, implicit weight | **13px/400**, line-height **1.5** |
| WOD card — format-config description line | 11px, implicit weight | **13px/400**, line-height **1.5** |
| WOD card — "Workout Done"/"Skill Work Done" badges | 11px/**800** | 11px/**600** |
| Membership card — session count ("4 ședințe") | 20px/600 | **17px/500** |
| Membership card — "Unlimited" | 20px/600 | **18px/500** |
| Membership card — "days left" | 13px/400 | unchanged — already matched the target |
| Roster — participant name | 17px/500 | unchanged — already matched the target |
| Roster — "Check in" (button/label) | 14px/600 | unchanged — already matched the target |
| Roster — "Checked in" (button + read-only span) | 14px/**600** | 14px/**500** (now conditional on `m.checkedIn`, so the same button reads 600 while offering "Check in" and 500 once it reads "Checked in") |
| "Book a spot" / "Log with [level]" CTA buttons | 14px/**700** | 14px/**600** — Apple's own filled buttons use Semibold, not Bold |

Numbers not listed (coach name, occupancy, section labels, participant name, "Check in" label, month-abbreviation, "days left") were already at or below the Typography 2.0 target from the prior pass and were left untouched.

## Numeric refinement (`tabular-nums`)

Unchanged from Typography 1.0 — no digit-bearing element lost its `font-variant-numeric: tabular-nums`. Verified identical count before and after this pass: **13 occurrences** in source, confirmed present in the deployed bundle.

## What was deliberately left alone

- The WOD variant-picker internals (movement list, notes, format description inside the expanded accordion) — already finalized across four dedicated visual passes in this session (`WORKOUT_VARIANT_ULTRA_MINIMAL_UI_REPORT.md`), out of scope for a Home-screen typography pass.
- Avatar-circle initials (decorative, inside a solid black circle, not part of the reading hierarchy).
- Any weight/size not reachable from the Home screen (this pass, like the mission brief, is scoped to the Home screen and its class-detail bottom sheet / roster, which doubles as the "Roster screen" named in the brief).

## Confirmation: no layout, spacing, color, or architecture changes

- Zero changes to `padding`, `margin`, `width`, `height`, `gap`, `borderRadius`, `border` color/width, `boxShadow`, or background colors.
- Zero new components, zero changed DOM structure.
- Zero changes to navigation, calendar date-selection logic, booking, attendance, check-in, membership, or realtime code — every `onClick`/handler/state reference in every touched block is identical to before this pass. The one place a value became conditional (`fontWeight: m.checkedIn ? '500' : '600'` on the check-in button) is a pure style-object change; the `onClick`/`disabled`/data logic is untouched.
- Zero backend, database, RPC, or Supabase query changes.

## Testing

- ESLint on the two touched files (`src/App.jsx`, `src/index.css` is not JS-lintable): 0 errors, same 11 pre-existing `Unused eslint-disable directive` warnings as every prior mission. (A full-repo `npm run lint` reports hundreds of unrelated errors sourced from a stale, pre-existing worktree at `.claude/worktrees/streamed-floating-snail` dated 2026-08-05 and other untouched files — not part of this pass, not introduced by it.)
- Full test suite: 495/495 real tests passing (the 9 failed "files" are the same pre-existing, unrelated Deno Edge-Function `@std/assert` resolution issue seen in every prior mission this session).
- Production build: clean, same pre-existing single-chunk size warning (the deliberately-deferred code-splitting item).

## Deployment verification

- Commit `2261153` pushed to `main`, deployed.
- Live CSS bundle (`index-CEUxf1cw.css`): `-apple-system` × 1, `BlinkMacSystemFont` × 1 confirmed present.
- Live JS bundle (`index-BDz4BKQ9.js`, confirmed full 1,087,977 bytes via verbose `curl` header check): per-occurrence grep confirmed `tabular-nums` × 13, `26px` (new month title) × 4, `21px` (new class-card time) × 2.
- `app_version` bumped to `2261153` so already-open PWA sessions refresh within seconds.

## Visual self-review

No dedicated component-rendering harness exists for this single-file `App.jsx` codebase, and per this session's standing policy I never log in as any user — so a literal tap-through on a real device was not performed. What the pass's own construction guarantees: every touched value was cross-checked against the mission's explicit target table above, weight reductions were applied consistently (both the interactive check-in button and its read-only sibling span; both "Workout Done" and "Skill Work Done" badges via one `replace_all`), and the two remaining explicit CTA buttons in the Home screen's reachable flow (Book a spot, Log with level) were brought down from Bold to Semibold to match Apple's own button convention. This remains the user's own next step to confirm visually, as with every prior UI mission on this codebase this session.

TYPOGRAPHY 2.0 REFINEMENT COMPLETE
