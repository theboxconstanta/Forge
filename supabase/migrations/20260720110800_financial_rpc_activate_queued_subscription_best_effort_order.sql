-- Phase 1 Extension, follow-up (approved decision): Order/Payment creation
-- inside activate_queued_subscription() becomes best-effort for the
-- member-owner (self-service) case, instead of making the entire
-- activation atomic with it.
--
-- Found during validation: create_order_for_subscription()/register_
-- payment() are unconditionally admin-only, by frozen Phase 1 design.
-- SECURITY DEFINER changes execution privilege, not which identity
-- is_admin() evaluates - it still checks the real caller. When a member
-- self-activates their own queued subscription, the nested calls always
-- raised 'not authorized', and because the whole function was one atomic
-- body, the ENTIRE activation rolled back - not just the Order/Payment
-- part - reproducing the exact missing-capability gap this extension was
-- built to close.
--
-- Approved resolution: do not widen the two frozen RPCs' authorization.
-- Instead, deterministically skip attempting Order/Payment creation when
-- the caller is not an admin (a plain `if v_is_admin then` check, not
-- exception-catching around the nested calls - avoids the risk of broadly
-- catching and masking an unrelated real error under the same generic
-- exception shape). The subscription itself still fully activates for a
-- self-service member exactly as before; that specific activation's
-- Order/Payment - and any money recorded in its legacy notes at
-- queue-time - is knowingly left uncreated. Disclosed as a residual gap in
-- the completion report, not silently absorbed.

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
  v_is_admin boolean;
  v_has_profile boolean;
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
  v_is_admin := is_admin(v_gym_id);

  select exists(
    select 1 from profiles
    where id = auth.uid() and lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
  ) into v_is_owner;

  if not (v_is_admin or v_is_owner) then
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

  if v_is_admin then
    select exists(
      select 1 from profiles where lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
    ) into v_has_profile;

    if v_has_profile then
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
    end if;
  end if;

  return query select p_subscription_id, v_start_date, p_end_date;
end;
$$;

-- Rollback: re-apply 20260720110600's CREATE OR REPLACE body.
