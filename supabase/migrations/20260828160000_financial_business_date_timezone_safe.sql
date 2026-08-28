-- FINANCIAL BUSINESS-DATE TIMEZONE SAFETY — approved implementation of ADR
-- FORGE_ADR_FINANCIAL_TIMEZONE_POLICY.md findings F-01, F-02, F-03.
--
-- Owner decision: F-01 APPROVED, F-02 APPROVED, F-03 APPROVED, F-04 DEFERRED.
--
-- The DB session timezone in production is UTC. The single real gym is in
-- Romania (Europe/Bucharest, EET UTC+2 / EEST UTC+3). `current_date` therefore
-- returns the previous calendar day, relative to the gym, for ~2h (winter) /
-- ~3h (summer) after gym-local midnight. Three Financial RPCs used
-- `current_date` where a GYM-LOCAL business calendar date is meant:
--
--   F-01  activate_queued_subscription : v_start_date := current_date,
--         persisted to subscriptions.start_date (semantic type E — a
--         subscription effective date).
--   F-02  create_subscription : v_today := current_date, used for the
--         "is this member already covered today?" check that routes a new
--         subscription to queued vs active, and as the queued placeholder
--         start_date/end_date.
--   F-03  set_gym_paid_until : current_date in the gyms.is_active
--         auto-reactivation CASE (gym-local platform-billing calendar day).
--
-- FIX: each `current_date` used for a gym business-date decision becomes
--   (now() AT TIME ZONE 'Europe/Bucharest')::date
-- — identical pattern and single-gym-Romania constant already approved for
-- enforce_class_deletion_policy (20260828120000), dashboard_resolve_window
-- (20260828130000), and m9_publish_waiver (20260828140000). now() is an
-- absolute instant; AT TIME ZONE 'Europe/Bucharest' pins the wall-clock (IANA
-- zone → correct EET/EEST for the instant's date, no hardcoded offset); ::date
-- yields the gym-local calendar date. Result type is `date` (unchanged), so
-- no downstream cast/comparison/return changes.
--
-- SCOPE — this migration changes ONLY the business-date derivation in these
-- three functions. NOT changed anywhere: money amounts / price / paid amount /
-- order totals / payment records; subscription duration or end_date formulas;
-- session allocation; queued/active/cancel/renew semantics beyond the approved
-- "use the gym-local today" correction; authorization checks; the FRG02
-- order-paid guard; locking; return shapes; SECURITY DEFINER / search_path /
-- owner / GRANTs. F-04 (payment/revenue/accounting day attribution) is NOT
-- touched — it remains DEFERRED pending a separate accounting/business
-- decision. No gyms.timezone column is introduced. No historical data is
-- remediated (investigation found NO EVIDENCE of any affected historical row:
-- 0 of 229 subscriptions created in a divergence window; 0 gyms with
-- paid_until set).

-- ─────────────────────────────────────────────────────────────────────────────
-- F-01 — activate_queued_subscription
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_queued_subscription(p_subscription_id uuid, p_end_date date, p_method text DEFAULT NULL::text, p_amount_paid numeric DEFAULT NULL::numeric)
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
  -- F-01: the activation date is the gym's local calendar day, not the DB
  -- session (UTC) date. Europe/Bucharest = current single-gym Romania
  -- deployment constant (see migration header / ADR); NOT a generic
  -- multi-timezone guarantee.
  v_start_date date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- F-02 — create_subscription
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_subscription(p_member_email text, p_plan_id uuid, p_start_date date, p_end_date date, p_amount_paid numeric DEFAULT NULL::numeric, p_currency text DEFAULT 'RON'::text, p_method text DEFAULT NULL::text)
 RETURNS TABLE(subscription_id uuid, is_active boolean, queued boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid := my_gym_id();
  v_email text := lower(trim(p_member_email));
  v_plan record;
  -- F-02: "is this member already covered today?" means covered on the gym's
  -- local calendar date, not the DB session (UTC) date. Also the queued
  -- placeholder start/end (overwritten on activation). Europe/Bucharest =
  -- current single-gym Romania deployment constant (see header / ADR).
  v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_existing record;
  v_has_valid_active boolean;
  v_new_id uuid;
  v_result_active boolean;
  v_result_queued boolean;
  v_order_id uuid;
  v_is_admin boolean;
  v_is_self boolean;
begin
  v_is_admin := is_admin(v_gym_id);

  select exists(
    select 1 from profiles where id = auth.uid() and lower(email) = v_email and gym_id = v_gym_id
  ) into v_is_self;

  if not (v_is_admin or v_is_self) then
    raise exception 'not authorized';
  end if;

  if not v_is_admin and p_amount_paid is not null and p_amount_paid <> 0 then
    raise exception 'self-service subscription creation cannot include a payment amount';
  end if;

  -- subscription_plans.is_active calificat explicit - RETURNS TABLE(...,
  -- is_active boolean, ...) mai jos aduce is_active in scope ca variabila de
  -- iesire, la fel ca subscriptions.is_active/queued calificate deja putin
  -- mai jos in aceeasi functie, pentru exact acelasi motiv.
  select * into v_plan from subscription_plans where id = p_plan_id and gym_id = v_gym_id and subscription_plans.is_active = true;
  if v_plan.id is null then
    raise exception 'plan not found';
  end if;

  select id, sessions_used, sessions_total into v_existing
  from subscriptions
  where lower(member_email) = v_email and gym_id = v_gym_id
    and subscriptions.is_active = true and subscriptions.queued = false
    and start_date <= v_today and end_date >= v_today
  order by created_at desc limit 1;

  v_has_valid_active := v_existing.id is not null and (
    v_existing.sessions_total is null or
    greatest(0, v_existing.sessions_total - coalesce(v_existing.sessions_used, 0)) > 0
  );

  if v_has_valid_active or not v_is_admin then
    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      v_today, v_today, false, true, null
    ) returning id into v_new_id;
    v_result_active := false;
    v_result_queued := true;

    if not v_is_admin then
      select create_order_for_subscription(v_new_id, coalesce(v_plan.price, 0), p_currency) into v_order_id;
    end if;
  else
    update subscriptions set is_active = false
    where lower(member_email) = v_email and gym_id = v_gym_id and subscriptions.is_active = true;

    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      p_start_date, p_end_date, true, false, null
    ) returning id into v_new_id;
    v_result_active := true;
    v_result_queued := false;

    if exists(select 1 from profiles where lower(email) = v_email and gym_id = v_gym_id) then
      select create_order_for_subscription(v_new_id, coalesce(v_plan.price, 0), p_currency) into v_order_id;

      if p_amount_paid is not null and p_amount_paid > 0 then
        perform register_payment(v_order_id, p_amount_paid, 'succeeded', p_method, null, null);
      end if;
    end if;
  end if;

  return query select v_new_id, v_result_active, v_result_queued;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F-03 — set_gym_paid_until
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_gym_paid_until(p_gym_id uuid, p_paid_until date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- F-03: the auto-reactivation "is the coverage expired / is the new date in
  -- the future" comparison is a gym-local calendar-day decision, not a DB
  -- session (UTC) one. Europe/Bucharest = current single-gym Romania
  -- deployment constant (see header / ADR). p_paid_until itself is the
  -- platform admin's explicit input and is unchanged.
  v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  -- Reactiveaza automat DOAR daca sala era inactiva probabil din cauza
  -- neplatii (paid_until vechi null sau depasit) si noua data e in viitor -
  -- nu suprascrie o dezactivare manuala deliberata (ex. abuz) pe o sala care
  -- inca avea timp neexpirat, doar pentru ca cineva a re-salvat aceeasi
  -- data din obisnuinta. Bug real gasit la auto-revizuire (07-14), niciodata
  -- observat live - fix inainte de prima utilizare reala.
  update gyms set
    paid_until = p_paid_until,
    is_active = case
      when is_active = false and (paid_until is null or paid_until < v_today) and p_paid_until >= v_today
        then true
      else is_active
    end
  where id = p_gym_id;
end;
$function$;
