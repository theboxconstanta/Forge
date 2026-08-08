# Forge PWA — Home Dashboard Visual Polish v2

A pure visual refinement pass on top of the already-shipped Home Dashboard redesign (`HOME_DASHBOARD_UI_REDESIGN_REPORT.md`) and its P0 safe-area follow-up. No architecture, backend, database, RPC, realtime, attendance, booking, membership, routing, or state-management changes — every handler and piece of state (`setDataAcasa`, `setClasaHomeSelectata`, `toggleRezervare`, `toggleWaitlist`, `handleHomeCheckIn`, `setCalPickerYear`/`setCalPickerMonth`/`setShowCalPicker`, `setWodDeschis`, `setScreen`) is called exactly as it was before this pass.

## Typography changes

| Element | Before | After |
|---|---|---|
| Greeting | 26px/800, dominant hero element | 13px/500, `#6B7280`, subordinate — top-left, no longer competes for attention |
| Month/date label | 13px/700, small label with a caret, sat next to the calendar strip | **35px/700**, `#111111`, now the screen's primary headline — same tap-to-open-year-picker behavior, just visually promoted |
| Date tile day-letter/month | 10px/700 gray | 10px/600 gray (`#9CA3AF`) |
| Date tile day-number | 21px, weight 900/500 depending on state | 19px/700, always `#111111` (weight no longer changes by state — the lime background alone signals selection) |
| TODAY label | 12px/800 | 12px/700, `#111111` |
| Class name | 15px/700 | unchanged size, color moved to `#111111` |
| WOD "No WOD today" / title | 17px/700 | 17px/600 (slightly less heavy per "reduce visual weight") |

## Calendar square implementation

The single most important change in this pass. Date tiles were previously `60px × 72px` (rectangular) with a visible 4th row (a ✓/⚡ indicator for "has a reservation" / "has a WOD"). They are now:

- **Exactly `64px × 64px`** for every tile, selected or not — `boxSizing: 'border-box'` ensures the border never changes the rendered box size, so the selected (borderless, lime-filled) tile and an unselected (`1px` bordered) tile are pixel-identical in dimension.
- **20px radius**, `1px solid #E5E7EB` border when unselected, `2px solid #111111` when it's today-but-unselected (existing "where's today" affordance, kept), no border (lime fill) when selected.
- **Three stacked rows only**, matching the mock exactly: day letter (top, small, gray) → day number (center, 19px/700, black) → month abbreviation (bottom, small, gray).
- The reservation/WOD indicator (previously a full 4th row, `✓` or `⚡`) is preserved as a **tiny absolutely-positioned glyph in the top-right corner** of the square instead of a stacked row — same signal (`areRez`/`areWod`), same meaning, but no longer competes with the 3-row layout the mock specifies. This was a deliberate resolution of a real tension between "preserve existing functionality" (the indicator conveys real information) and the mock's explicit 3-row spec (no room for a 4th row in a true square) — chosen over silently dropping the indicator.
- Selected tile: `#B7E63A` background, `#111111` text — same square dimensions, confirmed via `boxSizing: 'border-box'` (no `padding`-driven size drift between states).

## Spacing refinements

- Date-selector outer padding reduced from `0 20px 18px` to `8px 16px 20px` — narrower side padding lets the square row use more horizontal space ("let the calendar breathe").
- Inter-tile gap increased from `8px` to `10px`.
- Header vertical padding reduced (greeting no longer needs the room a 26px hero line required).
- Class card padding increased from `14px 16px` to a uniform `18px` ("slightly taller vertical padding" per the mock).
- Membership card padding increased from `14px 16px` to `18px 20px`, `marginBottom` between its two rows bumped `8px → 10px`.

## Color refinements

New palette applied throughout every section touched in this pass, per the mission's explicit "Design direction":

- Borders: `#ECECEC` → **`#E5E7EB`**
- Primary text: `#0E0E0E` → **`#111111`** (typography only — solid black button/badge/time-block *backgrounds* were left as `#0E0E0E`, since the instruction specifically named "black typography," not every black surface)
- Secondary/gray text: `#888`/`#aaa` → **`#6B7280`** / **`#9CA3AF`**
- Chevron: `#ccc` → **`#D1D5DB`**
- Accent (Forge lime): `#ABE73C` → **`#B7E63A`**, applied to: the selected date square, the reserved-class badge, the corner reservation/WOD glyph, the avatar-circle initials/spinner accent, and — per the mission's own "Navigation bar" section — **NavBar's active-tab color**, which previously used a third, slightly different lime (`#afe607`) found nowhere else in the app. NavBar's inactive icons/labels changed from black to `#9CA3AF` per "inactive icons should be gray."

Time block (class card): now a fixed **56×56px** flex-centered square (was auto-height with `10px 12px` padding and a `minWidth`), rounded rectangle (`16px` radius, not a circle), black background, white text — matches the mock's "approximately 56×56" spec exactly.

WOD card's expand/collapse toggle: previously inverted to a solid `#0E0E0E` circle with lime text when expanded (a "visually heavy control" per the mission's own description). Now a **light gray circle (`#F3F4F6`) in both states**, using a subtle `1.5px #D1D5DB` border (not a color inversion) to signal "expanded" — same `onClick`/`wodDeschis` toggle, only its two visual states changed.

## Visual hierarchy

Matches the mission's explicit ordering — DOM order is now: greeting (small, top-left) → month headline → calendar squares → Today class card(s) → WOD card → membership card. The greeting sits first in markup (top of the screen) but is visually the least prominent element by design (13px gray vs. the 35px black month headline immediately below it), exactly as specified: "The greeting should become a subtle personal detail rather than the hero element."

## Confirmation: no architecture, backend, or database changes

- **Zero new Supabase queries, RPCs, or mutations.** Every data read (`claseDB`, `rezervariMele`, `rezervariPerClasa`, `waitlistMea`, `abonamentReal`, `homeCalendarChips`, `wodZiData`/`wodZiWorkoutV2`, `wodLogs`) is the exact same state used before this pass, populated by the exact same effects.
- **Zero new event handlers.** Every `onClick` calls a pre-existing function with the same arguments as before (`setDataAcasa(ds)`, `setClasaHomeSelectata(c.id)`, `setCalPickerYear/Month/setShowCalPicker`, `setWodDeschis(!wodDeschis)`, `setScreen('profile'|'abonament')`).
- **Zero permission changes.** `isAdmin`/`isCoach`/`canToggleAtt` untouched (not in scope for this pass — no attendance-gating code was touched).
- **Zero realtime changes.** No channel/subscription code in this pass at all.
- **One presentation-only helper**: the inline capitalize-first-letter IIFE for the month name (`m.charAt(0).toUpperCase() + m.slice(1)`) is pure string formatting for display, reading the same `selData.toLocaleDateString(...)` call as before — no new data source.

## Testing

- ESLint: 0 new errors — same 11 pre-existing `Unused eslint-disable directive` warnings, unrelated to this pass.
- Full test suite: 495/495 passing (the 9 pre-existing Deno Edge-Function `@std/assert` failures are unrelated and unchanged, consistent with every prior mission this session).
- Production build: clean (same pre-existing single-chunk size warning, the deliberately-deferred code-splitting item).
- Manual re-read of the entire rewritten block confirmed every derived variable (`selData`, `claseZi`, `rezervat`, `nrRez`, `plin`, `peWaitlist`, `esteAzi`) and every handler call matches the code it replaced, byte-for-byte in logic.

## Responsive verification

Consistent with this session's standing policy of never logging in as any user, and with no dedicated component-rendering test harness for this single-file `App.jsx` codebase, a literal tap-through on iPhone, Android, and installed-PWA mode was not performed. What the fix's own construction guarantees, and what was checked:

- The 64×64 square uses `boxSizing: 'border-box'` with fixed `width`/`height` in px (not `%`/`vw`), so its dimensions are identical across any viewport width — this is not a responsive layout that could break at different screen sizes, it is a fixed-size tile inside a horizontally-scrolling strip, the same pattern the prior (rectangular) chip already used successfully across this session's earlier device-width concerns.
- The iOS-Safari "ghost pixel" `translateZ(0)` GPU-layer workaround on the date tiles (documented inline, from an earlier session incident) was preserved unchanged in this pass — not touched, not removed.
- The BottomSheet safe-area/tab-bar fix from the previous mission is untouched by this pass (no changes to `components.jsx` or NavBar's `ResizeObserver` logic beyond the one color value).
- Not verified: actual rendered pixel-perfection on a real iPhone/Android device or installed PWA. This remains the user's own next step, the same disclosed limitation carried forward from every prior UI mission on this codebase this session.

## Before/after screenshots

Not captured — same standing policy as every prior UI mission on this codebase (never log in as any user; the live rendered screen requires an authenticated member session). The tables above document every concrete before/after value (px, hex, weight) for each touched element in lieu of a visual diff.

## Deployment verification

- WOD-SIMPLE: commit `86d093f`, pushed to `main`, live at `forge-delta-ivory.vercel.app`.
- Vercel MCP/API access remained down for this mission (7th consecutive occurrence this session). Verified via the established direct-fetch fallback: the live bundle's filename changed after the push (two deploys were observed in quick succession while re-checking — the first fetch caught an in-flight/stale edge response with 0 matches, a second cache-busted fetch against the newest bundle confirmed the literal string `B7E63A` — the new Forge lime hex introduced in this pass, unique to this commit — present twice in the deployed code).

---

**HOME DASHBOARD VISUAL POLISH V2 COMPLETE**
