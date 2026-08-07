-- P0 fix (FINANCIAL_P0_UNAUTHORIZED_MEMBERSHIP_ACTIVATION_REPORT.md) -
-- Cleanup strategy: an abandoned/never-completed Stripe Checkout must not
-- leave its queued subscription + pending order sitting in Admin forever.
-- Manual deletion (delete_queued_subscription, fixed alongside this
-- migration) now works and is the guaranteed, deterministic remediation
-- path regardless of anything below. This function is the *automatic*
-- half: service-role only (never callable by a member, admin, or coach
-- JWT), deletes a queued subscription + its order together using the
-- exact same safety rule delete_queued_subscription itself now enforces -
-- only when the order carries zero payment rows of any status - and only
-- once the order has sat 'pending' longer than p_older_than_hours (default
-- 24, matching create-checkout-session's own DEFAULT_PENDING_ORDER_EXPIRY_HOURS,
-- the same window already used there to decide whether a pending order is
-- still reusable for a retried checkout attempt vs. considered stale).
--
-- Reliability disclosure (see the report's own Cleanup Strategy section):
-- this is designed to be invoked periodically from check-subscriptions
-- (the existing scheduled Edge Function, extended alongside this
-- migration), which already has its own open, separate incident (P0-005 -
-- the scheduler's own secret-key header is currently rejected by the
-- Supabase gateway for reasons not yet root-caused, so this Edge Function
-- has not actually been firing on its cron in production). Wiring cleanup
-- into it is still the architecturally correct place - once P0-005 is
-- independently resolved, this cleanup starts running automatically with
-- no further change - but its automatic execution is NOT guaranteed today.
-- The manual delete path is what to rely on until that separate incident
-- is closed.

CREATE OR REPLACE FUNCTION public.cleanup_abandoned_queued_subscriptions(p_older_than_hours numeric DEFAULT 24)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_service_role boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_cutoff timestamptz := now() - (p_older_than_hours * interval '1 hour');
  v_deleted_count integer := 0;
  r record;
begin
  if not v_is_service_role then
    raise exception 'not authorized';
  end if;

  for r in
    select s.id as sub_id, o.id as order_id
    from subscriptions s
    join orders o on o.subscription_id = s.id
    where s.queued = true
      and s.is_active = false
      and o.status = 'pending'
      and o.created_at < v_cutoff
      and not exists (select 1 from payments p where p.order_id = o.id)
  loop
    delete from orders where id = r.order_id;
    delete from subscriptions where id = r.sub_id;
    v_deleted_count := v_deleted_count + 1;
  end loop;

  return v_deleted_count;
end;
$function$;
