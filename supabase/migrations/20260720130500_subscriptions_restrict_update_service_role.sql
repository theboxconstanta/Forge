-- Phase 5a, migration 5/5 (unplanned, discovered during mandated validation):
-- subscriptions_restrict_member_update() gains a service_role bypass.
--
-- This trigger predates the Financial Domain / Stripe work entirely (added
-- 2026-07-01/07-04, part of the unrelated waitlist auto-booking system). It
-- was not touched by any of the four RPC migrations above, but blocks them:
-- activate_queued_subscription's internal UPDATE on subscriptions runs under
-- this trigger regardless of SECURITY DEFINER (triggers are not bypassed by
-- function privilege escalation), and service_role has neither
-- is_coach_or_admin() (auth.uid() is null) nor an auth.jwt()->>'email' claim
-- (a real Supabase service-role key carries no per-request email), so the
-- trigger's existing bypass condition can never be true for it - a confirmed,
-- repeatable production blocker for the webhook activation path.
--
-- Fix is a single added OR clause, minimal on purpose:
-- - Existing waitlist auto-book restriction (sessions_used += 1 only, all
--   other columns frozen) is completely unchanged for every other caller.
-- - Existing member/self and coach/admin bypass conditions are unchanged.
-- - service_role is trusted here for the same reason it's trusted in the
--   four RPCs it calls into: it is never reachable from arbitrary user
--   input, only from the verified webhook context (Stripe signature
--   checked before any RPC call is made).

create or replace function subscriptions_restrict_member_update()
returns trigger
language plpgsql
as $function$
BEGIN
  IF is_coach_or_admin() OR lower(OLD.member_email) = lower(auth.jwt() ->> 'email')
     OR (auth.jwt() ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.sessions_used = OLD.sessions_used + 1) THEN
    RAISE EXCEPTION 'sessions_used may only be incremented by 1 via the waitlist auto-book path';
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.member_email IS DISTINCT FROM OLD.member_email
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.sessions_total IS DISTINCT FROM OLD.sessions_total
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.queued IS DISTINCT FROM OLD.queued
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'the waitlist auto-book path may only change sessions_used';
  END IF;
  RETURN NEW;
END;
$function$
;

-- Rollback: re-apply 20260704090000's CREATE OR REPLACE body (drop the
-- service_role OR clause).
