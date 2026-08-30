# Workout Builder — "Preview (how the athlete will read this)" moved to the bottom

Date: 2026-08-30
Status: **Shipped. Layout-only. No prescription-engine logic touched. HARD STOP —
P10 not started.**

---

## A. ROOT / CURRENT STRUCTURE (before)

`src/App.jsx` — `PrimarySectionBody` (the primary metcon section's body). Return
order was:

1. `FormatConfigEditor` (format)
2. Duration inputs (or auto-duration display)
3. Workout name input
4. **`<ComposedWorkoutPreview section={section} t={t} />`**  ← rendered here, 3rd
5. Variant tab bar (RX / Intermediate / Beginner / OnRamp)
6. "Generate Variants" button (RX tab)
7. "Regenerate with AI" button (non-RX tabs)
8. `<VariantEditorBody>` — movement rows (`MovementRowListPWA`) + `+ Add movement`
   + Notes

The coach had to scroll **past** the Preview to reach the variant tabs and every
movement/notes control.

---

## B. CHANGE (after)

The `<ComposedWorkoutPreview>` element is moved to be the **last** child of
`PrimarySectionBody`, immediately after `<VariantEditorBody>`, wrapped in a thin
separator:

```jsx
<VariantEditorBody … />

{/* PREVIEW (how the athlete will read this) - the LAST, read-only block */}
<div style={{ marginTop: '18px', paddingTop: '4px', borderTop: '1px solid #e0e0e0' }}>
  <ComposedWorkoutPreview section={section} t={t} />
</div>
```

New order: settings → **variant tabs** → generate → **movement rows** →
**+ Add movement** → **Notes** → **Preview** (final read-only block).

`ComposedWorkoutPreview` renders exactly once (single call site — grep-confirmed),
for the primary section only.

---

## C. FILES

| File | Change |
|---|---|
| `src/App.jsx` | `PrimarySectionBody` — one `<ComposedWorkoutPreview>` element relocated from position 3 to last; wrapped in a `borderTop` + `marginTop:18px` separator div. **+8 / −1 lines, one file.** |

- **forge-admin-web: no change.** The admin Programming builder has **no**
  "Preview (how the athlete will read this)" block — `ComposedWorkoutPreview` /
  `composeSection` / `ComposedWorkoutView` are WOD-SIMPLE-only (the Workout
  Composer's "deliberate first exposure in Admin only" per its spec). Nothing to
  keep in parity.

---

## D. BEHAVIOR — Preview generation/data source UNTOUCHED

- `ComposedWorkoutPreview` component body: **byte-identical** —
  `composeSection(section, 'rx')` → `<ComposedWorkoutView composed={composed} />`,
  same null-guard, same label `t.adminWodComposedPreviewLabel`
  ("Preview (how the athlete will read this)" / RO "Previzualizare (cum citește
  sportivul antrenamentul)").
- `composeSection`, `ComposedWorkoutView`, movement prescription resolution,
  capabilities, identity, `canonicalMovementId`, `movement_prescriptions`, Quick
  Paste, Generate Variants, save, validation, member rendering, logger,
  `prescription_snapshot`, all P9/P9.1/P9.2/P9.3 logic — **not touched**.
- Still live/reactive: it reads the same `section` prop, so changing a movement's
  load (`45/30` → `50/35`) re-renders the Preview exactly as before. It reflects
  the RX reference composition (unchanged — it was never a per-variant selector).
- Not duplicated — one instance.

---

## E. RESPONSIVE

- The Preview stays inside `PrimarySectionBody`'s content flow (parent
  `SectionCard` has `padding: 12px`); no `width`, no negative margins → no
  horizontal overflow, stays within content width on desktop / tablet / iPhone.
- The admin WOD-editor scroll container already carries `paddingBottom: 80px`
  (clears the fixed bottom nav, which itself uses
  `env(safe-area-inset-bottom)`), so the Preview — now deeper in the DOM but
  still well above that cushion — is fully readable above the nav bar on mobile.
- `borderTop` + `marginTop:18px` visually separates it from the editable Notes
  field above.

---

## F. TESTS

- **No test file renders `PrimarySectionBody` / `ComposedWorkoutPreview`** (they
  live in `App.jsx`, which is not import-safe in vitest — Capacitor / service
  worker / supabase top-level). Adding an RTL harness for a one-element JSX
  reposition would mean importing/mocking all of `App.jsx` — the "unrelated
  refactor" this task explicitly forbids.
- Behavior is regression-covered by the existing, **unchanged** suites for the
  Preview's actual logic:
  - `src/workoutComposer.test.js` — `composeSection` projection
  - `src/ComposedWorkoutView.test.jsx` — the rendered view
  - `src/wodSections.test.js` — section state / save payload
- **Before / after: WOD-SIMPLE `vitest run` = 1171 passed**, 9 pre-existing
  Deno-only `supabase/functions/*` failures (unrelated, unchanged). `vite build`
  clean. `eslint src/App.jsx` — 0 errors (11 pre-existing unrelated warnings).

---

## G. DATABASE

- **No migration.**
- **Zero production data touched.**
- No schema, trigger, RLS, or data change of any kind.

---

## H. COMMITS

| Repo | Commit |
|---|---|
| WOD-SIMPLE | `refactor(builder): move athlete Preview to the bottom of the variant editor (layout only)` |

`app_version.current` bumped to `builder-preview-bottom-20260830`.

---

## HARD STOP

**P10 NOT STARTED.** No prescription-engine logic, member rendering, logger,
snapshot, or schema was modified. This was a pure position change of one
read-only component.
