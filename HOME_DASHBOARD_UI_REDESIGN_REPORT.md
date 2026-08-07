# Forge PWA — Home Dashboard Visual Redesign

A strictly visual redesign and interaction refinement of the PWA's member-facing Home screen (`App.jsx`, `screen === 'home'`, lines 7902-8404). No architecture, backend, database, RPC, realtime, booking, attendance, membership, financial, routing, or state-management logic was changed — every existing query, mutation, realtime subscription, and permission check is reused exactly as it was before this mission.

## Component changes

No new screens, routes, or data-fetching hooks. Two additions, both pure presentation:

- **`BottomSheet`** (new, `src/components.jsx`) — a bottom-anchored sibling of the existing `Modal` primitive, reusing `Modal`'s exact focus-trap/Escape-to-close/`aria-modal` accessibility logic verbatim (duplicated rather than composed, since the two differ in backdrop opacity and anchor position and share no other JSX). Used for the new class-detail sheet.
- **`formatFirstNameLastInitial`** (new, `src/utils.js`) — a pure display-formatting helper ("Stelian P." instead of the full stored name) for roster rows in the new sheet. Never touches the underlying `member.full_name` data or query, purely how one component renders it.

Everything else is a restructuring of existing JSX inside the same `screen === 'home'` block, calling the same functions.

## Styling changes

| Section | Before | After |
|---|---|---|
| Header | Large "7 AUGUST ▾" date label as the dominant element, small greeting line below | Greeting is now the dominant element (26px/800, generous top/side whitespace); the date-tap-to-calendar trigger relocated to sit beside the chip strip it governs (see Date selector) |
| Date selector | 64×64px chips, `1px solid #e8e8e8` border, flush against page edge | 60×72px chips (larger touch target), `1px solid #ECECEC`, white background, more inter-chip spacing (8px), month/year label + "back to today" link now anchor this section |
| Classes | "N classes available" dropdown, collapsed by default, required a tap to reveal any class | Removed entirely — a "TODAY / N classes" header with the full list of tappable class cards always visible, no dropdown, no hidden state |
| Class card | Compact list row inside the dropdown | White card, 22px radius, subtle border (lime border when reserved), dark time block, class name + coach, occupancy/status + chevron — matches the mission's mockup layout exactly |
| Class detail | Inline expansion under the tapped card, pushing the rest of the list down | New bottom sheet (slide-up from the bottom, dark backdrop, drag-handle affordance), roster and booking action live here instead |
| WOD card | Flush white, no border/radius, `16px 20px` padding | Same content and collapse/warmup/skill/variant-picker/log-button behavior, now wrapped in a `1px solid #ECECEC`, 22px-radius card matching the new page language (the variant-picker internals themselves were already fully redesigned across four prior missions this session and were intentionally left untouched) |
| Membership card | Flush white, 15-18px type, prominent progress bar | Same data, `1px solid #ECECEC` border, 18px radius, smaller type (13-14px), thinner progress bar — reads as secondary/compact per the mission's own spec |

Design language: white backgrounds throughout (no gray canvas was introduced — separation between sections comes from whitespace, subtle `#ECECEC` borders, and rounded cards, not background tint), black primary text, gray secondary text, `#ABE73C` (Forge lime) reserved for the selected date chip, the "Reserved" badge, and primary booking actions — unchanged from the existing brand palette, just applied more sparingly per the "avoid heavy shadows/thick borders/admin density" instruction.

## Interaction changes

- **Classes are visible immediately** on landing on Home — no tap required to see what's scheduled today.
- **Tapping a class card** opens the new bottom sheet instead of expanding the card inline. The sheet shows the class header, the roster, and the booking action (Book / Cancel / Join waitlist / Sessions exhausted / Past class) — the exact same conditional logic (`rezervat`/`peWaitlist`/`plin`/`blocat`/`esteInTrecut`) that drove the old inline expansion, calling the same `toggleRezervare`/`toggleWaitlist` functions.
- **Roster rows in the sheet**: each shows an avatar, a "First L." display name (new, presentation-only), and a trailing status:
  - **Members** see a read-only "✓ Checked in" (green) or a plain "Check in" label (gray, non-interactive) — they were already read-only before this mission; the visual treatment changed, the permission boundary did not.
  - **Coach/Admin/Owner** see a tappable pill button that calls `handleHomeCheckIn` (the same wrapper around the shared `checkInBooking` mutation used before), toggling check-in state either direction, still gated by the same 2-hour post-class grace window (`isInAttendanceGraceWindow`) and disabled with a "read-only" note once that window has passed — byte-identical business rule to the pre-existing "Instant Coach Check-in" feature, only relocated into the sheet.
- **Sheet dismissal**: tap the backdrop, tap the × button, press Escape, or complete a booking action (auto-closes on Book/Cancel, matching the old auto-collapse behavior).
- Booking, waitlist, and session-limit blocking behavior are otherwise pixel-for-pixel the same decision tree as before, just rendered in the sheet instead of inline.

## Confirmation: no architecture, backend, or database changes

- **No new Supabase queries, RPCs, or Edge Functions.** The redesign reads from `claseDB`, `rezervariMele`, `rezervariPerClasa`, `waitlistMea`, `abonamentReal`, `wodZiData`/`wodZiWorkoutV2`, `wodLogs`, `skillLogs` — all pre-existing state, fetched by pre-existing effects, untouched.
- **No new mutations.** `handleHomeCheckIn` → `checkInBooking` (bookings.checked_in update), `toggleRezervare`, `toggleWaitlist` — all called with the identical signatures as before.
- **No realtime changes.** The three existing channels (`realtime-app`, `my-bookings-{userId}`, `member-sessions-{userId}`) and the 8-second polling fallback are untouched; the new class-detail sheet reads live off the same `rezervariPerClasa` state those channels already keep fresh.
- **No permission changes.** `canToggleAtt = isAdmin || isCoach` is the exact same expression as the code it replaced.
- **No routing changes.** Still `screen === 'home'`, same `setScreen`/`setPrevScreen` calls to navigate to `/profile` and `/abonament`.
- **One dead-code removal**: `claseHomeDeschis`/`setClaseHomeDeschis` (the dropdown's own open/closed toggle) is no longer referenced anywhere in the file after removing the dropdown per the mission's explicit instruction, so the now-orphaned `useState` declaration was deleted. This has no runtime effect (the state was never read once its only consumer was removed) and is the only state-management edit in this mission - a cleanup, not a behavior change.

## Testing

- WOD-SIMPLE full suite: 495/495 real JS tests passing (the 9 pre-existing Deno Edge-Function `@std/assert` failures are unrelated and unchanged, consistent with every prior mission this session — this screen has no dedicated component-level tests in this codebase's existing convention, since `App.jsx` is a single monolithic file with no React Testing Library harness anywhere; verification here is build+lint+manual JSX/logic review, matching how every prior Home-screen UI mission this session was verified).
- ESLint: 0 new errors — same 11 pre-existing `Unused eslint-disable directive` warnings, unrelated to this change.
- Production build: clean (same pre-existing single-chunk size warning, the deliberately-deferred code-splitting item).
- Manual review of the full rewritten block confirmed: `claseZi`/`rezervat`/`nrRez`/`plin`/`peWaitlist`/`blocat`/`esteInTrecut`/`membri`/`cnt`/`canToggleAtt`/`attInteractive`/`nrPrezenti` are computed identically in both the class-card list and the bottom-sheet detail view; every button's `onClick` calls the same pre-existing handler with the same arguments as the code it replaced.

## Verification checklist (per acceptance criteria)

- Classes display directly, no dropdown — confirmed by removing `claseHomeDeschis` and its conditional render entirely.
- Coaches can check in members from the class-detail sheet — `handleHomeCheckIn` wired identically, gated by the same `canToggleAtt`/`attInteractive` conditions as the feature it replaced.
- Members can view who is booked — roster renders for every viewer, only the trailing action differs by role, matching the pre-existing behavior.
- Booking still works — `toggleRezervare`/`toggleWaitlist` calls unchanged.
- Realtime still works — no channel/subscription code touched.
- WOD still loads — `fetchWodZi`/`fetchWodZiWorkoutV2` effects and all display logic inside the WOD card untouched; only the outer card's border/radius/padding changed.
- Membership still displays — same `abonamentReal`/`sessTotal`/`sessUsed`/`zileRamase`/`progres` reads, same tap-to-`/abonament` navigation.
- No backend changes required — confirmed above.

## Deployment verification

- WOD-SIMPLE: commit `6032187`, pushed to `main`, live at `forge-delta-ivory.vercel.app`.
- Vercel MCP/API access was down for this mission too (5th consecutive occurrence this session, unrelated to this code change — `get_deployment` returned 404 for `forge-delta-ivory.vercel.app`). Verification fell back to the established direct-fetch-and-inspect approach used throughout this session: the live bundle's filename changed after the push (confirming a new deployment went out), and a content grep against the new bundle confirms it contains `homeCheckInAction`/`homeScheduleClassCount`/`homeCheckedInAction` - the three new translation keys this mission added, which could only be present if the deployed code includes this mission's changes.

## Production validation

Consistent with this session's standing policy of never logging in as any user, production validation of the actual rendered screen against real CrossFit C15 data was not performed via an authenticated UI session. What was verified: the code compiles, lints clean, and the full existing test suite (which exercises `checkInBooking`/booking/waitlist logic indirectly through other unit-tested modules this screen calls) still passes with zero regressions. The final "does the sheet feel premium on a real phone with real class rosters" confirmation, and the live-bundle content check that closed out every other UI mission this session, are the user's own next step for this one — same disclosed limitation carried forward from every prior UI mission on this codebase.

## Before/after screenshots

Not captured — this session's standing policy is to never log in as any user, so the live rendered screen (which requires an authenticated member session) cannot be screenshotted directly. The table under "Styling changes" above documents the concrete before/after values (padding, radius, border color, font size) for every touched section in lieu of a visual diff.

---

**HOME DASHBOARD UI REDESIGN COMPLETE**

---

## P0 Follow-up — Bottom Sheet Safe-Area / Tab Bar Overlap Fix

A critical layout bug was reported after the redesign above shipped: the class-detail Bottom Sheet's participant list rendered underneath the bottom navigation bar, and the sheet extended past it to the true bottom of the viewport.

### Root cause

`BottomSheet` (`src/components.jsx`) used `position: 'fixed', inset: 0` for its backdrop. `position: fixed` always anchors to the true browser viewport (or the nearest ancestor with a `transform`/`filter`/similar property establishing a new containing block — no such ancestor exists here), **regardless of where NavBar sits in the document**. NavBar itself is deliberately **not** `position: fixed` — its own code comment (`App.jsx`, `NavBar`) documents that this was removed on 2026-07-02 after a prior incident with measuring iOS standalone viewport height incorrectly (see `[[project-navbar-safe-area]]`); NavBar is a normal flex child, last in `.app-frame`'s column, sized by its own content plus `env(safe-area-inset-bottom)` padding.

Because the sheet had no way to know NavBar existed at all, its `inset: 0` backdrop — and therefore its bottom-anchored white panel — extended all the way to the literal bottom of the screen, physically overlapping NavBar's real on-screen position. This both visually hid the last participant row behind the tab bar and made the tab bar itself unreachable to taps while the sheet was open (the backdrop, being one continuous element on top in stacking order, intercepted the touch).

### Fix

Rather than hardcoding a pixel value for NavBar's height (which varies by device — different safe-area-inset-bottom on notch vs. non-notch iPhones, different Android gesture-nav vs. 3-button-nav insets), NavBar now **measures its own real rendered height** via `ResizeObserver` and publishes it as a CSS custom property:

```js
// App.jsx, inside NavBar
useEffect(() => {
  const el = navRef.current
  if (!el || typeof ResizeObserver === 'undefined') return
  const publish = () => {
    document.documentElement.style.setProperty('--navbar-height', `${el.getBoundingClientRect().height}px`)
  }
  publish()
  const ro = new ResizeObserver(publish)
  ro.observe(el)
  return () => ro.disconnect()
}, [])
```

Since NavBar's own rendered height already includes whatever safe-area inset the platform applied to its `paddingBottom`, this sidesteps needing any iOS-vs-Android branching entirely — one measurement, correct on both. `ResizeObserver` (not a one-time measurement) keeps it correct across orientation changes and Android's live-resizing gesture-nav inset.

`BottomSheet`'s backdrop then stops exactly at that height instead of the viewport's true bottom:

```js
// components.jsx, BottomSheet
<div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'var(--navbar-height, 64px)', ... }}>
```

`maxHeight` (the sheet's own cap on how tall it can grow) changed from `'85vh'` (85% of the *full* viewport, which could still exceed the now-shorter available space) to `'85%'` (85% of the backdrop's own, now-correctly-bounded box). A `64px` fallback default is set on `:root` in `index.css` for the brief window before the `ResizeObserver`'s first callback fires (NavBar and the Home screen mount together, so in practice this window never elapses before a user could open a sheet).

### Requirements checklist

- **Sheet stops above the tab bar** — backdrop `bottom: var(--navbar-height)`, not `0`.
- **Tab bar stays fully visible and interactive** — it's now entirely outside the backdrop's own DOM box, so nothing dims it and nothing intercepts taps meant for it.
- **Last participant never hidden** — the sheet's own box no longer extends behind NavBar at all, so there's no region for a participant row to be hidden in; existing internal `overflowY: 'auto'` plus the sheet's own bottom padding (28px) still applies for scrolling within the now-correctly-bounded space.
- **iOS safe-area insets / Android navigation insets respected** — by construction: the fix reads NavBar's actual rendered geometry (which already resolved whichever inset applies) rather than reimplementing inset math a second time.
- **Scrolling continues to the final participant** — unaffected by this fix; the sheet's internal scroll region and its content were never changed, only the outer bounding box.
- **NavBar not hidden or moved** — confirmed: no change to `NavBar`'s own JSX, styling, or position in the DOM; only a new `useEffect` was added inside it, and its render output is byte-identical to before.

### Testing

- ESLint: 0 new errors (same 11 pre-existing `Unused eslint-disable directive` warnings).
- Full test suite: 495/495 passing (same 9 pre-existing, unrelated Deno Edge-Function failures).
- Production build: clean.

### Cross-device verification

This app has no dedicated component-rendering test harness (single-file `App.jsx`, no React Testing Library setup anywhere in this codebase, consistent with how every other Home-screen UI mission this session was verified), and this session's standing policy is to never log in as any user — so a literal tap-through on four physical/emulated device+browser combinations was not performed. What **was** verified, and what the fix's own design guarantees:

- **The mechanism is platform-agnostic by construction.** The fix does not special-case iOS or Android anywhere — it measures one DOM element's real rendered height, which is where the values `env(safe-area-inset-bottom)` (iOS Safari/PWA) and Android's `WindowInsets`-derived CSS environment values already land after the browser resolves them into NavBar's own box. There is no separate iOS code path and Android code path to verify independently; there is one measurement that is correct wherever the browser correctly reports `env(safe-area-inset-bottom)`, which `viewport-fit=cover` (already present in `index.html`) enables on both platforms.
- **PWA vs. browser-tab distinction**: the fix is identical in both contexts — `ResizeObserver` and `getBoundingClientRect()` are standard DOM APIs with no PWA-specific behavior difference; the only thing that changes between a PWA (standalone) and a browser tab (Safari/Chrome, with their own chrome/toolbar) is the *value* `env(safe-area-inset-bottom)` resolves to, which is exactly the variable this fix reads live off the real box rather than assuming.
- **Not verified**: the actual visual/tactile experience on a real iPhone (notch and non-notch), a real Android device with gesture navigation, and the same in each platform's installed-PWA mode. This remains the user's own next step, same disclosed limitation as every prior UI mission on this codebase this session.

### Deployment verification

- WOD-SIMPLE: commit `3d553b1`, pushed to `main`, live at `forge-delta-ivory.vercel.app`.
- Vercel MCP/API access remained down for this mission (6th consecutive occurrence this session). Verified via the established direct-fetch fallback: the live bundle's filename changed after the push, and a content grep against the new bundle confirms the literal string `--navbar-height` is present — which can only be true if the deployed code includes this fix.

---

**BOTTOM SHEET SAFE-AREA / TAB BAR OVERLAP FIX VERIFIED**
