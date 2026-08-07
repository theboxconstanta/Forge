# Forge UI Refinement — Reduce Workout Variant Typography

Header-only typography/spacing tuning on the RX / Intermediate / Beginner / OnRamp variant cards, on top of the dot-only-color pass (`WORKOUT_VARIANT_MINIMAL_UI_REFINEMENT_REPORT.md`). No logic, layout structure, or interaction change.

## Values Applied

| Property | Target | PWA | Web App |
|---|---|---|---|
| Variant title | 16px semibold (600) | ✓ `fontSize: '16px', fontWeight: '600'` (was 19px) | ✓ `text-base font-semibold` (was `text-lg`/18px) |
| Colored dot | 8px diameter | ✓ `<LevelDot size={8} />` (was default 10px) | ✓ `h-2 w-2` (was `h-2.5 w-2.5`/10px) |
| Chevron | 18px, `#9CA3AF` | Already correct from the previous pass — unchanged | N/A — this panel has no chevron/collapse state |
| Card height | 60–64px | ✓ see below | N/A — see below |
| Between-card spacing | 16px | ✓ `marginBottom: '16px'` (was 20px) | ✓ `gap-4` (was `gap-5`/20px) |

Only the dot is colored; title stays black/primary text color (unchanged from the previous pass) in both clients.

## Collapsed Card Height — How 60–64px Was Guaranteed

Rather than tuning padding and hoping font-metric rendering lands in range (browser-dependent and imprecise), the collapsed row now uses an explicit, deterministic constraint:

```
boxSizing: 'border-box', minHeight: '62px',
padding: '0 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center'
```

`border-box` means the 62px minimum includes padding; `flex` + `justifyContent: 'center'` vertically centers the single header row (dot + title + chevron) within that fixed height regardless of exact font rendering. 62px sits at the midpoint of the requested 60–64px range.

This constraint applies **only** to the collapsed state. The expanded card keeps its previous, unconstrained `padding: '20px'` with normal block flow — a card showing a metadata block, a full movement list, and possibly a notes callout cannot be capped at 64px without hiding content, so the height target was scoped to the collapsed row only, which is the only state where "60–64px" is a coherent target.

forge-admin-web's `ScalingVariantsPanel` has no equivalent collapsed state at all — every variant card there is always fully expanded (a coach reviewing programming needs to see all four at once, per the standing product reasoning from the previous two passes) — so the height target doesn't transfer there and was left as-is; the panel's own between-card spacing (`gap-5` → `gap-4`, 20px → 16px) was tuned for cross-client consistency since that dimension applies equally to a grid layout.

## Scope Discipline

Every other value from the previous pass — metadata typography (medium gray, 14–16px), movement list styling (black text, hairline dividers, 12px row spacing, small left inset), the notes callout, card border color/radius, and all selection/click logic — is untouched. This mission's brief was explicitly scoped to "headers" only, and the diff reflects that: 21 lines changed in `App.jsx`, 11 in `WorkoutDayPage.tsx`, both confined to the header row and its immediate container styling.

## Testing

- WOD-SIMPLE full suite: 457/457 real JS tests (same established baseline; the 9 failing Deno Edge-Function test files remain the same pre-existing, unrelated gap).
- forge-admin-web: full suite 703/703, including `WorkoutDayPage.test.tsx` (15/15) unmodified.
- ESLint: 0 new errors in either repo. TypeScript (`tsc -b`, forge-admin-web): 0 errors. WOD-SIMPLE has no `tsc` step (plain JS/Vite), not applicable.
- Both production builds clean.

## Deployment Verification

- WOD-SIMPLE: commit `39b26ca`
- forge-admin-web: commit `9e9fad3`

The Vercel API/MCP integration remained inaccessible for this mission too (same `404`, same unrelated tooling issue disclosed in the two previous reports). Verified instead via direct bundle fetch:

- `forge-delta-ivory.vercel.app`: the live bundle contains `62px`, the value unique to this pass's collapsed-height constraint.
- `forge-admin-web.vercel.app`: the served bundle's content-hash filename (`index-DI3q3EEU.js`) is byte-identical to the file produced by this mission's own local production build — direct confirmation the exact committed code is live.

---

**UI REFINEMENT — WORKOUT VARIANT TYPOGRAPHY TUNING COMPLETE**
