-- P0-SEC-02 - Final Pre-Production Security Gate SEC-01 + SEC-02
--
-- SEC-01 (P0, live-exploitable, confirmed via disposable-row reproduction):
-- subscriptions_restrict_member_update()'s "own member" branch (caller's
-- JWT email matches the row's member_email) unconditionally RETURN NEW's
-- with zero column restriction - the exact opposite of what this trigger
-- exists to enforce. Since the companion RLS UPDATE policy
-- (subscriptions_update_own_or_waitlist_or_admin) already lets that same
-- caller reach the row, this meant any member could directly
-- UPDATE their own subscription's is_active/end_date/sessions_total/
-- plan_id/etc. via a plain client call, entirely bypassing
-- activate_queued_subscription's paid-order check (which remains correct
-- and untouched - the bug was that a client never had to call it at all).
--
-- Legitimate self-service writes that must keep working (traced across
-- both app repos + every SQL writer before this fix):
--   - src/App.jsx's adjustSessionsUsedAtomic: a member's own booking (+1)
--     and cancellation (-1) of a class adjusts their OWN sessions_used by
--     exactly 1, via a direct client update - this is real product
--     behavior, not a symptom of the bug, and must be preserved.
--   - The pre-existing "waitlist auto-book" path (an unrelated member's
--     browser promoting someone off the waitlist) already correctly
--     restricted itself to sessions_used += 1 only - widened below to
--     +/-1 so it can be unified with the member's own path instead of
--     kept as a second, separately-reasoned-about branch.
--   - activate_queued_subscription/create_subscription/end_subscription/
--     adjust_session_count/cancel_class (all SECURITY DEFINER, owned by
--     postgres, each with its own real authorization check already) all
--     perform internal UPDATE subscriptions statements that fire this
--     SAME trigger - since triggers execute in the calling statement's
--     role context, current_user is 'postgres' for the duration of any
--     of these functions' own writes, distinguishable from a direct
--     client call (which always executes as authenticated/anon/
--     service_role, never as the table owner). Used as the trust signal
--     so these already-vetted RPCs keep working without reopening direct
--     client access.
create or replace function public.subscriptions_restrict_member_update()
returns trigger
language plpgsql
as $function$
begin
  if is_coach_or_admin()
     or (auth.jwt() ->> 'role') = 'service_role'
     or current_user = 'postgres' then
    return new;
  end if;

  if new.sessions_used is distinct from old.sessions_used
     and abs(new.sessions_used - old.sessions_used) <> 1 then
    raise exception 'sessions_used may only change by 1 at a time';
  end if;

  if new.member_id is distinct from old.member_id
     or new.member_email is distinct from old.member_email
     or new.plan_id is distinct from old.plan_id
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.sessions_total is distinct from old.sessions_total
     or new.is_active is distinct from old.is_active
     or new.queued is distinct from old.queued
     or new.notes is distinct from old.notes then
    raise exception 'a non-privileged caller may only adjust sessions_used by 1 at a time';
  end if;

  return new;
end;
$function$;

-- SEC-02 (P1, currently non-functional due to an unrelated uuid=text type
-- mismatch, but SECURITY DEFINER with zero internal authorization check
-- and EXECUTE granted to anon/authenticated/PUBLIC - a runtime type error
-- must never be the only thing standing between an unauthorized caller and
-- a destructive, unauthenticated, cross-tenant delete-any-member's-
-- bookings primitive). Confirmed zero application callers in either repo
-- or any Edge Function, and zero other database objects depend on it
-- (pg_depend, checked live before this migration was written) - the
-- platform's real booking-cancellation path already goes through the
-- correctly-scoped bookings_delete_own_or_admin RLS policy directly.
-- Removed entirely rather than repaired, per Option A (dead code, no
-- legitimate use to preserve).
drop function if exists public.delete_member_future_bookings(text, text);
