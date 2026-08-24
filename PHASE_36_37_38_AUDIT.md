# Phase 36 — Observability & Production Debugging

## Client-side error tracking (WOD-SIMPLE member PWA)

**HIGH CONFIDENCE.** Sentry is integrated client-side via `@sentry/react` (`package.json`: `"@sentry/react": "^10.63.0"`, `"@sentry/vite-plugin": "^5.3.0"`).

`src/main.jsx:53-61` initializes Sentry conditionally on `import.meta.env.VITE_SENTRY_DSN`:
```js
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      Sentry.supabaseIntegration({ supabaseClient: supabase }),
    ],
  })
}
```
The architecture is deliberate (per the surrounding Romanian comments): rather than retrofitting ~1,900 existing `console.error` call sites with explicit `Sentry.captureException`, `captureConsoleIntegration` automatically forwards every `console.error` call to Sentry. `src/App.jsx` alone has 63 `console.error` calls (grep count) and only 1 `console.log`, 0 `console.warn` — the codebase has already standardized on `console.error` as the "this is a real problem" signal, which makes the integration effective in practice, not just in theory.

A top-level `Sentry.ErrorBoundary` wraps the whole render tree (`src/main.jsx:219-224`) with a user-facing fallback ("Ceva nu a mers bine... Am fost notificați automat despre eroare").

**Empty/silent catches are rare** — only 2 in all of `App.jsx` (`src/App.jsx:582`, `src/App.jsx:2547`), both trivial `sessionStorage`/`localStorage` reads/writes, not user-facing operations. This is a genuinely clean result for a file this size.

## Client-side error tracking (forge-admin-web, coach/admin app)

**HIGH CONFIDENCE — real gap.** `grep -i sentry` across `forge-admin-web/package.json` and all of `forge-admin-web/src` returns **zero matches**. There is no error-tracking SDK of any kind in the admin app.

Total `console.*` usage in forge-admin-web's `src/` is only 6 call sites across 4 files:
- `src/features/programming/EditWorkoutDialog.tsx:102`
- `src/features/programming/mutations.ts:71,240,248`
- `src/lib/realtime.ts:79` (dev-only, gated by `import.meta.env.DEV`)
- `src/shell/RouteErrorBoundary.tsx:26`

`src/shell/RouteErrorBoundary.tsx` (the app's one React error boundary, wrapping routed content — full text read) does:
```tsx
componentDidCatch(error: Error, info: ErrorInfo) {
  console.error('Route content crashed:', error, info.componentStack)
}
```
With no Sentry/reporting SDK present, **any React render crash in the coach/admin app today is invisible outside a live devtools session** — it shows a "Something went wrong" card to the coach and nothing else happens server-side or in any dashboard. This is the single most consequential Phase 36 finding: the client that gym staff and admins depend on for billing, member management, and programming has strictly less production visibility than the member-facing PWA.

## Edge functions — is there structured logging or a monitoring SDK?

**HIGH CONFIDENCE.** `grep -i sentry` across `supabase/functions/**` (Deno edge functions, the only backend both repos share — `forge-admin-web` has no `supabase/functions` directory of its own) returns **zero matches**. Sentry (or any SDK) is not wired into edge functions at all — only the browser client has it. Edge function logs go only to Deno's stdout/stderr, which Supabase captures as plain-text function logs in its own dashboard; there is no cross-linking to Sentry issues, no alerting, no structured JSON.

Total `console.*` calls across the 20 edge functions with an `index.ts`: 98, all ad-hoc string-interpolated messages of the form `` `${functionName}: ${context}` ``, e.g.:
- `supabase/functions/analyze-workout/index.ts:73`: `console.error("analyze-workout: lipsește secretul OPENAI_API_KEY")`
- `supabase/functions/stripe-webhook/index.ts:165`: `console.error("stripe-webhook: unexpected error:", err)`
- `supabase/functions/admin-remove-member/index.ts:161`: `` console.error(`admin-remove-member: unhandled exception at step`, step, ":", err) ``

There is no JSON-structured logging (no `{level, function, user_id, gym_id, op, timestamp}` shape) anywhere in the 20 functions — every log line is a plain string, which means log lines are only greppable/filterable by substring in whatever raw log viewer is used (Supabase dashboard), not queryable by field.

**One genuinely good pattern found:** `supabase/functions/admin-remove-member/index.ts` tracks a `step` variable (`step = "verify_caller_token"`, `step = "lookup_target_profile"`, etc., reassigned before every await) and logs it in the final catch block (`console.error("admin-remove-member: unhandled exception at step", step, ":", err)`, line 161) — this answers "what failed" at a specific point in a multi-step operation without needing a stack trace to be useful. This pattern is **not** replicated in the other admin-mutation functions (`admin-add-member`, `admin-transfer-member` do have local `errDetail` helpers but no `step` tracking — not verified exhaustively beyond these three).

There is also a shared `errDetail()` helper (`supabase/functions/_shared/invite.ts:36`) that expands a raw Postgres/Auth error into `{message, code, details, hint, status, name}` before logging — much richer than `.message` alone, and explicitly documented as "server-side logs only, never returned to the caller." **However, 4 functions redefine an identical local copy of this same helper instead of importing the shared one:** `admin-remove-member/index.ts:43`, `admin-add-member/index.ts:34`, `admin-transfer-member/index.ts:24`, `redeem-transfer-code/index.ts:25` — all four already import other things from `../_shared/invite.ts` or a sibling function, so this is pure, avoidable duplication (minor, not a functional bug, worth a cleanup pass).

## Can "which user, which gym, which operation, when, what failed" actually be answered today?

**HIGH CONFIDENCE — concrete gap, directly verified.** Using `analyze-workout/index.ts` as the representative case (per the brief): the function resolves both `caller.id` (`supabase/functions/analyze-workout/index.ts:47`, `const { data: { user: caller } } = await anonClient.auth.getUser(token)`) and `gymId` (`analyze-workout/index.ts:44`, `const gymId = typeof body?.gymId === "string" ? body.gymId : null`) early in the request — both values are in scope for the entire handler. **Yet none of the function's 9 `console.error` calls (lines 73, 102, 104, 110, 117, 123, 131, 138, 144) include `caller.id` or `gymId`.** A production OpenAI failure or validation failure is logged as e.g. `"analyze-workout: răspuns AI invalid după validare"` with no way to tell which coach/gym triggered it without cross-referencing timestamps against other data sources (which don't exist here either — no request-id, no correlation id passed through).

`stripe-webhook/index.ts` is better in this one specific respect: several of its logs include `context.orderId` / `context.subscriptionId` / `event.id` (lines 99, 108, 118, 131, 155) because those IDs are the natural key for that domain — but there's still no `gym_id` in most of these lines even though `order.gym_id` is fetched (line 106) and available.

`admin-remove-member/index.ts` is the best of the three representative functions: `client_id` (the target being removed) is available throughout, and several logs at least reference `sub.id` or table names, but the caller's own `gym_id`/`admin id` is not included in any of the error log strings either — only implicitly recoverable if the operation succeeded far enough to reach a step that touches it.

**Conclusion:** for all three representative edge functions checked (`analyze-workout`, `stripe-webhook`, `admin-remove-member`), the request-scoped context needed to answer "which user, which gym" *exists in memory* at the point of most errors but is *not included* in the log line. Today, diagnosing a specific user's report ("my request failed at 3pm") against production logs would require manually correlating by approximate timestamp and function name only.

## Where do errors currently vanish with zero server-side trace?

**HIGH CONFIDENCE:**
1. **forge-admin-web, entirely** — no Sentry, so every `console.error` in `mutations.ts`, `EditWorkoutDialog.tsx`, and `RouteErrorBoundary.tsx` only ever reaches a browser devtools console that a coach/admin is very unlikely to have open. `mutations.ts:71` (`console.error('Workout Engine V2 sync failed:', err)`) and `mutations.ts:240,248` (aggregate-definition/leaderboard-visibility save failures) are silent to anyone but the person who happened to be looking.
2. **Any Deno edge function error where the invoking client never surfaces the response** — edge function logs only exist in the Supabase function-log viewer (not proactively pushed anywhere); if nobody goes looking, a failing `send-class-reminders` or `check-subscriptions` cron-triggered function (no interactive user waiting on a response at all) could fail silently indefinitely. **MEDIUM CONFIDENCE** this is a real risk in practice — I did not verify whether these specific functions are invoked by `pg_cron`/scheduled triggers (would need DB/dashboard access) vs. some other alerting.

## What I could not verify (Phase 36)
- Whether `VITE_SENTRY_DSN` is actually set in the production build (this is env/deploy config, not visible in source) — **UNVERIFIED**, needs Vercel/deploy dashboard or `.env.production` access.
- Whether Sentry alerting (Slack/email notifications on new issues) is configured on the Sentry project side — **UNVERIFIED**, needs Sentry dashboard access (the user's memory notes a `reference_sentry_access.md` entry indicating personal API token access exists, but this session did not use it).
- Whether Supabase's own function-log retention/alerting features (e.g. log drains) are configured — **UNVERIFIED**, needs Supabase dashboard access.
- Whether `send-class-reminders` / `check-subscriptions` are actually invoked on a schedule (pg_cron or otherwise) with no human ever watching the response — **UNVERIFIED**, would need DB scheduler inspection.

---

# Phase 37 — Accessibility & Basic UX Safety

## Clickable `<div>`s vs real interactive elements

**HIGH CONFIDENCE.** `grep -c "<div[^>]*onClick="` on `src/App.jsx` (WOD-SIMPLE) returns **66** matches. `grep -c "tabIndex|onKeyDown|role=\"button\""` across the same file returns only **8** matches total (and one of those 8 is a `role="switch"` toggle at `App.jsx:2432`, not a button-role div). This means the large majority of the ~66 clickable divs have no keyboard affordance at all — a keyboard-only user cannot Tab to or activate them with Enter/Space. Representative examples (all missing `role`, `tabIndex`, and `onKeyDown`):
- `App.jsx:1503` — variant/movement selector row: `<div key={m.id} onClick={() => setMod(m.id)} ...>`
- `App.jsx:1863` — gender tab: `<div key={g.id} onClick={() => setGenderTab(g.id)} ...>`
- `App.jsx:1990` — expandable log card: `<div key={cardKey} onClick={() => setExpandedLogId(...)} ...>`
- `App.jsx:3891` — admin tab switcher: `<div key={tab.id} onClick={() => setAdminTab(tab.id)} ...>`
- `App.jsx:3977` — client-row expander in the admin client list: `<div key={c.id} onClick={() => setClientSelectat(...)} ...>`

This is a broad, systemic pattern (tabs, list-item selection, expand/collapse rows) rather than a handful of isolated spots — essentially all custom tab bars and selectable list rows in the member PWA are unreachable by keyboard.

In forge-admin-web, the same grep across `src/**/*.tsx` finds only **2** occurrences, both in `src/features/programming/FormatConfigEditor.tsx` — a much smaller footprint, consistent with it being a newer, more disciplined codebase (its `Dialog`/button usage is more conventional — not exhaustively re-verified beyond this one file).

## Form input labeling

**MEDIUM CONFIDENCE (representative sample, not exhaustive).** `App.jsx` has 85 `<input` elements, but only 2 `aria-label=` and 2 `<label` occurrences in the entire file. 77 inputs use a `placeholder=` attribute. Spot-checked examples (`App.jsx:753,878,883,887,894,899,948,951,997,1101,1105,1112,1238,1274,2412`) confirm the dominant pattern: a bare `<input>` with `placeholder` text and no `<label>`/`aria-label`/`aria-labelledby`, often paired with a nearby plain `<div>` used as a *visual* label only (not programmatically associated). This is functional for sighted mouse/touch users (which is presumably the overwhelming majority of gym members) but placeholder-only inputs fail for screen-reader users (placeholder text disappears once text is entered and is not reliably announced as a label by all assistive tech) and for anyone relying on browser autofill/label-click-to-focus. Given the "lightweight" framing of this phase, flagging this as a systemic pattern rather than enumerating all 85 inputs individually.

## Modal/dialog focus management

**HIGH CONFIDENCE — mixed result, real inconsistency found.**

WOD-SIMPLE has one shared, well-built dialog primitive, `BottomSheet` (`src/components.jsx:105-165`), which does everything correctly: focuses the first focusable element on open (`components.jsx:110-111`), traps Tab/Shift+Tab inside the sheet (`components.jsx:118-129`), closes on Escape (`components.jsx:114-116`), restores focus to the previously-focused element on close (`components.jsx:134`), and sets `role="dialog" aria-modal="true"` (`components.jsx:160`).

**However, `BottomSheet` is not used for every full-screen overlay in the app.** A grep for the raw overlay pattern `position: 'fixed', inset: 0` in `App.jsx` alone (not counting `components.jsx`) finds **13** distinct overlays, e.g.:
- `App.jsx:5007-5008` — the "post-transfer panel" modal: plain `<div onClick={closePostTransferPanel} style={{position:'fixed', inset:0, ...}}>` wrapping a plain `<div onClick={e => e.stopPropagation()} ...>` — **no `role="dialog"`, no `aria-modal`, no focus trap, no Escape handler.**
- `App.jsx:6004-6006` — a share-card modal, same pattern (backdrop `onClick={onClose}`, inner div `stopPropagation`, close `<button>`) — no dialog role/focus trap.
- `App.jsx:9002-9151` — five near-identical "locked feature" / owner-bootstrap modals (zIndex 500-700), all following the same bare-div-overlay pattern with no dialog semantics.
- `App.jsx:11176-11227` — a calendar-picker popover and a bottom-sheet-styled progress-dots panel, also without `role="dialog"`/focus trap.

So the codebase has *solved* this problem once (`BottomSheet`) but roughly a dozen other modal-like surfaces in `App.jsx` predate it or were built ad-hoc alongside it and never adopted it — a real, concrete, fixable inconsistency rather than a wholesale absence of the pattern.

forge-admin-web is markedly more consistent here: a single shared `Dialog` component (`src/components/Dialog.tsx`, full file read) implements the identical correct pattern (focus-first-element, Tab-trap, Escape-close, focus-restore, `role="dialog" aria-modal="true" aria-labelledby`) and is imported by essentially every feature dialog found in the codebase (`EditWorkoutDialog.tsx`, `QuickCreateDialog.tsx`, `DuplicateWorkoutDialog.tsx`, `SeriesScopeDialog.tsx`, `AggregateEditor.tsx`, and others — confirmed by file list, not every caller individually re-read). This is a case where the newer/smaller admin codebase is architecturally ahead of the member PWA.

## Loading indicators / double-submit protection on irreversible actions

**HIGH CONFIDENCE — inconsistent, with one concrete unprotected case found.**

Good pattern (found twice, WOD-SIMPLE):
- Feed post (`App.jsx:2230-2237`): `posteaza` guards re-entry at the top (`if (!postText.trim() || posting) return`) and toggles `posting` around the insert.
- WOD score save (`App.jsx:6331` declares `wodSaving`; save button at `App.jsx:10284-10286`): `<button onClick={saveWodLog} disabled={wodSaving} ...>{wodSaving ? t.logWodSaving : ...}</button>` — properly disables the button and swaps in a "saving" label during the async request.

**Unprotected case:** class booking/cancellation (`toggleRezervare`, `App.jsx:8517-8601`) has **no `posting`/`saving`-style guard at all** — no early-return re-entry check inside the function, and none of its three call sites (`App.jsx:9436`, `9453`, `9914`) pass a `disabled` prop or show any loading state on the button while the `insert`/`delete` + session-adjustment sequence (which is 2-4 sequential awaited Supabase calls, e.g. lines 8570-8578 or 8581-8597) is in flight. A user double-tapping "Cancel" or a booking button during a slow connection has no UI feedback that the first tap was received, and could fire the handler twice before the first `await` resolves. Whether this produces a *visible* bug depends on server-side constraints (e.g., a duplicate-insert would likely fail on a primary/unique key and just show a second, swallowed error) — this is a UX-safety gap (missing feedback + guard), not independently confirmed as a live double-booking data-integrity bug.

## What I could not verify (Phase 37)
- Color contrast — out of scope for static analysis per the brief, **UNVERIFIED**, needs visual/runtime tooling.
- Screen-reader behavior in practice (e.g., whether `captureConsoleIntegration`-adjacent ARIA attributes actually announce correctly in VoiceOver/TalkBack/NVDA) — **UNVERIFIED**, needs a real assistive-tech runtime test, not just source inspection.
- Whether the ~13 non-`BottomSheet` modals in `App.jsx` are all still reachable/live code paths (some could be for rarely-hit admin/owner-bootstrap flows) — spot-checked but not click-tested; **MEDIUM CONFIDENCE** on real-world exposure/frequency, HIGH CONFIDENCE on the code pattern itself.
- forge-admin-web's clickable-div and label coverage was checked at the repo-wide grep level, not read file-by-file the way `App.jsx` was — treat its "looks better" finding as **MEDIUM CONFIDENCE**, not as thorough as the WOD-SIMPLE analysis.

---

# Phase 38 — Dependency & Platform Audit

## WOD-SIMPLE (member PWA)

Lockfile: `package-lock.json` (npm).

- **React 19.2.6**, **React DOM 19.2.6** — current-generation (React 19 is the latest major as of this audit).
- **Vite 8.0.12** — current-generation (Vite 8 is the latest major line).
- No TypeScript — plain JS/JSX throughout, consistent with this being described as "plain JS/React" in the mission brief.
- **`@supabase/supabase-js`: `^2.108.2`** — current v2 line, not dated.
- **Stripe**: not present as an npm dependency in `package.json` at all — Stripe usage lives entirely in the Deno edge functions (`npm:stripe` specifiers, Deno-native, resolved independently of the root `package.json`/lockfile — see Phase 36/edge-function notes above for version-pinning gaps there).
- **AI SDK**: no `openai` package (or any AI SDK) in `package.json`. `supabase/functions/_shared/openai.ts` (full file read) confirms raw `fetch("https://api.openai.com/v1/responses", ...)` with manual retry/timeout/AbortController logic (lines 43-103) — no SDK. This matches and confirms this session's own prior finding stated in the brief.
- **Sentry**: `@sentry/react ^10.63.0` + `@sentry/vite-plugin ^5.3.0` — current-generation major version.
- **Tailwind CSS 4.3.2** via `@tailwindcss/vite` — current-generation (v4).
- **Capacitor** (`@capacitor/android`, `@capacitor/app`, `@capacitor/cli`, `@capacitor/core`, all `^8.x`) — native Android wrapper; current major (Capacitor 8). No equivalent in forge-admin-web (expected — admin app is web-only by design, not flagged as a gap).
- **lucide-react `^1.23.0`** — icon library.
- No date library (`date-fns`, `dayjs`, `moment`) in dependencies, and `grep -rl "date-fns|dayjs|moment("` across `src/` found zero source usage either — dates are handled with native `Date`/manual string formatting throughout (e.g., the `_azi`/`aziStr` pattern at `App.jsx:8603-8604`). Not a "deprecated dependency" finding, just confirms no drift vs. forge-admin-web on this axis.
- No form library (`react-hook-form`, `formik`) — forms are plain `useState`, consistent across both repos (see below).
- Nothing found with a clearly dated/abandoned major version.

## forge-admin-web (coach/admin app)

Lockfile: `package-lock.json` (npm) — same lockfile technology as WOD-SIMPLE, no cross-repo drift there.

- **React 19.2.7**, **React DOM 19.2.7** — current-generation, one patch ahead of WOD-SIMPLE's 19.2.6 (trivial, not a real gap).
- **Vite 8.1.1** — current-generation, ahead of WOD-SIMPLE's 8.0.12.
- **TypeScript `~6.0.2`** + `typescript-eslint ^8.65.0` — current-generation TS major.
- **`@supabase/supabase-js`: `^2.110.8`** — slightly ahead of WOD-SIMPLE's `^2.108.2`. Both are current v2, not a meaningful version-skew risk by themselves, but worth noting: the two clients pin *different* minor versions of the same library against the same backend, so a breaking behavior change in one client's resolved version wouldn't necessarily show up in the other's CI/tests.
- **Stripe**: no `stripe` npm dependency here either — forge-admin-web has no `supabase/functions` directory of its own (confirmed via directory listing; it shares WOD-SIMPLE's edge functions as the sole backend for both clients), so it never needs a server-side Stripe SDK, and (as far as `package.json` shows) does not call Stripe client-side either.
- **AI SDK**: none present — forge-admin-web has no direct OpenAI/AI dependency; any AI-powered features (e.g., Coach Quick Create "Regenerate with AI", per user memory) call the shared `regenerate-variant`/`analyze-workout` edge functions rather than embedding an SDK client-side.
- **Sentry**: absent (see Phase 36 — this is the most consequential dependency-level asymmetry between the two repos).
- **Tailwind CSS 4.3.3** via `@tailwindcss/vite` — matches WOD-SIMPLE's major version (v4), one patch ahead.
- **`react-router-dom ^7.18.1`** — present here, absent in WOD-SIMPLE. **Not flagged as duplicate-library drift**: WOD-SIMPLE's `src/main.jsx` comments explicitly document a deliberate architectural choice ("WOD-SIMPLE has no router — a single component tree gated by auth state") with hand-rolled path matching (`inviteRoute.js`) for its few public routes. This is an intentional divergence in app shape, not two teams independently solving the same problem differently.
- **lucide-react `^1.25.0`** — same icon library as WOD-SIMPLE (`^1.23.0`), consistent choice, no duplication.
- **`@testing-library/jest-dom`**: WOD-SIMPLE pins `^6.9.1`, forge-admin-web pins `^7.0.0` — a real major-version skew on a shared dev dependency across the two repos. Low practical impact (test-only tooling) but is architectural drift by the letter of the brief.
- No date library, no form library — same as WOD-SIMPLE, no duplication found.
- Nothing found with a clearly dated/abandoned major version.

## Cross-repo duplicate-library check (explicit)

Checked explicitly for: date libraries, form libraries, HTTP clients, icon sets, CSS frameworks, testing frameworks, router libraries. Result: **no duplicate libraries solving the same problem** were found (both use native `Date`, both use plain `useState`-driven forms, both use `lucide-react`, both use Tailwind v4, both use Vitest + Testing Library). The one real cross-repo asymmetries found are (1) Sentry present only in WOD-SIMPLE (an *absence*, not a duplication) and (2) the `@testing-library/jest-dom` major-version skew noted above.

## Edge function dependency pinning (Deno, shared backend)

Not part of a `package.json`/lockfile in the npm sense, but directly relevant to "platform audit" and worth surfacing here since it was uncovered mid-investigation (see Phase 36 for the logging angle on the same functions):
- `@supabase/supabase-js` is imported as `npm:@supabase/supabase-js@2` (major-only pin, floating minor/patch) in **all 20** edge functions with an `index.ts` — this floats independently of, and differently from, the exact `^2.108.2`/`^2.110.8` pins in the two web clients' `package.json`.
- `npm:stripe` is imported with **no version specifier at all** in the bare `import Stripe from "npm:stripe"` statements; actual pinning is inconsistent per function:
  - `stripe-webhook` and `create-checkout-session` each have a `deno.lock` present, resolving to `stripe@17.x` (confirmed via lockfile grep).
  - `purchase-platform-plan` and `platform-billing-webhook` each have a `deno.json` declaring `"stripe": "npm:stripe@^17"` (both files identical) **but no `deno.lock`** — meaning these two payment/billing-adjacent functions have no integrity/exact-version pin at all and will resolve to whatever the latest matching `17.x` release is at each deploy. This is a real reproducibility gap on two functions that touch money (`purchase-platform-plan`, `platform-billing-webhook`).
  - Only 12 of the 20 functions have a `deno.json` at all, and only 5 have a `deno.lock` (`admin-remove-member`, `check-subscriptions`, `create-checkout-session`, `send-notification`, `stripe-webhook`) — pinning discipline is inconsistent across the function set, not a blanket policy.

## What I could not verify (Phase 38)
- Actual installed/resolved versions in `node_modules` or the Deno cache (only manifest ranges and lockfile-pinned versions were read) — did not run `npm ls`; the task explicitly said reading `package.json` directly is preferred and to avoid `npm install`/`npm audit`, so resolved-but-unpinned ranges (e.g., all the `^` ranges) are **UNVERIFIED** beyond what the caret range itself implies.
- Whether any transitive dependency (not a direct one) is deprecated/vulnerable — out of scope per the instruction not to run `npm audit`.
- Whether `forge-admin-web` has its own native/mobile shell planned or intentionally excluded (Capacitor asymmetry) — this is a product decision, **UNVERIFIED** against any roadmap doc.
