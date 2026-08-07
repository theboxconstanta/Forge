# Forge PWA UI Refinement — Minimal White Workout Variant Cards

Second-pass visual refinement of the RX / Intermediate / Beginner / OnRamp variant display, pulling the previous pass (`WORKOUT_VARIANT_UI_REFINEMENT_REPORT.md`) back to the approved "dot-only color" mockup. No workout logic, programming parsing, results, Rx classification, analytics, or dashboard integration touched — pure restyle of the same two components addressed last time.

## What Changed From the Previous Pass

| Element | Previous pass | This pass |
|---|---|---|
| Title text | Colored (variant's own hue) | Black / primary text color, always |
| Card border | Neutral collapsed, `2px` colored when selected | Uniform `1px solid #E5E7EB`, all states |
| Selection indicator | Small colored checkmark icon | None — communicated only by expanded content + chevron direction |
| Header size | 14px collapsed / 16px selected | Constant 19px, both states ("equally important") |
| Metadata (format/duration/title/description) | Bold black primary line, lighter gray secondary lines | Uniform medium-gray family (`#4B5563`/`#6B7280`), hierarchy via size/weight only |
| Card radius | 14px collapsed / 18px selected | Uniform 20px, both states |
| Card padding | 14px×16px collapsed / 18px selected | Uniform 20px, both states |
| Between-card spacing | 12px | 20px |
| Between-movement-row spacing | 9px | 12px, plus a small left inset ("clear indentation") |

The dot (`LevelDot`, colors unchanged from the previous pass: RX `#EA580C`, Intermediate `#D97706`, Beginner `#16A34A`, OnRamp `#2563EB`) is now the **only** colored element anywhere in the card, in either client.

## Dark Mode (Unchanged Finding)

Re-confirmed before touching anything: still no dark-mode architecture in either repo (no `prefers-color-scheme`, no `dark:` variants, no theme context, no CSS custom-property pairs). The mission's "use theme tokens, don't hardcode where tokens exist" instruction remains inapplicable for the same reason disclosed in the previous report — there is nothing to preserve or route through. Colors stay hardcoded hex, consistent with 100% of the surrounding codebase.

## Component Changes

### PWA — `App.jsx` Home accordion

- Removed `v.culoare` from the border and title `color` — both are now fixed neutral values (`#E5E7EB` border, `#0E0E0E` title) regardless of `isSelected`.
- Removed the `CheckCircle2` checkmark rendered when selected (still imported/used elsewhere in the file for unrelated UI, so no dead-import cleanup needed).
- Chevron color changed from `#999` to `#9CA3AF` (Tailwind gray-400, matching the new gray-200/400/500/600 scale used throughout this pass).
- Header `fontSize` is now a constant `19px` instead of switching between `14px`/`16px` by selection state.
- Metadata block: format+duration line changed from `15px`/`700`/`#0E0E0E` to `16px`/`600`/`#4B5563`; quoted title from `13px`/`600`/`#555` to `14px`/`500`/`#6B7280`; format-config description from `12px`/`#999` to `14px`/`#6B7280`.
- Movement rows: added `paddingLeft: 4px` for the requested "clear indentation," increased row-to-row spacing to `12px`, text size bumped `14px → 15px`, line-height `1.5 → 1.6`, divider color lightened `#f5f5f5 → #F3F4F6`.
- Card: `padding` and `borderRadius` unified to `20px` for both collapsed and expanded states (previously distinct); `marginBottom` between cards `12px → 20px`.
- Selection state (`variantaAleasa`), the click handler, and variant order are unchanged — pure restyle, same as the previous pass.

### Web App — `WorkoutDayPage.tsx`'s `ScalingVariantsPanel`

- Border changed from `1.5px solid ${color}` to a uniform `1px solid #E5E7EB`.
- Title changed from colored (`style={{ color }}`) to `text-neutral-900` (black), size bumped to `text-lg` (18px, within the 18–20px target).
- Card radius bumped `rounded-2xl` (16px) → `rounded-[20px]` (exact 20px, matching the PWA), padding `p-4` (16px) → `p-5` (20px), grid gap `gap-3` → `gap-5` (20px, matching the PWA's between-card spacing).
- Movement list: added `pl-1` for indentation, divider spacing bumped to `12px`, text size `text-sm` (14px) → `text-[15px]`.
- Weight/notes lines bumped `text-xs` → `text-sm` (within the 14–16px metadata target; both are already the "medium gray" `neutral-500`/`neutral-600` family from the previous pass, unchanged here).
- Still deliberately not an accordion, for the same reason disclosed in the previous report: a coach reviewing programming wants all four variants visible simultaneously.

## Typography Summary

| | Header | Metadata | Movement list |
|---|---|---|---|
| Target | Semibold, black, 18–20px | Medium gray, 14–16px | Black, comfortable line height, clear indentation |
| PWA | 600 weight, `#0E0E0E`, 19px | `#4B5563`/`#6B7280`, 14–16px | `#0E0E0E`, 15px, line-height 1.6, 4px left inset |
| Web App | 600 weight (`font-semibold`), `neutral-900`, 18px | `neutral-500`/`neutral-600`, 14px | `neutral-900`, 15px, `leading-relaxed`, 4px (`pl-1`) left inset |

## Testing

- WOD-SIMPLE full suite: 457/457 real JS tests (same established baseline; the 9 failing Deno Edge-Function test files remain the same pre-existing, unrelated gap documented across this session).
- forge-admin-web: `WorkoutDayPage.test.tsx` (15/15) passes unmodified — no assertion in that file depends on border/title color or exact class names. Full suite: 703/703.
- ESLint: 0 new errors in either repo. TypeScript (`tsc -b`, forge-admin-web): 0 errors. WOD-SIMPLE has no `tsc` build step (plain JS/Vite), not applicable.
- Both production builds clean.

## Mobile / Cross-Surface Verification

Same disclosed limitation as the previous pass: the Home accordion requires an authenticated member session to render real WOD data, and this session's standing policy is to never log in as any user. Every spacing/color/typography value above was written and verified directly against the mission's explicit numeric targets (20px padding, 16px between sections, 12px between movement rows, 20px between cards, 18–20px header, 14–16px metadata — all matched exactly or within the stated range), and both automated test suites plus both production builds pass cleanly. The final visual "does it read as a polished consumer fitness product on a real phone" confirmation remains the user's own to perform.

## Deployment Verification

- WOD-SIMPLE: commit `7ddb0e9`
- forge-admin-web: commit `d0faca1`

**Same tooling gap as the previous mission**: the Vercel API/MCP integration used for deployment-state (READY/SHA) verification returned `404 Not Found` again on this occasion, for both projects — confirmed not transient (retried after a delay, same result), a connectivity/permissions issue with the tool itself, unrelated to this code change. Verified instead by fetching both live production URLs directly and grepping their JS bundles for values unique to this pass:

- `forge-delta-ivory.vercel.app` (WOD-SIMPLE): both new neutral values (`#E5E7EB` border, `#9CA3AF` chevron) present in the live bundle.
- `forge-admin-web.vercel.app`: the new neutral border value (`#E5E7EB`) present in the live bundle; the served file's content-hash filename (`index-B9t1BFeB.js`) is byte-identical to the file produced by this mission's own local production build, an additional confirmation the exact committed code is what's live.

## Production Validation

Verifying against a real CrossFit C15 workout with all four variants, through an authenticated session, was not performed for the same standing-policy reason disclosed above and in the previous report. The color/typography/spacing changes are confirmed live in both production bundles; the final render against a real four-variant WOD is the user's own next step.

---

**UI REFINEMENT — MINIMAL WHITE WORKOUT VARIANT DESIGN COMPLETE**
