-- Phase 1 Extension, RPC 2/4: activate_queued_subscription()
-- Per the approved Phase 1 Extension Design. Faithful atomic translation of
-- the logic currently duplicated between adminActiveazaAboQueued
-- (admin-triggered) and activateQueuedSubscription (member-triggered, via
-- fetchAbonamentMeu, src/App.jsx) - deactivate the member's other active
-- subscription(s), flip the target queued row to active with real dates
-- and sessions_used reset to 0, then create its Order and, if the row's
-- own pre-existing notes recorded a payment at queue-time, register it.
--
-- Authorization is the one genuinely new shape here: is_admin OR the
-- caller's own profile email matches the target subscription's
-- member_email, within the same gym - the same self-or-admin pattern
-- already live on subscriptions_select_own_or_admin (RLS), applied here to
-- one narrow write, not a new authorization paradigm. This is what makes
-- the member-triggered auto-activation path callable at all - the
-- unconditional admin-only gate on the three original Phase 1 RPCs is
-- exactly what made this workflow unsupportable before this extension.
--
-- p_end_date is accepted as a parameter for the same reason as in
-- create_subscription() - both existing callers compute it via
-- addMonthsClamped(), whose day-of-month clamping is not reimplemented
-- here. start_date uses current_date server-side (both callers always mean
-- "now"; unlike end-date math this isn't clamping-sensitive).
--
-- notes-parsing here is not backfill - it completes this one row's own
-- dual-write for the payment it already recorded at the moment it was
-- originally queued (create_subscription() deliberately does not create an
-- Order for the queued branch - see that migration - so this is the first
-- moment this row could ever receive one).

create or replace function activate_queued_subscription(
  p_subscription_id uuid,
  p_end_date date
)
returns table(subscription_id uuid, start_date date, end_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_gym_id uuid;
  v_is_owner boolean;
  v_start_date date := current_date;
  v_order_id uuid;
  v_match text[];
  v_notes_amount numeric;
begin
  select id, gym_id, member_email, notes, plan_id, is_active, queued
    into v_target
  from subscriptions
  where id = p_subscription_id;

  if v_target.id is null then
    raise exception 'subscription not found';
  end if;

  v_gym_id := v_target.gym_id;

  select exists(
    select 1 from profiles
    where id = auth.uid() and lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
  ) into v_is_owner;

  if not (is_admin(v_gym_id) or v_is_owner) then
    raise exception 'not authorized';
  end if;

  if v_target.queued is not true or v_target.is_active is true then
    raise exception 'subscription not found';
  end if;

  update subscriptions set is_active = false
  where lower(member_email) = lower(v_target.member_email) and gym_id = v_gym_id
    and is_active = true and id <> p_subscription_id;

  update subscriptions
  set is_active = true, queued = false, start_date = v_start_date, end_date = p_end_date, sessions_used = 0
  where id = p_subscription_id;

  select create_order_for_subscription(
    p_subscription_id,
    coalesce((select price from subscription_plans where id = v_target.plan_id), 0),
    'RON'
  ) into v_order_id;

  if v_target.notes is not null then
    v_match := regexp_match(v_target.notes, 'Plătit:\s*([\d.,]+)\s*RON');
    if v_match is not null then
      v_notes_amount := replace(v_match[1], ',', '.')::numeric;
    end if;
  end if;

  if v_notes_amount is not null and v_notes_amount > 0 then
    perform register_payment(v_order_id, v_notes_amount, 'succeeded', null, null, null);
  end if;

  return query select p_subscription_id, v_start_date, p_end_date;
end;
$$;

comment on function activate_queued_subscription(uuid, date) is 'Phase 1 Extension RPC. Admin OR the subscription''s own owner. Atomically activates a queued subscription, creates its Order, and registers any payment recorded in its pre-existing notes at queue-time.';

revoke all on function activate_queued_subscription(uuid, date) from public, anon;
grant execute on function activate_queued_subscription(uuid, date) to authenticated;

-- Rollback:
-- drop function if exists activate_queued_subscription(uuid, date);
