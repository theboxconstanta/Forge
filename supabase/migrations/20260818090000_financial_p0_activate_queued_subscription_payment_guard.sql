-- P0 fix (FINANCIAL_P0_UNAUTHORIZED_MEMBERSHIP_ACTIVATION_REPORT.md).
--
-- Root cause: the previous version's "order must be paid" check was scoped
-- `if not v_is_admin` - it only ever applied to a self-service (member's
-- own) activation attempt. Any admin/coach caller (exactly what Forge's
-- own "Activate now" button in App.jsx uses) bypassed the check entirely,
-- regardless of whether the subscription's linked order (created the
-- moment a member chose a plan in the Membership Catalog, BEFORE Stripe
-- Checkout even runs - see create_subscription/create-checkout-session,
-- unchanged by this fix) had ever actually been paid. Live production
-- data confirmed this is not theoretical: 6 currently-active subscriptions
-- created after the Financial Domain went live (2026-07-20) have a linked
-- order still 'pending' with zero payment rows - see the report's
-- Production Impact section.
--
-- Fix: the paid-order check now applies to EVERY caller (self-service,
-- admin, service-role webhook alike) with no exemption, and runs BEFORE
-- the activation writes below - a failed check never touches subscription/
-- session state at all, not merely relying on rollback-on-exception.
--
-- create_order_for_subscription is idempotent (reuses the existing order
-- via its own unique_violation catch - unchanged, not touched here), so
-- this also closes a second, narrower hole the old code had for
-- self-service too: a queued subscription with NO order at all (e.g. one
-- an admin queued for a member who already had valid active coverage,
-- which create_subscription deliberately skips creating an order for)
-- used to sail through the old self-service check unexamined, because
-- `select o.status from orders where subscription_id=...` found nothing
-- and the old condition required v_order_status to be non-null before
-- raising. Ensuring the order always exists before evaluating its status
-- closes that gap too.
--
-- p_amount_paid (new, optional, admin-only - mirrors create_subscription's
-- own p_amount_paid/p_method convention) is the real, structured
-- replacement for a dead code path this function used to carry: a regex
-- match against `subscriptions.notes` for a "Plătit: X RON" string that
-- NOTHING in this codebase has ever written (confirmed via a repo-wide
-- grep before this fix) - so that branch never actually registered a
-- payment in production, meaning every prior admin "Activate now" click
-- left its order pending forever regardless of intent. An admin can now
-- pass a real collected amount (cash, card-in-person, etc.) at activation
-- time; it's registered via the same register_payment RPC every other
-- payment path in this domain already uses, which flips the order to
-- 'paid' (via the pre-existing recompute_order_status trigger) before the
-- guard below evaluates it. Self-service activation still cannot supply
-- an amount, mirroring create_subscription's own identical restriction.

-- CRITICAL: CREATE OR REPLACE FUNCTION does NOT replace a function whose
-- argument list differs - adding p_amount_paid here creates a second,
-- separate overload alongside the old 3-argument one, and PostgREST/
-- Supabase RPC resolves a call by matching the exact set of named
-- parameters supplied. Every existing call site (App.jsx's own
-- adminActiveazaAboQueued/activateQueuedSubscription, the stripe-webhook
-- Edge Function) sends exactly p_subscription_id/p_end_date/p_method - an
-- exact match for the OLD, still-vulnerable 3-arg signature - so without
-- this explicit DROP first, every one of those callers would keep hitting
-- the unpatched function and this entire fix would silently do nothing.
-- Caught live during this mission's own deployment by re-querying pg_proc
-- immediately after applying this migration and finding two overloads
-- still present - see the report's own Activation Vulnerability section.
DROP FUNCTION IF EXISTS public.activate_queued_subscription(uuid, date, text);

CREATE OR REPLACE FUNCTION public.activate_queued_subscription(
  p_subscription_id uuid,
  p_end_date date,
  p_method text DEFAULT NULL::text,
  p_amount_paid numeric DEFAULT NULL::numeric
)
 RETURNS TABLE(subscription_id uuid, start_date date, end_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target record;
  v_gym_id uuid;
  v_is_owner boolean;
  v_is_admin boolean;
  v_is_service_role boolean;
  v_has_profile boolean;
  v_start_date date := current_date;
  v_order_id uuid;
  v_order_status text;
  v_order_total numeric;
begin
  select id, gym_id, member_email, notes, plan_id, is_active, queued
    into v_target
  from subscriptions
  where id = p_subscription_id;

  if v_target.id is null then
    raise exception 'subscription not found';
  end if;

  v_gym_id := v_target.gym_id;
  v_is_admin := is_admin(v_gym_id);
  v_is_service_role := (auth.jwt() ->> 'role') = 'service_role';

  select exists(
    select 1 from profiles
    where id = auth.uid() and lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
  ) into v_is_owner;

  if not (v_is_admin or v_is_owner or v_is_service_role) then
    raise exception 'not authorized';
  end if;

  if v_target.queued is not true or v_target.is_active is true then
    raise exception 'subscription not found';
  end if;

  if not v_is_admin and p_amount_paid is not null and p_amount_paid <> 0 then
    raise exception 'self-service activation cannot include a payment amount';
  end if;

  select exists(
    select 1 from profiles where lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
  ) into v_has_profile;

  if v_has_profile then
    select create_order_for_subscription(
      p_subscription_id,
      coalesce((select price from subscription_plans where id = v_target.plan_id), 0),
      'RON'
    ) into v_order_id;

    if v_is_admin and p_amount_paid is not null and p_amount_paid > 0 then
      perform register_payment(v_order_id, p_amount_paid, 'succeeded', p_method, null, null);
    end if;

    select o.status, o.total_amount into v_order_status, v_order_total from orders o where o.id = v_order_id;
    -- A $0 order (a free/comp plan) has nothing to collect and is never
    -- marked 'paid' by recompute_order_status without an explicit
    -- zero-amount payment row - treat "nothing owed" as its own
    -- satisfied case rather than requiring a payment record for no money.
    if v_order_status is distinct from 'paid' and coalesce(v_order_total, 0) <> 0 then
      raise exception 'order not paid' using errcode = 'FRG02';
    end if;
  end if;

  update subscriptions set is_active = false
  where lower(member_email) = lower(v_target.member_email) and gym_id = v_gym_id
    and is_active = true and id <> p_subscription_id;

  update subscriptions
  set is_active = true, queued = false, start_date = v_start_date, end_date = p_end_date, sessions_used = 0
  where id = p_subscription_id;

  return query select p_subscription_id, v_start_date, p_end_date;
end;
$function$;
