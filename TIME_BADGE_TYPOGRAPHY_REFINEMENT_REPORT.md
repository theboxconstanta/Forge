# Forge PWA — Reduce Time Badge Typography (btwb-style)

A very small, targeted follow-up to `TYPOGRAPHY_BTWB_REFINEMENT_REPORT.md`: shrinking just the class card's time badge so it no longer visually competes with the class name. No layout, spacing, colors (outside the one explicitly-specified badge background), card height, navigation, backend, architecture, or component-structure changes.

## Change

`src/App.jsx`, class card time badge (Home screen → Today schedule):

| Property | Before | After |
|---|---|---|
| Badge size | 56×56px | **48×48px** |
| Badge border radius | 16px | unchanged (already 16px) |
| Badge background | `#0E0E0E` | **`#111111`** (per explicit spec) |
| Time font size | 20px | **17px** |
| Time font weight | 600 | unchanged (already Semibold) |
| Time line-height | 1.1 | **20px** |
| Alignment | centered (flex + text-align) | unchanged — already centered both axes |

```jsx
// before
<div style={{ background: '#0E0E0E', color: '#fff', borderRadius: '16px', width: '56px', height: '56px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
  <div style={{ fontSize: '20px', fontWeight: '600', lineHeight: 1.1, letterSpacing: '-0.2px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{c.start_time?.slice(0, 5)}</div>
</div>

// after
<div style={{ background: '#111111', color: '#fff', borderRadius: '16px', width: '48px', height: '48px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
  <div style={{ fontSize: '17px', fontWeight: '600', lineHeight: '20px', letterSpacing: '-0.2px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{c.start_time?.slice(0, 5)}</div>
</div>
```

`letterSpacing: '-0.2px'` and `fontVariantNumeric: 'tabular-nums'` were left untouched — not named in this mission's scope, and both remain correct at the smaller size.

## Visual hierarchy

With the badge now smaller and its digits smaller than the 18px/600 class name above it, the class card reads: class name (18px/600, largest) → time (17px/600, now visually secondary) → coach name (14px/400) → occupancy (15px/500). The time no longer dominates the row.

## Confirmation: nothing else changed

- Card height: unaffected — the card's own padding/gap (`padding: '18px'`, `gap: '14px'`) and its sibling text block are untouched, so the row simply has 8px more breathing room around the smaller badge rather than a shorter card.
- Class name, coach name, occupancy, "Reserved"/"Waitlisted"/"Full" pills, chevron: byte-identical to before this pass.
- Zero changes to `onClick`, `rezervat`/`nrRez`/`plin`/`peWaitlist` logic, or any other Home-screen block.
- Zero backend, database, RPC, navigation, or architecture changes.

## Testing

- ESLint on `src/App.jsx`: 0 errors, same 11 pre-existing `Unused eslint-disable directive` warnings.
- Full test suite: 495/495 real tests passing (same pre-existing, unrelated Deno Edge-Function failures).
- Production build: clean, same pre-existing single-chunk size warning.

## Deployment verification

- Commit `933199a` pushed to `main`, deployed.
- Live JS bundle (`index-BZwXArvD.js`, confirmed full 1,087,962 bytes via verbose `curl` header check): `48px` × 9, `17px` × 10, `#111111` × 19 present.
- `app_version` bumped to `933199a` so already-open PWA sessions refresh within seconds.

TIME BADGE TYPOGRAPHY REFINEMENT COMPLETE
