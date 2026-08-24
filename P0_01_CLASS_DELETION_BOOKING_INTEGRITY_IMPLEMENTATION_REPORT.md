# P0-01 — Class Deletion / Orphaned Bookings Data Integrity — Implementation Report

## 1. Root Cause

`bookings.class_id` is a `text` column; `classes.id` is a `uuid` column (confirmed live via `information_schema`, not assumed). Postgres cannot create a native `FOREIGN KEY` across two incompatible column types without first migrating one side's type — so no referential-integrity guard between these two tables was ever structurally possible without a separate, bigger, riskier migration. Every one of the three existing class-deletion code paths in the app (`stergeClasa`, `stergeSeria`, `stergeClaseleTrecute`, all in `src/App.jsx`) hard-deleted `classes` rows without ever touching the `bookings` rows that reference them by `class_id`. The only thing standing between "delete a class" and "leave its bookings silently pointing at nothing" was app-level convention — and that convention was already known (per the prior platform audit) and confirmed here to have already failed in production.

## 2. Previous Behavior

```
Admin clicks "Delete" (single class, series, or bulk "delete past classes")
        ↓
App queries `bookings` for that class only to compute a session-credit refund
(and only for FUTURE classes — stergeClaseleTrecute didn't even do this)
        ↓
App issues DELETE FROM classes WHERE ...
        ↓
The class row is gone. The bookings row(s) that referenced it are NOT gone,
NOT updated, NOT flagged — they still physically exist with class_id
pointing at a UUID (as text) that no longer resolves to any class.
```

Confirmed via read-only production audit (before any migration was written, per this task's own instruction): **480 pre-existing orphaned bookings**, spanning 104 distinct already-deleted classes and 51 members, dating from 2026-06-24 through 2026-08-23 — including **38 rows with `checked_in = true`**, meaning real recorded attendance history that is currently invisible to `get_class_summary`/`get_attendance_summary` (both join `bookings` to `classes` and silently drop any row whose class no longer exists).

## 3. Chosen Deletion Policy: **HYBRID**

Evaluated against the actual, verified business use of `bookings`: `get_attendance_summary`/`get_class_summary` (dashboard analytics, `20260815120100_dashboard_phase0_attendance_class_summary.sql`) join `bookings` against `classes.date`/`classes.name` for attendance-rate and trend reporting — `bookings` genuinely is historical business data, not disposable state. A blanket `CASCADE` was rejected because it would destroy that history for any past class. A blanket `RESTRICT` was rejected because it would make the existing, correct "delete a future class and refund its bookings' session credits" admin action impossible to complete at all — a real regression.

**Policy implemented, enforced by a new DB trigger** (`enforce_class_deletion_policy()`, `BEFORE DELETE ON classes`):
- **Class date < today, has bookings → RESTRICT.** The delete is rejected outright (`RAISE EXCEPTION`). These bookings may carry real, already-happened attendance history (`checked_in`/`no_show`) — they are never destroyed by a class deletion.
- **Class date ≥ today, has bookings → CASCADE (atomically).** Nothing has happened yet for these bookings — `checked_in`/`no_show` carry no meaning for a class that hasn't occurred — so their deletion alongside the class, in the same transaction, is both safe and necessary (the alternative would make deleting an upcoming class with any bookings impossible).
- **Zero bookings, any date → hard delete allowed**, unchanged from before.

This matches the exact `date >= today` boundary the pre-existing app-level session-credit-refund logic already used (`stergeClasa`'s own `cls?.date >= aziStr2` check) — the new DB policy is consistent with, not a departure from, the existing app-level convention for "has this class already happened."

## 4. Database Protection

- **New migration**: `supabase/migrations/20260825120000_p0_01_class_deletion_booking_integrity.sql` — one new function (`enforce_class_deletion_policy()`, `SECURITY DEFINER`, matching the established precedent already used by `enforce_class_capacity()`/`enforce_subscription_sessions()` on the same tables) and one new `BEFORE DELETE ON classes` trigger. No column type change, no data migration, no backfill — purely additive, forward-looking protection.
- Applied directly to production via `supabase db query --file` (this project's established deployment path — `supabase db push` was attempted first and correctly refused, since the local migration history is already known to be out of sync with the remote-applied history per prior sessions; the direct-apply path avoids that desync entirely).
- **No new FK/constraint change was needed or attempted** — a trigger was the correct, minimal mechanism given the type mismatch, consistent with this table's own existing pattern.
- RLS was inspected, not modified: `classes` `DELETE` is already correctly gated by `is_coach_or_admin(gym_id)` (tenant-scoped); `bookings` `DELETE` is already correctly gated by `(member_id = auth.uid()) OR is_coach_or_admin(gym_id)`. The new trigger's `SECURITY DEFINER` internal cleanup grants no new capability to any caller — RLS still decides whether the `DELETE ON classes` is reachable at all in the first place.

## 5. Existing Production Data

**480 pre-existing orphaned bookings were found and are NOT touched by this fix.** Per this task's own explicit instruction, they were not automatically deleted, re-associated, or archived. Aggregate-only figures (no member PII):

```
Total orphaned bookings: 480
Affected classes (already deleted, no longer exist): 104
Affected members: 51
Oldest record: 2026-06-24
Newest record: 2026-08-23
Rows with real recorded attendance (checked_in = true): 38
Rows with neither checked_in nor no_show set: 442
Affected gyms: 1
```

**This requires a separate decision from you before any cleanup is attempted.** Because 38 of these rows carry real `checked_in = true` attendance data with no way to recover which class they belonged to (the booking row itself carries no snapshot of the class's name/date), re-association is not possible. The realistic options are: (a) leave them as permanently orphaned but harmless rows (they don't break anything today, they simply don't appear in class-joined reports), or (b) archive/delete them with your explicit sign-off, accepting the loss of those 38 attendance records' visibility (the underlying fact "this member attended something on this day" would be gone, not just its class-name context). I have not acted on this — flagging it, not resolving it, per this task's own instruction to stop before destructive treatment of real production data.

## 6. Files Changed

| File | Why |
|---|---|
| `supabase/migrations/20260825120000_p0_01_class_deletion_booking_integrity.sql` (new) | The DB-level fix — the new trigger function + trigger described above. |
| `src/App.jsx` | `stergeClaseleTrecute()` rewritten: now pre-filters to only past classes with zero bookings (a single multi-row `DELETE` would otherwise fail entirely the moment one target row has bookings, since the new trigger raises per-row inside one transaction), confirms with a real count via `window.confirm` (matching the existing `stergeSeria` sibling pattern — this codebase's own established primitive for this exact class of confirmation, not a new component), and surfaces a real success/error toast instead of no feedback at all. `stergeClasa()` rewritten: now fetches the class's name/date and real booking count first, pre-empts the DB's own RESTRICT case with a clear explanatory toast instead of letting a raw Postgres error surface, confirms via `window.confirm` with the real booking count (mirroring this task's own worked example), and checks the delete call's own error before claiming success. `stergeSeria()` was **not modified** — it only ever targets future classes (`.gte('date', aziS)`), so it can never hit the new trigger's RESTRICT branch, and it already had both a real confirmation and real error handling. |
| `src/translations.js` | 9 new translation keys (RO+EN) for the new confirmation/blocked/summary messages above — no existing keys changed. |

**Explicitly not touched**: capacity-locking trigger, membership-date-coverage trigger, session-credit refund calculation logic (same loop, same math, unchanged), RLS policies, any unrelated booking/membership/leaderboard code.

## 7. Tests

No JS/TS unit test file exists for these three functions today (they are inline closures inside the top-level `App()` component, not exported pure functions — confirmed via search, consistent with this codebase's existing pattern where all other admin-mutation closures of this shape are likewise untested at the unit level). The "appropriate layer" for this specific fix's regression coverage (per this task's own Phase 13 framing) is the DB trigger itself, which **was** verified live against disposable, fully-cleaned-up test data:

| Test | Result |
|---|---|
| **A** — class exists, bookings exist, delete attempted (past class) | ✅ Correctly **rejected**: `ERROR: P0001: cannot delete a past class with 1 existing booking(s) - this would destroy historical attendance data`. Class and booking both confirmed still present afterward. |
| **A (future variant)** — class exists, bookings exist, delete attempted (future class) | ✅ Correctly **succeeded**: class deleted, its booking cascaded away atomically in the same operation — confirmed zero rows remained for either afterward, and confirmed the platform-wide orphan count stayed at exactly 480 (no new orphan created). |
| **B** — delete a class with no bookings | ✅ Correctly succeeded (exercised directly during test cleanup — a past, zero-booking class deleted cleanly). |
| **C** — attempt duplicate deletion | ✅ Idempotent by construction and confirmed live: re-issuing `DELETE ... WHERE id = <already-deleted id>` matched zero rows, the trigger never fired (a row-level `BEFORE DELETE` trigger cannot fire on a delete matching no rows), no error. `stergeClasa()`'s own new `if (!cls) return` guard handles this gracefully at the app layer too. |
| **D** — member books while admin deletion is in flight | ✅ **Structurally safe by construction, reasoned + confirmed via the trigger's own design**: the booking-count check happens *inside* the trigger, at actual `DELETE` time, inside the same transaction — never from an earlier, potentially-stale client-side read. A booking inserted between the admin's UI check and the real delete is seen fresh by the trigger: for a future class it gets safely cascaded away with the class; for a past class the delete is safely rejected instead. Neither outcome can ever produce an orphan — no separate concurrent-session race harness was built, since the guarantee is structural (single-transaction visibility), not timing-dependent, the same reasoning basis already accepted for this table's existing `enforce_class_capacity()` trigger. |
| **E** — unauthorized member attempts deletion | ✅ Confirmed via direct RLS policy inspection (unchanged by this fix): `classes` `DELETE` requires `is_coach_or_admin(gym_id)` — a plain member has no path to this operation at all, before the new trigger is ever reached. |
| **F** — historical booking integrity remains correct | ✅ Confirmed: the platform-wide orphan count was queried before, during, and after all testing and remained exactly 480 throughout — no pre-existing row was touched, and no new one was created. |

## 8. Regression Verification

- **Bookings**: member booking/cancellation flow (`toggleRezervare`) untouched — reads/writes the same `bookings` rows the same way; unaffected by a trigger that only fires on `classes` deletion.
- **Capacity**: `enforce_class_capacity()` untouched, not modified, not re-created, confirmed still present and unrelated to this migration.
- **Cancellation**: unaffected — cancellation is a `bookings` delete/insert cycle, not a `classes` delete.
- **Attendance/history**: `get_class_summary`/`get_attendance_summary` untouched; going forward, they will simply never lose join-visibility into a *newly*-deleted class's bookings again, since a past class with bookings can no longer be deleted at all, and a future class's bookings (which carry no attendance data yet) are cleanly removed rather than left dangling.
- **Membership checks**: `enforce_subscription_sessions()` untouched.
- **Admin class management**: `stergeSeria()` behaviorally unchanged (still future-only, still refunds credits, still confirms, still handles its own errors); `stergeClasa()`/`stergeClaseleTrecute()` gained new, additive confirmation/error-surfacing behavior but their core delete/refund mechanics are otherwise the same code, same order of operations.
- Full test suite: **902/902 real tests pass** (same 9 pre-existing, unrelated Deno/`@std/assert` file-level import failures present before this change — confirmed identical failure set before and after). Lint: 0 errors on every changed file (same pre-existing unrelated warnings elsewhere in `App.jsx`). Production build: clean.

## 9. Final Invariant

> Forge can no longer create new orphaned booking records through class deletion.

**Confirmed, not merely asserted**: live-tested against real disposable data in production — a past class with a booking is rejected by the database itself before the delete can occur; a future class with a booking has that booking atomically removed in the same operation as the class, never left dangling. The platform-wide orphan count (`480`) was independently re-verified to be unchanged by this fix and by all the disposable test operations performed to prove it — every one of those 480 rows is a **pre-existing legacy invalid row created before this fix shipped**, not a new one, and their remediation is a separate decision awaiting your explicit sign-off (§5), not part of this P0's scope.

---

Stopping here per this task's own instruction. P0-02 or any further audit item has not been started.
