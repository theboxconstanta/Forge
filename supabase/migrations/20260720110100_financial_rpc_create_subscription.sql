-- Phase 1 Extension, RPC 1/4: create_subscription()
-- Per the approved Phase 1 Extension Design. Faithful atomic translation of
-- saveAbonament's existing branch logic (src/App.jsx) - check for a
-- currently-valid active subscription; if found, insert queued; otherwise
-- deactivate existing actives and insert active - plus, only on the
-- immediate-active branch, atomically create the Order and register a
-- payment via the existing, unmodified create_order_for_subscription()/
-- register_payment() RPCs (Phase 1).
--
-- p_end_date is accepted as a parameter, computed by the frontend using its
-- existing, unchanged addMonthsClamped() (src/utils.js) - NOT recomputed
-- here. addMonthsClamped clamps day-of-month overflow down to the last
-- valid day of the target month (e.g. Jan 31 + 1 month -> Feb 28); Postgres
-- native `date + interval` arithmetic overflows forward instead (Jan 31 + 1
-- month -> Mar 3). Reimplementing this in SQL would silently change real
-- subscription expiry dates for edge-of-month cases - "do not change
-- Subscriptions semantics" is absolute, so the client's already-correct
-- computation is passed through unchanged rather than re-derived.
--
-- total_amount is never a client parameter - resolved here from
-- subscription_plans.price for p_plan_id, closing a trust gap a
-- client-supplied amount would leave open.
--
-- notes is always written as null - per the approved decision to not keep
-- legacy financial writes after cutover. fetchRapoarte (unmodified, out of
-- this phase's scope) will show $0 for activity created through this RPC
-- until a later phase migrates it to read payments - a known, accepted,
-- explicitly confirmed consequence, not an oversight.

create or replace function create_subscription(
  p_member_email text,
  p_plan_id uuid,
  p_start_date date,
  p_end_date date,
  p_amount_paid numeric default null,
  p_currency text default 'RON'
)
returns table(subscription_id uuid, is_active boolean, queued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid := my_gym_id();
  v_email text := lower(trim(p_member_email));
  v_plan record;
  v_today date := current_date;
  v_existing record;
  v_has_valid_active boolean;
  v_new_id uuid;
  v_result_active boolean;
  v_result_queued boolean;
  v_order_id uuid;
begin
  if not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  select * into v_plan from subscription_plans where id = p_plan_id and gym_id = v_gym_id;
  if v_plan.id is null then
    raise exception 'plan not found';
  end if;

  select id, sessions_used, sessions_total into v_existing
  from subscriptions
  where lower(member_email) = v_email and gym_id = v_gym_id and is_active = true and queued = false
    and start_date <= v_today and end_date >= v_today
  order by created_at desc limit 1;

  v_has_valid_active := v_existing.id is not null and (
    v_existing.sessions_total is null or
    greatest(0, v_existing.sessions_total - coalesce(v_existing.sessions_used, 0)) > 0
  );

  if v_has_valid_active then
    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      v_today, v_today, false, true, null
    ) returning id into v_new_id;
    v_result_active := false;
    v_result_queued := true;
  else
    update subscriptions set is_active = false
    where lower(member_email) = v_email and gym_id = v_gym_id and is_active = true;

    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      p_start_date, p_end_date, true, false, null
    ) returning id into v_new_id;
    v_result_active := true;
    v_result_queued := false;

    select create_order_for_subscription(v_new_id, coalesce(v_plan.price, 0), p_currency) into v_order_id;

    if p_amount_paid is not null and p_amount_paid > 0 then
      perform register_payment(v_order_id, p_amount_paid, 'succeeded', null, null, null);
    end if;
  end if;

  return query select v_new_id, v_result_active, v_result_queued;
end;
$$;

comment on function create_subscription(text, uuid, date, date, numeric, text) is 'Phase 1 Extension RPC. Admin-only. Atomically creates a subscription (mirroring saveAbonament exactly) and, if immediately active, its Order and Payment.';

revoke all on function create_subscription(text, uuid, date, date, numeric, text) from public, anon;
grant execute on function create_subscription(text, uuid, date, date, numeric, text) to authenticated;

-- Rollback:
-- drop function if exists create_subscription(text, uuid, date, date, numeric, text);
