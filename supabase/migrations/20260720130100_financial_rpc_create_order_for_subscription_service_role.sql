-- Phase 5a, migration 1/4: create_order_for_subscription() gains
-- service_role as a valid caller.
--
-- Found by tracing the actual call chain, not assumed: when the future
-- Stripe webhook calls activate_queued_subscription() as service_role,
-- that function's own internal, unconditional call to create_order_for_
-- subscription() runs under the SAME session context (SECURITY DEFINER
-- changes table-access privilege, not auth.jwt()/auth.uid() - both stay
-- whatever the outermost caller's session set). Without this change, that
-- nested call would fail its existing is_admin(...) or client_id =
-- auth.uid() check, since service_role has neither, breaking the whole
-- webhook flow even though the Order it's asking for already exists and
-- the call would otherwise hit the function's own idempotent-retry path.
--
-- v_gym_id resolution also changes for the service_role case: my_gym_id()
-- depends on auth.uid(), which is null under service_role, so gym_id is
-- resolved from the subscription itself instead - the same pattern used
-- in register_payment's own service_role extension.

create or replace function create_order_for_subscription(
  p_subscription_id uuid,
  p_total_amount numeric,
  p_currency text default 'RON'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service_role boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_gym_id uuid;
  v_client_id uuid;
  v_order_id uuid;
begin
  if v_is_service_role then
    select gym_id into v_gym_id from subscriptions where id = p_subscription_id;
  else
    v_gym_id := my_gym_id();
  end if;

  if v_gym_id is null then
    raise exception 'subscription not found';
  end if;

  select p.id into v_client_id
  from subscriptions s
  join profiles p on lower(p.email) = lower(s.member_email) and p.gym_id = s.gym_id
  where s.id = p_subscription_id
    and s.gym_id = v_gym_id;

  if not (is_admin(v_gym_id) or v_is_service_role or v_client_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if v_client_id is null then
    raise exception 'subscription not found';
  end if;

  begin
    insert into orders (gym_id, client_id, subscription_id, total_amount, currency, created_by)
    values (v_gym_id, v_client_id, p_subscription_id, p_total_amount, p_currency, auth.uid())
    returning id into v_order_id;
  exception when unique_violation then
    select id into v_order_id from orders where subscription_id = p_subscription_id and gym_id = v_gym_id;
  end;

  return v_order_id;
end;
$$;

-- Rollback: re-apply 20260720110900's CREATE OR REPLACE body.
