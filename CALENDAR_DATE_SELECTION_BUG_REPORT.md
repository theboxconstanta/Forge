# Forge PWA — Calendar Date Selection Bug (Critical) — Fix Report

## Summary

**Date selection itself was never broken.** Tapping "21 August" always correctly set the selected-date state, correctly highlighted the right chip in the horizontal calendar, and correctly loaded that day's classes/WOD. The bug was in a single unrelated function — `scrollChipToDate` — which **scrolled the horizontal strip's viewport to the wrong pixel position**, visually centering a different day's chip on screen. To anyone using the app, that reads exactly like "I tapped 21 August and it navigated somewhere else," even though internally the correct date was selected the entire time.

## Investigation

Every date-construction and date-comparison path the mission asked to check was traced end-to-end:

1. **`dataAcasa` (selected-date state)** — initialized from local `getFullYear()`/`getMonth()`/`getDate()` (`App.jsx` line 5121), never `toISOString()` or any UTC-based construction. No timezone drift possible at the seed.
2. **Horizontal calendar's own data (`homeCalendarChips`)** — a `useMemo` that walks all 365/366 days of the year via `new Date(yearStart); d.setDate(d.getDate()+i)`, entirely in local time, building each chip's `ds` string the same way `dataAcasa` itself is built. Internally consistent — no possibility of a chip's `ds` disagreeing with what `dataAcasa` would hold for that same calendar day.
3. **Month-picker overlay grid (`showCalPicker`)** — each day cell's date string is built by plain concatenation (`` `${calPickerYear}-${String(calPickerMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` ``), never round-tripped through a `Date` object before being handed to `setDataAcasa`. Month indexing (`calPickerMonth+1` to go from JS's 0-based month to a 1-based calendar string) is correct. `daysInMonth`/`offset` (Monday-first week layout) arithmetic checked and correct.
4. **Data loading for the selected day** — `fetchWodZi(dataAcasa)`, `fetchRezervariZi`, and the `claseZi = claseDB.filter(c => c.date === dataAcasa)` filter all consume `dataAcasa` as a plain string with a direct `.eq('date', ...)`/`===` comparison — no `Date` parsing, no timezone conversion, no way for these to load a different day than what's selected.
5. **Chip highlight logic** — `const selectat = ds === dataAcasa`, a direct string comparison against the same state everything else reads. Cannot desync from `dataAcasa`.

All five of these — the actual "selection," "loading," and "highlighting" — were confirmed correct and internally consistent. The one remaining suspect from the mission's own checklist, **"horizontal calendar synchronization,"** is where the real bug was found.

## Root cause

`scrollChipToDate(ds)` (`App.jsx`, near `homeCalScrollRef`) is called after every date selection (tapping a day in the month-picker, "back to today," "go to today") to scroll the horizontal chip strip so the newly-selected day is visible. It computed the scroll-to pixel position with **hardcoded constants**:

```js
container.scrollLeft = Math.max(0, idx * 70 - container.offsetWidth / 2 + 32)
```

`idx` is the target date's zero-based day-of-year. `70` was meant to be "one chip's width plus its gap" (the horizontal distance from one chip to the next), and `32` was meant to be "half a chip's width" (to center the target chip in the viewport). Both were **hardcoded pixel guesses**, never tied to the actual rendered chip size.

Across the two visual-polish passes that shipped earlier this session, the date chip's actual size changed **twice** — and neither pass touched `scrollChipToDate`, because neither pass had any reason to know this function existed or depended on the old dimensions:

| Pass | Chip width | Gap | True stride |
|---|---|---|---|
| (whenever `70`/`32` were originally written) | ~64px | ~6px | ~70px ✓ matched |
| Home Dashboard Visual Redesign | 60px | 8px | 68px |
| Visual Polish v2 (current) | **64px** | **10px** | **74px** |

By the time of this bug report, the true per-day pixel stride was **74px**, but the scroll math still assumed **70px** — a **4px error per day**, compounding across the day-of-year index. For a date in August (day ~230-240 of the year), that's roughly `230 × 4px ≈ 920px` of accumulated drift — enough to scroll the strip to a position centered on a chip **many days away** from the one actually tapped, while the actually-selected chip (correctly lime-highlighted) sat off-screen, unseen. The error grows with how late in the year the tapped date is, which also matches why this would present as "sometimes clearly wrong, sometimes seems fine" depending on which month a user happened to be browsing.

## Fix

Rather than re-tuning the constants to `74`/`32` (which would only defer the identical bug to the next chip-resize), `scrollChipToDate` now **measures the real rendered chip width and gap from the DOM** at scroll time:

```js
const scrollChipToDate = (ds) => {
  setTimeout(() => {
    const container = homeCalScrollRef.current
    if (!container) return
    const firstChip = container.firstElementChild
    if (!firstChip) return
    const chipWidth = firstChip.getBoundingClientRect().width
    const gapPx = parseFloat(getComputedStyle(container).columnGap || getComputedStyle(container).gap) || 0
    const stride = chipWidth + gapPx
    const year = new Date().getFullYear()
    const startOfYear = new Date(`${year}-01-01T00:00:00`)
    const totalDays = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365
    const idx = Math.round((new Date(ds + 'T00:00:00') - startOfYear) / 86400000)
    if (idx >= 0 && idx < totalDays) container.scrollLeft = Math.max(0, idx * stride - container.offsetWidth / 2 + chipWidth / 2)
  }, 50)
}
```

This mirrors the lesson from the earlier "Bottom Sheet overlaps tab bar" P0 fix this session: measure real DOM geometry instead of hardcoding a pixel value that some future, unrelated visual change can silently invalidate. If the date chips are resized again, this function adapts automatically — the entire class of bug is closed, not just this one instance of it.

The day-of-year index calculation (`idx`), the leap-year `totalDays` check, and the year-start anchor were all already correct and are untouched.

## Requirements checklist

- **Tapping 21 August always opens 21 August** — was already true (`dataAcasa`/`claseZi`/highlight were never wrong); now the horizontal strip also visually scrolls to the correct chip.
- **Tapping 1 August / 31 August** — same fix applies uniformly; the corrected math holds for any day-of-year index, including the first and last days of a month.
- **Switching months preserves correct day selection** — unaffected; month-picker's own day-cell `ds` construction was already correct and untouched.
- **Returning to Today still works** — the "back to today" and "go to today" buttons both call the same `scrollChipToDate`, now fixed the same way.
- **Month title, horizontal calendar, and loaded classes all represent the same date** — confirmed: all three already read from the single `dataAcasa` state; only the *scroll position* (a cosmetic viewport concern, not a data concern) was ever inconsistent.

## Confirmation: no architecture, backend, or database changes

- No new Supabase queries, RPCs, or mutations.
- No change to `dataAcasa`'s type, initialization, or any of its setters (`setDataAcasa` calls are byte-identical to before).
- No change to booking, attendance, WOD, or membership logic — this fix touches exactly one function, `scrollChipToDate`, whose only effect is `container.scrollLeft` (a pure UI scroll position, no state, no side effects beyond the visual viewport).
- No routing changes.

## Testing

- ESLint: 0 new errors — same 11 pre-existing `Unused eslint-disable directive` warnings, unrelated to this fix.
- Full test suite: 495/495 passing (the 9 pre-existing Deno Edge-Function `@std/assert` failures are unrelated and unchanged, consistent with every prior mission this session).
- Production build: clean.
- Manual trace of `idx` computation, chip DOM structure (`homeCalendarChips.map(...)` renders directly as the scroll container's only children, so `container.firstElementChild` is always a real date chip), and every one of the three call sites (`back to today` link, month-picker day tap, month-picker "go to today" button) confirmed to route through the same, now-corrected function.

## Deployment verification

- WOD-SIMPLE: commit `b6b0536`, pushed to `main`, live at `forge-delta-ivory.vercel.app`.
- Vercel MCP/API access remained down for this mission (8th consecutive occurrence this session). Verified via the established direct-fetch fallback — the first fetch attempt caught a stale/in-flight edge response (0 matches for the fix's own code), a second cache-busted fetch against the newest deployed bundle confirmed the literal strings `firstElementChild` and `columnGap` — both unique to this fix's DOM-measurement code — present in the deployed bundle.

---

**CALENDAR DATE SELECTION BUG FIX COMPLETE**
