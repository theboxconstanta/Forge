# Forge PWA — Calendar Header Polish + Date Selection Bug Fix

## Summary

The same symptom was reported again after the prior `CALENDAR_DATE_SELECTION_BUG_REPORT.md` fix shipped: "tap 21 August, app opens a different date." This mission re-audited the entire date-selection pipeline from scratch, found the same conclusion holds (date selection itself has never actually been wrong), located and closed one real remaining latent bug in the scroll-position code the prior fix left behind, and — critically — identified the most likely reason the previous fix wasn't visible yet: **a required post-deploy maintenance step (bumping `app_version`) was never performed**, meaning any already-open PWA session on a reporting device would not have picked up the prior fix until a manual close/reopen or a 30-minute background poll. That step has now been performed for this deploy.

## Fresh investigation (re-verified, not assumed)

Every layer the mission asked to re-check was re-traced from scratch, independent of the prior report's conclusions:

- **`dataAcasa` (selected-date state)** — still seeded from local `getFullYear/getMonth/getDate`, no UTC construction anywhere.
- **Month-picker overlay's day-cell strings** — `` `${calPickerYear}-${String(calPickerMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` `` — built by plain concatenation, never round-tripped through a `Date` object before being passed to `setDataAcasa`. Month indexing (`calPickerMonth+1` converting JS's 0-based month to a 1-based calendar string) confirmed correct. `daysInMonth`/`offset` (Monday-first week grid) arithmetic re-verified correct, including for August 2026 specifically (31 days, correct offset).
- **Chip highlight** (`ds === dataAcasa`) and **class/WOD loading** (`claseZi = claseDB.filter(c => c.date === dataAcasa)`, `fetchWodZi(dataAcasa)`) — both direct string comparisons/equality against the same state, unchanged, still correct.
- **The displayed day number on each month-picker cell** (`new Date(ds + 'T00:00:00').getDate()`) — re-checked for a "looks right but isn't" mismatch between the displayed number and the actual click value; confirmed the two can never disagree, since `ds` is never re-derived from `d`.

Conclusion, re-confirmed: **selecting a date has never set the wrong date, highlighted the wrong chip's underlying state, or loaded the wrong day's classes.** The bug lives entirely in a cosmetic scroll-position calculation, not in date selection.

## New bug found: cross-year scroll guard was missing

The prior fix (`scrollChipToDate` measuring real DOM chip width/gap instead of a hardcoded pixel constant) was correct for same-year dates, but left one latent defect: it derived the target year from `new Date().getFullYear()` — **today's real-world year** — rather than from the year of the date actually being scrolled to (`ds`). Since `homeCalendarChips` (the strip itself) only ever covers the current real-world year, a date picked in an adjacent year via the month-picker's `‹`/`›` navigation would compute an `idx` against the wrong year's January 1st, in practice usually landing outside the `[0, totalDays)` guard and silently skipping the scroll entirely (harmless-looking, but still a real correctness gap, and — before the previous fix — could have contributed to the "wrong chip in view" symptom for anyone browsing near a year boundary).

Fixed by making the year check explicit:

```js
const dsYear = parseInt(ds.slice(0, 4), 10)
const currentYear = new Date().getFullYear()
if (dsYear !== currentYear) return
```

## Most likely explanation for the bug appearing to persist: `app_version` was never bumped

This codebase has a documented, deliberate "near-instant PWA update" mechanism (`main.jsx`, `supabase/migrations/20260715080000_app_version_realtime_notify.sql`), built after a real prior incident where a member stayed on a stale, already-fixed-many-times-over bundle for 16+ hours. It works like this: a `postgres_changes` realtime subscription watches the `app_version` table; any `UPDATE` to it pushes an event to every currently-connected client within a few hundred milliseconds, which immediately calls `registration.update()` on the service worker and reloads once the new version takes control. Without a background 30-minute poll or a full app close/reopen, an already-open PWA session has **no other trigger** to notice a new deploy.

The row's own migration comment is explicit: *"la fiecare deploy, randul e actualizat (manual, de pe masina de dezvoltare, cu `npx supabase`, dupa fiecare push)"* — this is a **manual step**, not automated, and it was not performed after either of the two prior calendar-fix deploys this session. That means a device with the PWA already open when those fixes shipped would have kept running the old, buggy `scrollChipToDate` until it happened to close/reopen the app or the 30-minute poll fired — which would look exactly like "I already reported this and it's still broken," even though the fix itself was live and correct on the server.

**This step has now been performed for this deploy**: `app_version.version` was updated to this commit's short SHA (`8ff6acf`) directly against the live database (a `postgres`-role query, bypassing RLS exactly as the migration's own comment describes — there is no anon/authenticated write policy on this table by design). Any currently-open PWA session should refresh within seconds of this report being written; a fresh page load or app reopen picks up the new bundle immediately regardless.

## Header polish

| Element | Before | After |
|---|---|---|
| Month title | 35px, weight 700 | **27px, weight 600** — per this pass's explicit 26-28px target, no longer "dominating the screen" |
| Chevron | Plain `▾` text glyph, 15px, `#D1D5DB` (light gray) — no real "stroke weight" to increase since it was a character, not an icon | **`ChevronDown` icon, 19px, `#111111`, `strokeWidth={2.5}`** — a proper icon with configurable stroke, clearly bolder and darker |
| Chevron spacing | `gap: '8px'` | `gap: '9px'` (within the requested 8-10px range) |
| Touch target | Tight `inline-flex` hugging just the text/chevron content | Same content, plus `padding: '10px 12px 10px 4px'` / `margin: '-10px -12px -10px -4px'` — a standard technique that enlarges the actual clickable hit-box without shifting anything visually, so tapping slightly above/below/around the text still opens the picker |

The tap handler itself (`setCalPickerYear`/`setCalPickerMonth`/`setShowCalPicker`) is unchanged — both the month text and the chevron were already inside one shared `onClick` wrapper before this pass; this pass only made that existing single tap target physically larger and the chevron visually obvious as a clickable affordance.

## Preserved (unchanged)

- Class loading, booking, attendance, WOD, and membership logic/cards — no lines touched outside `scrollChipToDate` and the month-title header block.
- Layout hierarchy and Home dashboard structure — unchanged from the prior Visual Polish v2 pass.
- All realtime subscriptions, routes, and state management — untouched.

## Testing

- ESLint: 0 new errors — same 11 pre-existing `Unused eslint-disable directive` warnings, unrelated.
- Full test suite: 495/495 passing (9 pre-existing, unrelated Deno Edge-Function failures unchanged).
- Production build: clean.

## Deployment verification

- WOD-SIMPLE: commit `8ff6acf`, pushed to `main`, live at `forge-delta-ivory.vercel.app`.
- Vercel MCP/API access remained down for this mission (9th consecutive occurrence this session). Verified via the established direct-fetch fallback: after two intermediate stale/in-flight bundle hashes settled, the confirmed-latest bundle contains the literal strings `columnGap`, `10px 12px 10px 4px` (this pass's unique touch-target padding value), and `27px` (the new month-title size) — all unique to this commit.
- **`app_version` bumped** directly against the live database (`UPDATE app_version SET version = '8ff6acf', updated_at = now() WHERE key = 'current'`) to push the near-instant refresh to any already-open PWA session, closing the most likely gap in why the prior two fixes may not have been visible yet on a reporting device.

## Production validation

Consistent with this session's standing policy of never logging in as any user, live tap-through validation on a real device was not performed. What was verified: the full date-construction/selection code path was re-derived from first principles for August 2026 specifically (the mission's own example month) and found correct at every step; the one real remaining defect (cross-year scroll drift) is now fixed; and the deploy-propagation gap that plausibly explains the bug "still" appearing is now closed for this and future deploys (the `app_version` step should be performed after every deploy going forward, not just this one — worth carrying forward as a checklist item for future Home-screen missions on this codebase).

---

**CALENDAR HEADER POLISH + DATE SELECTION FIX COMPLETE**
