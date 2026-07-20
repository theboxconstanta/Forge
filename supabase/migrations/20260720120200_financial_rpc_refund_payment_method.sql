-- Phase 4, migration 2/4: refund_payment() gains method/provider/
-- provider_reference, mirroring register_payment's existing shape exactly.
-- Records how a refund was actually returned (e.g. method='card',
-- provider='stripe' for a refund to the original card; method='cash' for
-- cash back). All three new params default null - fully backward
-- compatible, no existing caller behavior changes.
--
-- No duplicate validation added here - the new payments_method_check
-- constraint (migration 1/4) is the actual guarantee, matching this
-- project's established "DB constraint is the real guarantee, RPC-level
-- checks are only for friendlier UX" pattern; adding a second validation
-- layer for a 4-value vocabulary would be new complexity beyond
-- "complete the existing capability."

create or replace function refund_payment(
  p_original_payment_id uuid,
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
  v_gym_id uuid := my_gym_id();
  v_order_id uuid;
  v_direction text;
  v_refund_id uuid;
begin
  if not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  if p_amount <= 0 then
    raise exception 'refund amount must be > 0';
  end if;

  select order_id, direction into v_order_id, v_direction
  from payments
  where id = p_original_payment_id and gym_id = v_gym_id;

  if v_order_id is null then
    raise exception 'original payment not found';
  end if;

  if v_direction <> 'charge' then
    raise exception 'original payment must be a charge';
  end if;

  perform 1 from orders where id = v_order_id for update;

  insert into payments (
    gym_id, order_id, amount, direction, status, method, provider, provider_reference, original_payment_id, created_by
  )
  values (
    v_gym_id, v_order_id, p_amount, 'refund', p_status, p_method, p_provider, p_provider_reference, p_original_payment_id, auth.uid()
  )
  returning id into v_refund_id;

  return v_refund_id;
end;
$$;

-- Rollback: re-apply 20260720100300's CREATE OR REPLACE body (no method/provider params).
