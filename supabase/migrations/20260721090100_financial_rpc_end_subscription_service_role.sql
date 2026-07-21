-- P0-006: end_subscription() gains a service_role path, mirroring the exact
-- pattern already established for create_order_for_subscription/
-- register_payment/create_subscription/activate_queued_subscription
-- (Phase 5a, 2026-07-20). Needed for "Remove Member": that Edge Function runs
-- on service_role and must end a removed member's active subscription
-- through the sanctioned Subscription Domain write path, not a raw table
-- update - explicitly required by product decision rather than assumed.
--
-- Same v_gym_id resolution as every other Phase 5a extension: my_gym_id()
-- depends on auth.uid(), which is null under service_role, so gym_id is
-- resolved from the subscription row itself instead.

create or replace function end_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service_role boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_gym_id uuid;
  v_exists boolean;
begin
  if v_is_service_role then
    select gym_id into v_gym_id from subscriptions where id = p_subscription_id;
  else
    v_gym_id := my_gym_id();
  end if;

  if v_gym_id is null then
    raise exception 'subscription not found';
  end if;

  if not (is_admin(v_gym_id) or v_is_service_role) then
    raise exception 'not authorized';
  end if;

  select exists(select 1 from subscriptions where id = p_subscription_id and gym_id = v_gym_id) into v_exists;
  if not v_exists then
    raise exception 'subscription not found';
  end if;

  update subscriptions set is_active = false where id = p_subscription_id and gym_id = v_gym_id;
end;
$$;

-- Rollback: re-apply the pre-P0-006 CREATE OR REPLACE body (my_gym_id()-only
-- resolution, is_admin(v_gym_id) alone).
