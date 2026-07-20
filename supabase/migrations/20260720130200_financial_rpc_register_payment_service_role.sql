-- Phase 5a, migration 2/4: register_payment() gains service_role as a
-- valid caller, plus idempotent-retry on (provider, provider_reference) -
-- completing the same pattern create_order_for_subscription has always
-- had, now load-bearing for the webhook's duplicate-delivery case rather
-- than optional. Same v_gym_id resolution fix as migration 1/4: my_gym_id()
-- returns null under service_role, so gym_id is resolved from the Order
-- itself in that case.
--
-- Only one UNIQUE constraint exists on payments today
-- (payments_provider_reference_unique) - the unique_violation catch below
-- assumes that remains true.

create or replace function register_payment(
  p_order_id uuid,
  p_amount numeric,
  p_status text default 'succeeded',
  p_method text default null,
  p_provider text default null,
  p_provider_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service_role boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_gym_id uuid;
  v_payment_id uuid;
begin
  if v_is_service_role then
    select gym_id into v_gym_id from orders where id = p_order_id;
  else
    v_gym_id := my_gym_id();
  end if;

  if v_gym_id is null then
    raise exception 'order not found';
  end if;

  if not (is_admin(v_gym_id) or v_is_service_role) then
    raise exception 'not authorized';
  end if;

  if p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  if p_method = 'comp' and p_amount <> 0 then
    raise exception 'comp payments must have amount = 0';
  end if;

  perform 1 from orders where id = p_order_id and gym_id = v_gym_id for update;
  if not found then
    raise exception 'order not found';
  end if;

  begin
    insert into payments (
      gym_id, order_id, amount, direction, status, method, provider, provider_reference, created_by
    )
    values (
      v_gym_id, p_order_id, p_amount, 'charge', p_status, p_method, p_provider, p_provider_reference, auth.uid()
    )
    returning id into v_payment_id;
  exception when unique_violation then
    select id into v_payment_id
    from payments
    where provider = p_provider and provider_reference = p_provider_reference;
  end;

  return v_payment_id;
end;
$$;

-- Rollback: re-apply 20260720120200's CREATE OR REPLACE body.
