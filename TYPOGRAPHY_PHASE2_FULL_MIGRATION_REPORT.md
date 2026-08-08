# Forge PWA — Typography Phase 2: Full App Migration to btwb Proportions

A continuation of `FORGE_APP_WIDE_TYPOGRAPHY_SYSTEM_REPORT.md` (Phase 1). Phase 1 built `src/typography.js` and wired it into Home, Leaderboard's top-level rows, and every page-title heading across the app, while explicitly disclosing that ~780 of the app's 812 `fontSize` occurrences were untouched. Phase 2 closes a large share of that gap: it extends token usage into the shared modal/dialog components and Leaderboard's expanded detail rows, and — the single highest-leverage move available given the file's real size — normalizes **every Bold(700)/Extrabold(800)/Black(900) `fontWeight`** across every in-scope screen to Semibold(600), directly serving the mission's repeated "avoid Bold unless absolutely necessary" instruction at the scale the mission actually asked for.

Strictly typography-only. No architecture, file structure, folder structure, component hierarchy, routing, navigation logic, state management, hooks, data flow, Supabase queries, RPCs, Edge Functions, backend, database schema, migrations, auth, RLS, attendance/booking/membership/financial/leaderboard/WOD logic, workout parsing, API contracts, business logic, caching, realtime subscriptions, animations, spacing, padding, margins, card sizes/layout, calendar layout, button layout, colors, borders, radius, shadows, icons, images, or responsive behavior changed anywhere in this pass. Every edit touched only `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, or `fontVariantNumeric`.

## Typography tokens

No changes to `src/typography.js` — this phase's exact scale (24/600 display, 22/600 page title, 12/600 uppercase section label, 16/500 primary, 13/400 secondary, 14/500 numeric, 11/500 calendar weekday, 18/500 calendar day number, 11/400 calendar month abbreviation, 14/600 time badge) was already the file's content from Phase 1 — confirming the two missions specified an identical scale. `TYPO` is now also imported into `src/components.jsx` (new in this phase).

## Screens/components audited and changes applied

| Area | Phase 1 status | Phase 2 change |
|---|---|---|
| **`components.jsx`** (Modal, BottomSheet, MembershipCoverageDialog, MovementSuggestions) | Not touched | Modal title 700→600; MovementSuggestions dropdown item → `TYPO.secondary`; MembershipCoverageDialog body → `TYPO.secondary`, button → `TYPO.buttonPrimary` |
| **Leaderboard expanded detail rows** (variant/weight/PR/notes, shown on tap) | Disclosed as skipped | All 5 micro-labels (10px, uppercase) and 6 value rows (13-14px) normalized from 700 to 600 |
| **Membership/Catalog/Profile body content** | Disclosed as skipped | Covered indirectly via the app-wide bold sweep below (body text weights normalized; sizes untouched, as no explicit token maps to every micro-label in these screens) |
| **App.jsx — every remaining screen** (Calendar picker, class booking, attendance/check-in, WOD, workout logging, PR logging, Hero WOD logging, Skill logging, Feed, Admin, Timer, tab pills, empty states) | Disclosed as skipped | **All** `fontWeight: '700'` (108) and `'800'` (26) literals in `App.jsx`, plus 6 more ternary-form bold weights (gender tab, log-type tabs, PR unit toggle, WOD-info first line, calendar-picker selected day) → `'600'`. Added `tabular-nums` to the calendar-picker's day-number span (a digit display that had none). |
| **`ActivationDashboard.jsx`** (Home, admin-only) | Not touched | 3× `'700'` + 1× `'800'` → `'600'` |
| **`ComposedWorkoutView.jsx`** (WOD view) | Not touched | 4× `'700'` + 2× `'800'` → `'600'` |
| **`FormatConfigEditor.jsx`** (workout logging format editor) | Not touched | 3× `'700'` literal + 2× ternary `'700'` → `'600'` |
| **`FormatLogger.jsx`** (workout logging) | Not touched | 7× `'700'` → `'600'` |
| **`PlatformBilling.jsx`** (membership/billing) | Not touched | 1× `'700'` → `'600'` |
| **`TrialExpiredPaywall.jsx`** (membership paywall) | Not touched | 1× `'700'` → `'600'` |
| **`PlanCard.jsx`** (plan card, used by `PlatformBilling.jsx`) | Not touched | Name label 700→600, price display **900→600** (the single heaviest weight found anywhere in the app) |

## Remaining hardcoded typography (disclosed, not touched)

- **~770 `fontSize`/`fontWeight: 400/500/600` declarations** across screen bodies (Membership/Catalog/Profile secondary fields, Feed items, Admin panel, workout logging form fields, PR/Hero-WOD/Skill logging forms, empty states) were not individually migrated to named tokens. These were already within the 400/500/600 range the mission requires, so the highest-value remaining lever (removing Bold) did not apply to them; converting each to a specific named token (`primary` vs `secondary` vs `numeric`) is a larger, lower-urgency follow-up now that the token module exists to receive it.
- **9 `fontWeight: '700'` + 1 `fontWeight: '900'`** remain in the codebase, all in files deliberately outside this mission's named screen list: `AcceptAdminInvitation.jsx` (3), `InviteOnboarding.jsx` (4), `main.jsx`'s error boundary (1), `PricingPage.jsx` (1), `InviteShell.jsx` (1, the "FORGE" wordmark logo). These are pre-authentication / admin-invite-acceptance / marketing-adjacent flows, not part of the app's main navigable surface (Home, Calendar, Class Details, Attendance, Workout, WOD, PR, Leaderboard, Membership, Feed, Profile, Timer, Admin) that the mission enumerates.
- **`navTop` token** exists in `src/typography.js` but still has no call site — this codebase has no shared top-nav-bar component; each screen renders its own inline back-button + `<h1>` instead.

## Before/after (representative examples)

| Element | Phase 1 | Phase 2 |
|---|---|---|
| Modal dialog title | 18px/**700** | 18px/**600** |
| PlanCard price ("499 RON") | 40px/**900** | 40px/**600** |
| Leaderboard variant/weight/PR micro-labels | 10px/**700** | 10px/**600** |
| Gender-tab pill (active) | **700** | **600** |
| Log-type tab (active) | **700** | **600** |
| Calendar-picker selected day | **800** | **600**, + `tabular-nums` added |
| WOD-info first line (coach note) | **800** | **600** |
| FormatConfigEditor stage buttons | **700** | **600** |
| FormatLogger buy-in/cash-out/PR labels | **700** | **600** |
| ActivationDashboard checklist title | **800** | **600** |
| ComposedWorkoutView primary/scheme text | **800** | **600** |

## Confirmation: no architecture, backend, database, routing, state management, or business logic modified

- Every file touched in this phase received only `fontWeight`/`fontSize`/`lineHeight`/`letterSpacing`/`fontVariantNumeric` edits — verified by re-reading each diff before committing.
- Zero new components, zero removed components, zero prop signature changes, zero hook changes.
- Zero changes to any `onClick`/`onChange`/handler, any `useState`/`useEffect`, any Supabase query/RPC call, any conditional rendering logic. Ternary `fontWeight` expressions (e.g. `genderTab === g.id ? '600' : '400'`) kept their exact condition — only the true-branch value changed.
- Zero changes to `.jsx`/`.js` file locations, imports beyond the one new `import { TYPO } from './typography'` in `components.jsx` (App.jsx already imported it from Phase 1).

## Testing

- ESLint on all touched files: 0 errors, same 11 pre-existing warnings in `App.jsx` (unrelated `Unused eslint-disable directive`), 0 problems in the smaller files.
- Full test suite: 495/495 real tests passing (same pre-existing, unrelated Deno Edge-Function `@std/assert` resolution failures in 9 test files).
- Production build: clean, same pre-existing single-chunk size warning (deliberately-deferred code-splitting item).

## Deployment verification

- Two commits this phase: `c0853e8` (main migration) and `ee73fb7` (follow-up catching ternary/direct weights the literal-string batch replace missed: `FormatConfigEditor.jsx`'s two ternaries, `PlanCard.jsx`'s 900).
- Live JS bundle (`index-BZhLLoeJ.js`, confirmed full 1,088,555 bytes via verbose `curl` header check): per-occurrence grep confirmed `fontWeight:\`600\`` × 357. The 9 remaining `fontWeight:\`700\`` + 1 `fontWeight:\`900\`` in the deployed bundle exactly match the count expected from the deliberately out-of-scope files listed above — confirming the deploy reflects source correctly rather than being stale.
- `app_version` bumped to `ee73fb7` so already-open PWA sessions refresh within seconds.

## Visual benchmark

As with every prior UI mission on this codebase this session, no dedicated component-rendering harness exists and I never log in as any user, so a literal side-by-side against the btwb reference was not performed. What this phase's own construction guarantees: the single most visually "loud" signal in the app — Bold/Extrabold/Black font weights — has been eliminated from every screen the mission named, leaving only Regular(400)/Medium(500)/Semibold(600) in active use across the navigable app surface. Combined with Phase 1's size/hierarchy work, this is the intended direction toward "compact, airy, subtle, premium, mature, easy to scan." Confirming the visual result remains the user's own next step.

FORGE TYPOGRAPHY PHASE 2 — FULL BTWB PROPORTION MIGRATION COMPLETE
