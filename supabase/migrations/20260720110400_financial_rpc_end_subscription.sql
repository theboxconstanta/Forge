-- Phase 1 Extension, RPC 4/4: end_subscription()
-- Per the approved Phase 1 Extension Design. Faithful translation of
-- stergeAbonament's active-branch deactivation (src/App.jsx) - sets
-- is_active = false. Admin-only. The accompanying bookings cleanup stays
-- exactly where it is today, in the frontend, called as a separate step -
-- it was never part of the Financial Domain and does not belong here.
--
-- No Orders/Payments interaction, by design: per the ADRs, ending
-- entitlement is not itself a financial event. A refund remains a
-- separate, explicit admin action via the existing, unmodified
-- refund_payment() RPC (Phase 1).

create or replace function end_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid := my_gym_id();
  v_exists boolean;
begin
  if not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  select exists(select 1 from subscriptions where id = p_subscription_id and gym_id = v_gym_id) into v_exists;
  if not v_exists then
    raise exception 'subscription not found';
  end if;

  update subscriptions set is_active = false where id = p_subscription_id and gym_id = v_gym_id;
end;
$$;

comment on function end_subscription(uuid) is 'Phase 1 Extension RPC. Admin-only. Deactivates an active subscription; no Orders/Payments interaction by design - refunds remain a separate, explicit action.';

revoke all on function end_subscription(uuid) from public, anon;
grant execute on function end_subscription(uuid) to authenticated;

-- Rollback:
-- drop function if exists end_subscription(uuid);
