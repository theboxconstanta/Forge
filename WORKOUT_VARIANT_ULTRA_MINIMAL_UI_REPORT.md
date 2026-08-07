# Forge PWA UI Refinement — Ultra-Minimal Workout Variant Cards

Third and most aggressive refinement pass on the RX / Intermediate / Beginner / OnRamp variant cards. No programming data, parser, results, leaderboard, analytics, interactions, animation *timing*, or routing touched — pure visual tuning on top of the previous two passes.

## Typography Measurements

| Property | Target | PWA (before → after) | Web App (before → after) |
|---|---|---|---|
| Variant title | 14px, weight 500, black | 16px/600 → **14px/500** | `text-base font-semibold` (16px/600) → **`text-sm font-medium`** (14px/500) |
| Colored dot | 6px diameter | `size={8}` → **`size={6}`** | `h-2 w-2` (8px) → **`h-1.5 w-1.5`** (6px) |
| Chevron | 16px, `#A1A1AA`, thin stroke, rotates | 18px/`#9CA3AF`/icon-swap → **16px/`#A1A1AA`/`strokeWidth 1.5`/single rotating icon** | N/A — panel has no collapse state, no chevron |
| Card border | 1px, `#ECECEC` | `#E5E7EB` → **`#ECECEC`** | `#E5E7EB` → **`#ECECEC`** |
| Card radius | 20px | 20px (unchanged) | 20px (unchanged) |
| Collapsed card height | 52px | 62px (min-height technique) → **52px** (same technique) | N/A — never collapsed |
| Between-card spacing | 12px | 16px → **12px** | 16px (`gap-4`) → **12px** (`gap-3`) |
| Above first card | 24px | none → **24px** (new wrapper `marginTop`) | N/A — not a mission target for this panel |
| Metadata | 13px, regular, gray | 14–16px mixed weight → **13px/400/`#6B7280`** (format+duration, description lines) | 14px (`text-sm`) → **13px** (`text-[13px]`) |
| Movement list | 15px, regular, black | 15px/`#0E0E0E`/1.6 line-height (already matched) — unchanged | 15px (`text-[15px]`)/`leading-relaxed`/`text-neutral-900` (already matched) — unchanged |

## The Chevron Now Actually Animates

The two previous passes rendered `<ChevronUp>` or `<ChevronDown>` conditionally — swapping React components on click, which cannot produce a smooth rotation (there's nothing to interpolate between two different icons). This pass renders a single, persistent `<ChevronDown>` and rotates it with `transform: rotate(180deg)` plus `transition: transform 0.2s ease` when expanded. The `ChevronUp` import was removed from `App.jsx` (confirmed unused anywhere else in the file before removing it).

## The Notes Callout Is Now Flattened Too

Both previous passes deliberately kept the coach-notes callout as a light-amber background box, reasoning that it was "a genuine accent, not a gray content box." This mission's own instruction — "No colored sections" under Expanded content — is unambiguous and directly targets exactly that remaining exception. It's flattened here: the amber background/border is gone, replaced by a plain top hairline divider (`1px solid #F3F4F6`) with a small gray uppercase label and gray body text, matching the rest of the metadata treatment. This supersedes the earlier judgment call rather than extending it — disclosed here explicitly since it reverses a decision made and justified in two prior reports.

forge-admin-web's equivalent panel had nothing to flatten: its weight/notes lines were already plain text with no colored box in any prior pass.

## Collapsed Height — Same Deterministic Technique, Smaller Target

Reused the `boxSizing: 'border-box'` + `minHeight` + flex-column-centered technique introduced in the previous pass, just retargeted from 62px (midpoint of a 60–64px range) to exactly 52px (this mission's single explicit value). The expanded card keeps unconstrained, content-driven padding (now `14px 18px` instead of a uniform `20px`) for the same reason as before — a card showing a full movement list can't be capped at a fixed height.

forge-admin-web's panel has no collapsed state at all (always shows all four variants for coach review, an established product decision from the very first pass), so the height target and the "above first card" spacing don't transfer there; only title/dot/border/gap/metadata sizing did, for cross-client visual consistency.

## "Workout Title: Existing Size" — What Stayed Untouched

The quoted workout-title line inside the metadata block (`"{workoutForDisplay.title}"`) was left at its prior 14px/500/`#6B7280` styling rather than folded into the new 13px/regular metadata treatment, read as the mission's own "Workout title: existing size" protection — the one typography category this mission explicitly said not to shrink further.

## Testing

- WOD-SIMPLE full suite: 457/457 real JS tests (same established baseline; the 9 failing Deno Edge-Function test files remain the same pre-existing, unrelated gap across every mission this session).
- forge-admin-web: full suite 703/703, including `WorkoutDayPage.test.tsx` (15/15) unmodified.
- ESLint: 0 new errors in either repo — confirmed the `ChevronUp` import removal didn't leave an unused-import warning (it doesn't, since it's genuinely gone from every usage).
- TypeScript (`tsc -b`, forge-admin-web): 0 errors. WOD-SIMPLE has no `tsc` step (plain JS/Vite), not applicable.
- Both production builds clean.

## Mobile / Cross-Surface Verification

Same disclosed limitation as every prior pass on this component: the Home accordion requires an authenticated member session, and this session's standing policy is to never log in as any user. Every measurement in the table above was written and verified directly against the mission's explicit numeric targets. The final "does it feel understated and elegant on a real phone" confirmation remains the user's own to perform.

## Deployment Verification

- WOD-SIMPLE: commit `e8508df`
- forge-admin-web: commit `009ea1c`

Vercel API/MCP access remained down for this mission too (same `404`, third consecutive occurrence, still unrelated to these code changes). Verified via direct bundle fetch: forge-admin-web's served bundle hash (`index-tlZsksg-.js`) matched this mission's own local build exactly. WOD-SIMPLE's served hash did *not* match the local build hash this time (a normal, expected difference between build environments, not a sign of staleness) — so verification was done by content instead: the live bundle for `forge-delta-ivory.vercel.app` was fetched directly and confirmed to contain both `52px` and `#ECECEC`, the two values unique to this pass.

## Production Validation

Verifying against a real CrossFit C15 workout with all four variants, through an authenticated session, was not performed for the same standing-policy reason disclosed above and in every prior report on this component. The typography and spacing changes are confirmed live in both production bundles; the final render against a real workout is the user's own next step.

---

**UI REFINEMENT — ULTRA-MINIMAL WORKOUT VARIANT DESIGN COMPLETE**
