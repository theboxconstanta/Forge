# Forge PWA — Reduce Time Typography Inside the Black Time Badge

A very small, single-property follow-up to `TIME_BADGE_TYPOGRAPHY_REFINEMENT_REPORT.md`: the badge itself (48×48px, `#111111` background, 16px border radius) is untouched — only the time text's typography changed.

## Change

`src/App.jsx`, class card time badge (Home screen → Today schedule):

| Property | Before | After |
|---|---|---|
| Font size | 17px | **16px** |
| Font weight | 600 | unchanged (already Semibold) |
| Line-height | 20px | **18px** |
| Letter-spacing | -0.2px | **-0.01em** |
| Alignment | centered (flex + text-align) | unchanged — already centered both axes |

```jsx
// before
<div style={{ fontSize: '17px', fontWeight: '600', lineHeight: '20px', letterSpacing: '-0.2px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{c.start_time?.slice(0, 5)}</div>

// after
<div style={{ fontSize: '16px', fontWeight: '600', lineHeight: '18px', letterSpacing: '-0.01em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{c.start_time?.slice(0, 5)}</div>
```

The badge container (`background: '#111111'`, `width`/`height: '48px'`, `borderRadius: '16px'`) is byte-identical to before this pass.

## Visual hierarchy

Class name (18px/600) → time (16px/600, now visibly smaller than the name) → coach name (14px/400) → occupancy (15px/500). The time is legible but no longer the first thing the eye lands on inside the card.

## Confirmation: nothing else changed

- Badge size, color, radius: untouched.
- Class name, coach name, occupancy, pills, chevron, card padding/gap: byte-identical to before this pass.
- Zero backend, database, navigation, or architecture changes.

## Testing

- ESLint on `src/App.jsx`: 0 errors, same 11 pre-existing warnings.
- Full test suite: 495/495 real tests passing (same pre-existing, unrelated Deno Edge-Function failures).
- Production build: clean.

## Deployment verification

- Commit `63984c2` pushed to `main`, deployed.
- Live JS bundle (`index-CwWqnCSq.js`, confirmed full 1,087,963 bytes via verbose `curl` header check): `letterSpacing:` `` `-0.01em` `` × 1 (new time text), `` `-0.2px` `` × 1 (unchanged bottom-sheet header, the badge's only other prior user of that value) — confirms the new value shipped and the sibling element was correctly left alone. An initial fetch immediately after the deploy notification returned a still-transitioning asset reference showing the old value; a follow-up fetch with a fresh cache-busting parameter resolved to the correct, current bundle.
- `app_version` bumped to `63984c2` so already-open PWA sessions refresh within seconds.

TIME BADGE TEXT REFINEMENT COMPLETE
