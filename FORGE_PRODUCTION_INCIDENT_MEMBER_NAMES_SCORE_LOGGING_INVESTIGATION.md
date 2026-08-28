# FORGE — Production Incident Investigation: INC-01 (Member Name Fallback) + INC-02 (Score Logging Failure)

Investigation-only. No code, schema, RLS, triggers, or production data were changed. All live DB tests used disposable rows inside `BEGIN`/`ROLLBACK` transactions. No PII (names/emails) is printed anywhere in this report — only counts, booleans, and anonymized UUIDs.

---

## 1. Executive Summary

**INC-01**: Root cause **not conclusively identified**. Database data integrity is fully clean (zero orphaned rows, zero null names, zero literal `'Member'` values stored anywhere). Live RLS testing confirms an admin sees 100% of their gym's `profiles` rows. One confirmed, but narrow and long-standing (since 2026-07-06, not new), contributing mechanism was found via Sentry: the Feed's own name-fallback path fails specifically during JWT-expired query windows. This does not fully explain a broader "some members show Member" report on other surfaces (Admin, Leaderboard). Status: **PARTIALLY EXPLAINED, LOW-MEDIUM CONFIDENCE**.

**INC-02**: Root cause **confirmed with HIGH confidence** via a live Sentry error. A pre-existing (unmodified since 2026-07-13), unguarded client-side line in the score-save handler (`App.jsx:8350`, `` wodZiData.type ``) throws `TypeError: Cannot read properties of null (reading 'type')` when a member has an official variant selected (`variantaAleasa !== null`) but `wodZiData` (the fetched WOD-of-the-day row) is `null` — crashing the save handler **before it ever reaches the `supabase.from('wod_logs').insert(...)` call**. This is newly *occurring* in production (first observed 2026-08-27T14:54:43Z, escalating, 14 occurrences as of this report), though the vulnerable code itself is over a month old and untouched by any recent P0/security/timezone mission. Status: **CONFIRMED, HIGH CONFIDENCE**.

---

## 2. Severity

```text
INC-01: P2 — confirmed contributing mechanism is narrow, long-standing, and low-frequency (Feed
        surface only); broader Admin/Leaderboard occurrence could not be reproduced or confirmed
        against live data or Sentry evidence. Downgrade rationale: no data corruption, no
        blocked core workflow — a cosmetic display fallback only.
INC-02: P1 — a confirmed, live, currently-escalating client-side crash blocks score submission
        for an identifiable (not literally 100%, per both direct DB testing and Sentry's own
        14-event count) but real and growing subset of save attempts. Recommend re-escalating to
        P0 if broader monitoring shows this affecting a larger fraction of attempts than Sentry's
        own sample suggests — Sentry only captures what actually reaches the browser's JS runtime
        and is instrumented; it cannot prove this is the *only* failure mode.
```

---

## 3. INC-01 Reproduction

**Could not be reproduced against live production data.** Every direct-data hypothesis tested came back clean:

- `profiles`/`members` field-drift check (`member_domain_consistency_detail`): 26 rows drift on mirrored identity fields, but **zero** have both `full_name` and `email` empty on the `profiles` side (the exact condition required to trigger a literal `'Member'` fallback) — 9 have an empty `full_name` but a populated `email`, which correctly falls through to displaying the email, not `'Member'`.
- Zero `profiles` rows anywhere have both `full_name` and `email` empty.
- Zero `wod_logs.member_id` values lack a matching `profiles.id` (no orphans).
- Zero rows in `profiles`/`members` have the literal string `'Member'`/`'Membru'` stored in any name field.
- Live RLS test: an admin identity queries `profiles` and receives exactly 74/74 real rows for their gym — full visibility, no RLS gap.

**Where the fallback appears in code** (confirmed by reading source, not yet confirmed as currently *triggering* against live data):

| Surface | App | Fallback condition |
|---|---|---|
| Social Feed (posts, comments, member list) | WOD-SIMPLE `App.jsx:2298/2332/2382` | `m.full_name \|\| m.email?.split('@')[0] \|\| t.feedMemberFallback` (`'Member'`/`'Membru'`) |
| Member Details panel | forge-admin-web `MemberDetails.tsx:175` | `profile.full_name \|\| [first,last].join(' ') \|\| profile.email \|\| 'Member'` |
| Leaderboard (per-entry, per-comment name) | forge-admin-web `LeaderboardView.tsx:124`, `ResultRow.tsx:67` | `entry.member?.full_name \|\| entry.member?.email \|\| 'Member'` |
| Attendance roster | forge-admin-web `AttendanceList.tsx` | `memberDisplayName(member, member.email ?? 'Member')` |

Every one of these requires **both** name **and** email to be missing/undefined — either from genuinely empty DB fields (ruled out, §above) or from the entire member-lookup object being `undefined` (e.g., a failed/incomplete `fetchMemberRefsByIds` call, or a lookup by an id the map doesn't contain).

## 4. INC-01 Root Cause

**One confirmed, narrow mechanism** (Feed surface, via Sentry — see §7 for the event): the Feed's own query (`[Feed] query error`, Sentry issue `SENTRY-CYAN-HARBOR-19`) fails with Postgres/PostgREST code `PGRST303` (JWT expired) — 167 occurrences since 2026-07-06, still ongoing (last seen 2026-08-27T22:41). When this fires, the Feed's post/member list fetch fails; if the calling code renders with a partial or empty result set rather than surfacing the error, any member whose data wasn't successfully fetched in that failed round-trip would render via the `t.feedMemberFallback` (`'Member'`) branch — not because their data is wrong, but because the query silently failed for an unrelated reason (an expired session token, not a data or name-resolution defect).

**Not confirmed**: whether this same JWT-expiry mechanism (or a different one) explains the fallback appearing on Admin surfaces (`MemberDetails`/`LeaderboardView`/`ResultRow`/`AttendanceList`). No Sentry event was found tying a query failure to these specific components in the time window checked. This gap is disclosed explicitly rather than papered over with a guessed cause.

## 5. INC-01 Production Impact

```text
Total members (gym c5ecbe2c...):        74 (real, live count)
Affected members (confirmed by data):   0 — no member's stored data is itself broken
Affected members (by transient query
  failure, Feed surface only):          unknown/unquantifiable — Sentry issue SENTRY-CYAN-HARBOR-19
                                         has no userCount recorded (0), so the number of distinct
                                         real members who experienced this could not be determined
                                         from the data available; 167 raw error events since 07-06
```

## 6. INC-01 Data Integrity

**Stored data is correct. Any observed fallback is a query/read-path symptom, not a write-path defect.** No name was ever lost, overwritten, or corrupted — confirmed by the zero-orphan, zero-null-both-fields results in §3.

## 7. INC-01 Introducing Change

**NO — not introduced recently.** The Feed JWT-expiry mechanism (§4) has been occurring since 2026-07-06, roughly seven weeks before any of the recent P0-01/P0-02/P0-SEC-01/P0-SEC-02/P0-SEC-03/P0-03 work began. None of those missions touched `feedMemberFallback`, the Feed query code, or JWT/session handling in any repository. `git log`/`git blame` confirm the Feed code paths at `App.jsx:2298/2332/2382` were not modified by any commit in the recent P0 series.

## 8. INC-01 Minimal Fix Proposal (NO IMPLEMENTATION)

Two independent, narrow candidates, neither implemented:
1. **Session-refresh robustness**: ensure the Supabase client proactively refreshes an about-to-expire JWT before a Feed query fires, or retries once transparently on `PGRST303` rather than surfacing a fallback name. Files: wherever the Supabase client's `autoRefreshToken`/session config lives (not yet located in this investigation — would need its own pass), plus the three `feedMemberFallback` call sites in `App.jsx`.
2. **Broader Admin-surface confirmation**: before proposing a fix for `MemberDetails`/`LeaderboardView`/`ResultRow`/`AttendanceList`, first obtain a reproducible case (a specific affected member id + timestamp) since no live evidence currently ties those surfaces to a confirmed mechanism — fixing them speculatively risks masking a different, undiscovered cause.

No DB migration or data backfill is indicated — the data itself is correct.

---

## 9. INC-02 Reproduction

**Confirmed via live Sentry error** (not reproduced by direct DB testing — see §12 for why). A member has an official WOD variant selected (RX/Intermediate/Beginner/OnRamp — `variantaAleasa !== null` in `App.jsx`) and taps Save. The save handler (starting `App.jsx:8330`) computes `wodHeaderLine` at line 8349-8350:

```js
const wodHeaderLine = variantaAleasa !== null
  ? `${wodZiData.type}${durStr ? ' · ' + durStr : ''}${wodZiData.name ? ' — "' + wodZiData.name + '"' : ''}`
  : ...
```

If `wodZiData` (the WOD-of-the-day object fetched for the currently-displayed date) is `null` at this point — while `variantaAleasa` is still non-null (an official variant remains "selected" in UI state) — this line throws `TypeError: Cannot read properties of null (reading 'type')`, an **unhandled** exception that aborts the entire function. Every subsequent line, including the `supabase.from('wod_logs').insert(...)` call at line 8372, **never executes**.

## 10. INC-02 Exact Failure

```text
operation:          client-side JS execution (score-save handler), NOT a Supabase/DB operation
table/RPC:           none reached — the crash occurs before any wod_logs write is attempted
HTTP/PostgREST status: N/A (no request sent for the save itself)
Postgres code:       N/A
error:               TypeError: Cannot read properties of null (reading 'type')
function/location:   App.jsx:8350, inside the score-save handler (minified as "ws" in the
                      production bundle; culprit reported as "ws(src/App)")
Sentry reference:     SENTRY-CYAN-HARBOR-4T (issue id 143266012), isUnhandled: true,
                      substatus: escalating, firstSeen 2026-08-27T14:54:43Z,
                      lastSeen 2026-08-28T06:26:19Z, count: 14
```

Confirmed via Sentry's source-mapped stack frame, which shows the exact surrounding source lines (8345-8350) matching the live repository's current `App.jsx` content exactly.

**Suspected trigger condition** (evidenced, not fully proven): the same event's breadcrumbs show a `GET .../wods?select=*&date=eq.2026-08-27` request alongside other requests dated `2026-08-28` in the same session — a one-day mismatch between the WOD-of-the-day fetch and other same-session queries. `App.jsx`'s `dataAcasa` (the Home screen's selected date) is initialized once via `useState(() => ...)` at component mount and is **not** refreshed by any timer or visibility-change listener — only by explicit user navigation. A device/PWA session left open across a local midnight boundary (a plausible, common real-world scenario for an installed PWA that isn't force-closed) would keep `dataAcasa` frozen on the prior day while other parts of the session (or the user's own subsequent actions) advance to the new day, producing exactly this kind of stale-`wodZiData`-vs-live-UI-state mismatch. This is a genuine hypothesis backed by the breadcrumb evidence, not a confirmed mechanism — a definitive proof would require reproducing the exact multi-hour-idle-session sequence, which was not attempted (out of scope for a safe, non-destructive investigation).

## 11. INC-02 Scope

**Not global.** Two independent, direct live-DB tests as a real member — a plain text-result insert, and a movement-keyed `sets` JSONB insert against a real "Strength Sets" WOD — both **succeeded** cleanly with zero errors, exercising RLS (`wod_logs_insert_own`), all seven `wod_logs` triggers, and `resolve_movement_id`/`snapshot_wod_log_movement_ids`/`evaluate_movement_prs`. This proves the database layer, RLS, and every trigger are fully functional for a normal, same-session score submission. The failure is exclusively in the client, gated by the specific `wodZiData === null && variantaAleasa !== null` condition (§9-10) — not by gender, RX/scaled classification, workout format, scoring type, gym, or member state. Sentry's own count (14 events, escalating, first appearing 2026-08-27) is consistent with a real but conditional failure, not a total outage — though this cannot rule out that the true user-facing scope is wider than what reached Sentry (e.g., users who saw the generic error toast and gave up without the exception detail changing anything observable to them would still show as "can't log a score" in their own report, even on a day when this specific crash didn't fire for them — a separate, unconfirmed possibility not ruled out by this investigation).

## 12. INC-02 Root Cause

**Client-side, pre-write, unhandled null-dereference.** `wodZiData.type` is accessed without a null guard at `App.jsx:8350`, inside a branch (`variantaAleasa !== null`) whose precondition (an official WOD variant is selected) does not actually guarantee `wodZiData` is populated — these two pieces of state (`variantaAleasa`, `wodZiData`) can desynchronize, most plausibly across a date-rollover in a long-lived client session (§9). This is **not** a database, RLS, trigger, or schema issue — every one of those layers was independently, successfully live-tested and found correct (§9 of the reproduction, §12-13 mission checks below).

## 13. INC-02 Production Impact

```text
Last known successful score log:     could not be determined precisely - direct DB inserts
                                      succeed right now (this investigation, 2026-08-28), and no
                                      evidence suggests EVERY attempt fails; "last successful"
                                      as a single timestamp is not a meaningful number for a
                                      conditional (not total) failure
First confirmed failing occurrence:  2026-08-27T14:54:43Z (Sentry SENTRY-CYAN-HARBOR-4T firstSeen)
Attempted-failure count observable:  14 (Sentry event count for this specific error signature,
                                      as of 2026-08-28T06:26:19Z, escalating)
Gyms affected:                       not distinguishable from the Sentry payload sampled (single
                                      real production gym exists platform-wide today, so this is
                                      moot in practice)
Workout types/scoring types affected: not format-specific - the crash occurs before any
                                      format/score-type-specific logic runs at all
```

## 14. INC-02 Data Integrity

**No score is corrupted, partially inserted, or invisible.** Because the crash occurs entirely client-side before any Supabase request is issued, there is no partial write, no rolled-back transaction, and no orphaned row to find — the affected save attempts simply **never reached the database**. This was verified by the successful, clean direct-DB reproduction (§9 of Reproduction) and is the expected behavior of a pre-network-call JS exception.

## 15. INC-02 Introducing Change

**NO — not introduced by any recent P0/security/timezone mission.** `git log -L 8349,8350:src/App.jsx` shows the vulnerable line was last modified 2026-07-13 (commit `9542d9d`, unrelated: "logarea liberă nu se mai leagă de WOD-ul oficial al zilei"), over a month before this session's P0 work began. The only two commits touching `App.jsx` in the entire recent P0 series (`abe4e3b`, `4a47929`, both P0-03) changed a combined 16 lines, exclusively in `fetchClasament`'s leaderboard-fallback query and `fetchRapoarte`'s monthly-stats query — neither of which is anywhere near `dataAcasa`, `wodZiData`, or the score-save handler. This is a pre-existing latent defect that began actually firing in production on 2026-08-27, for reasons unrelated to any code change made in this session.

## 16. INC-02 Minimal Fix Proposal (NO IMPLEMENTATION)

Client-side only, no DB/schema/RLS change indicated:
- Guard `wodHeaderLine`'s construction at `App.jsx:8349-8350` against `wodZiData` being `null` even when `variantaAleasa !== null` (e.g., fall back to the free-log header format, or bail out with a user-facing "please refresh, today's WOD changed" message instead of crashing).
- Separately (deeper, optional): investigate whether `dataAcasa`/`wodZiData` should be refreshed on visibility-change/day-rollover for long-lived sessions, to reduce how often this desync condition arises at all — this is a larger behavioral question the mission's own scope discipline suggests raising, not deciding, here.
- No score recovery is needed or possible — no data was written to recover (§14).

---

## 17. Relationship Between Incidents

## RELATED BUT DISTINCT

Both incidents trace back to failures that occur **before or outside the core write/read-authorization path** rather than in RLS, triggers, or stored data (both databases proved clean and correctly configured for their respective operations). In that broad sense they share a *category* of failure (client/session-layer, not data-layer). But they are **not the same root cause**: INC-01's best-confirmed mechanism is a JWT-expiry-triggered query failure on an unrelated Feed endpoint; INC-02's confirmed mechanism is an unguarded null-dereference in unrelated score-save code, present in the codebase for over a month before it started firing. Fixing one will not fix the other. No evidence ties the two together beyond this shared high-level failure category — a genuine finding, not an assumed correlation, per the mission's explicit instruction to prove rather than infer.

## 18. Why Tests Were Green

**INC-01**: no test in either repository's suite exercises the JWT-expiry/session-refresh path — every Supabase call in the test suites is mocked, so an expired-token PostgREST error (`PGRST303`) can never occur in a unit test; this class of failure only exists against a real, time-lived auth session, which no test fixture simulates.

**INC-02**: no test exercises the score-save handler's `wodZiData`/`variantaAleasa` desynchronization scenario specifically — existing tests for this area (if any) almost certainly construct `wodZiData` and `variantaAleasa` consistently (both present, or both absent), because that's the only combination a normal, synchronous test setup would produce. The actual failure requires a *temporal* desync (state that was valid when set, becoming stale relative to other state that has since changed) — exactly the class of bug unit tests with static fixtures structurally cannot catch, and which requires either an integration/E2E test simulating a day-rollover mid-session, or a simple unit test asserting the handler doesn't crash when called with `variantaAleasa !== null` and `wodZiData === null` (a much cheaper, still-valuable regression test, even without reproducing the full temporal scenario).

## 19. Required Regression Tests

```text
INC-01:
  - A unit/integration test asserting the Feed's member-name resolution degrades gracefully
    (retries or surfaces a clear error) rather than silently falling back to "Member" when the
    underlying query fails with PGRST303 (JWT expired) - requires a mockable Supabase client
    error injection, not currently exercised by any existing test.

INC-02:
  - A unit test calling the score-save handler's core logic with wodZiData = null and
    variantaAleasa !== null (or the smallest extractable equivalent), asserting it does NOT
    throw and instead falls back to safe behavior. This is the single highest-value regression
    test - it directly targets the confirmed crash line without needing to simulate a real
    day-rollover.
  - A broader test (if practical) simulating dataAcasa advancing across a day boundary mid-
    session, asserting wodZiData/variantaAleasa are reconciled (e.g., variant selection cleared)
    rather than left desynchronized.
```

## 20. Production Data Remediation

```text
INC-01 backfill required: NO - no stored data is wrong (§6)
INC-02 score recovery required: NO - no data was ever written for the failed attempts, so there
                                 is nothing to recover (§14)
```

No remediation was performed, proposed as urgent, or attempted during this investigation.

## 21. Recent P0 Regression Status

```text
P0-01:     NOT IMPLICATED - no code/trigger touched by P0-01 appears anywhere in either incident's
           evidence chain.
P0-02:     NOT IMPLICATED - weightKeyForVariant/resolveAthleteGenderKey re-checked (§ Phase 11 of
           this mission's own instructions): confirmed still null-safe, never throws, not present
           in the INC-02 crash's stack trace or breadcrumbs at all. Gender resolution was not
           reached before the crash (the crash occurs earlier, at wodHeaderLine construction).
P0-SEC-01: NOT IMPLICATED - member_domain_consistency_detail was not queried by either incident's
           code path.
P0-SEC-02: NOT IMPLICATED - subscriptions/wod_logs entitlement logic was not reached by either
           incident (INC-02's crash occurs before any DB call; INC-01 is a profiles/Feed read path).
P0-SEC-03: NOT IMPLICATED - wod_logs_with_context (a read-only view) is not used anywhere in the
           score-SAVE path (a write); INC-02's crash is confirmed client-side, before any query.
P0-03:     NOT IMPLICATED for INC-02's crash itself (git blame confirms the vulnerable line
           predates P0-03 by weeks, and P0-03's only App.jsx changes are unrelated lines).
           WORTH NOTING (not a regression, a scope observation): P0-03 established the correct
           pattern for deriving "today" without UTC skew, but never addressed whether a
           long-lived client session re-derives "today" as real time passes - the suspected
           INC-02 trigger condition (§12) is exactly this kind of temporal staleness, a distinct
           concern from what P0-03 was scoped to fix. This is disclosed as a related-but-out-of-
           P0-03's-original-scope observation, not a claim that P0-03 caused or should have
           caught this.
```

No broad security audit was performed, per this mission's explicit instruction — only the targeted regression checks above.

## 22. Recommended Execution Order

**Fix INC-02 first**, then INC-01, not atomically together. Rationale: INC-02 is a confirmed, escalating, currently-occurring crash blocking a core product action (logging a score) with high-confidence evidence and a precise, minimal, low-risk fix (§16) — it should not wait on INC-01's less-certain, lower-severity investigation. INC-01's confirmed mechanism (§4) is narrow, long-standing, and P2 — worth fixing, but does not carry the same urgency, and its Admin-surface variant genuinely needs more evidence (a specific reproducible case) before a safe fix can even be proposed, which naturally sequences it after INC-02.

## 23. Confidence

```text
INC-01 root cause: LOW-MEDIUM - one real, Sentry-confirmed contributing mechanism found (Feed/
                    JWT-expiry), but it does not fully explain the reported scope ("some
                    members" across possibly multiple surfaces), and no live data anomaly was
                    found to corroborate a broader cause.
INC-02 root cause: HIGH - a specific, unhandled, source-mapped exception was found via a live
                    Sentry event, at an exact file/line matching the current repository state,
                    consistent with the reported symptom (scores cannot be saved), independently
                    corroborated by successful direct-DB testing proving the failure occurs
                    before the database is ever reached.
```

---

Investigation only. No fix was implemented, no production data was modified, no migration was created, and no unrelated work was started, per this mission's explicit instruction. Stopping here and awaiting approval before any implementation.
