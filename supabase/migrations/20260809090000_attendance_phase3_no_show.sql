-- Attendance Phase 3 (Forge Admin Web) - Coach Workflow & No-Show Policy.
--
-- Per this milestone's own frozen product policy: check-in records physical
-- attendance only and must never consume/refund a session; session
-- consumption/refund happens exclusively at booking-create and booking-
-- cancel time (adminAdaugaInClasa/adjustMemberSessions, App.jsx, and
-- cancel_class, 20260808100000) - both untouched by this migration.
--
-- Inspected first, per the mission's own instruction, before writing any
-- SQL: `bookings` already has everything this needs except one column.
-- `checked_in` (20260629080000) already models one of the three terminal
-- states this milestone needs to represent. "Cancelled" already has no
-- column at all, by design - a cancelled booking is a deleted row
-- (adminScoateDinClasa and the member's own toggleRezervare cancel path,
-- App.jsx, both DELETE from bookings), so there is nothing to add for that
-- state either. The only genuinely missing state is No-Show, so this
-- migration adds exactly one column for it - no new table, no new RPC, no
-- change to any session/subscription logic, matching this milestone's own
-- "Attendance remains a projection of the Booking Domain" instruction
-- literally.
--
-- RLS: no new policy needed. `bookings_admin_update`
-- (is_coach_or_admin(gym_id), 20260714130000) already covers UPDATE on the
-- whole row, and this is a same-row column addition, not a new access
-- pattern.
--
-- Triggers: no change needed. `bookings_enforce_capacity_trg` and
-- `bookings_enforce_sessions_trg` are both BEFORE INSERT only (confirmed by
-- reading both migrations directly) - neither fires on the UPDATE this
-- column's writes will use, so marking/unmarking a No-Show can never
-- accidentally re-run capacity or session-limit enforcement.
--
-- Realtime: no change needed. `bookings` already has REPLICA IDENTITY FULL
-- and is already in the `supabase_realtime` publication (20260629080400) -
-- every column, including this new one, is already part of every change
-- payload broadcast for this table.

alter table bookings add column if not exists no_show boolean not null default false;

-- A booking is never simultaneously checked in and marked no-show - the
-- application always writes both columns together for exactly this reason
-- (Forge Admin's setCheckedIn/setNoShow), but this constraint is the real,
-- server-side guarantee, not just a client-side convention.
alter table bookings drop constraint if exists bookings_checked_in_no_show_exclusive;
alter table bookings add constraint bookings_checked_in_no_show_exclusive
  check (not (checked_in and no_show));
