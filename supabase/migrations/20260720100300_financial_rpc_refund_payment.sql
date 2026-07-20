-- Financial Domain Phase 1, RPC 3/3: refund_payment()
-- Per the approved Phase 1 Design Review, Sections 2-13. direction is
-- hardcoded to 'refund'; order_id is resolved from the original payment,
-- never a caller-supplied parameter, so a caller cannot mismatch a refund
-- against the wrong order (Section 2).
--
-- The RPC's own checks (original payment exists, belongs to caller's gym,
-- is a charge) are a friendlier fast-fail; validate_payment_refund_trg
-- (Phase 0) remains the actual guarantee regardless of write path, per the
-- working session's Section 9 amendment. The FOR UPDATE lock here is
-- redundant with that trigger's own lock but kept for a consistent locking
-- posture with register_payment (Design Review Section 11).

create or replace function refund_payment(
  p_original_payment_id uuid,
  p_amount numeric,
  p_status text default 'succeeded'
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
    gym_id, order_id, amount, direction, status, original_payment_id, created_by
  )
  values (
    v_gym_id, v_order_id, p_amount, 'refund', p_status, p_original_payment_id, auth.uid()
  )
  returning id into v_refund_id;

  return v_refund_id;
end;
$$;

comment on function refund_payment(uuid, numeric, text) is 'Phase 1 RPC. Admin-only. Records a refund against an existing charge payment; validate_payment_refund_trg (Phase 0) is the actual balance/lineage guarantee. Not idempotent - accepted Phase 1 scope boundary (Design Review Section 10).';

revoke all on function refund_payment(uuid, numeric, text) from public, anon;
grant execute on function refund_payment(uuid, numeric, text) to authenticated;

-- Rollback:
-- drop function if exists refund_payment(uuid, numeric, text);
