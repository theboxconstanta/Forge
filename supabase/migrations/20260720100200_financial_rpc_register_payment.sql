-- Financial Domain Phase 1, RPC 2/3: register_payment()
-- Per the approved Phase 1 Design Review, Sections 2-13. direction is
-- hardcoded to 'charge' - never a caller-supplied value - so this RPC can
-- never be used to insert a refund row (Section 2).
--
-- method='comp' => amount=0 enforced here as an RPC-level business rule
-- (Section 6), matching the ADR's own definition of a comp payment;
-- Phase 0's schema has no CHECK linking method to amount, so this is not a
-- duplicate of an existing constraint.
--
-- Takes a row lock on the order before inserting (Section 11): Phase 0's
-- recompute_order_status_trg (AFTER INSERT) has no lock of its own and was
-- only ever exercised by sequential test inserts, never a concurrent
-- writer - this RPC-layer lock is what makes two concurrent register_payment
-- calls against the same order serialize, so the trigger's sum() always
-- sees a fully-committed picture. This does not modify the Phase 0 trigger.

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
  v_gym_id uuid := my_gym_id();
  v_payment_id uuid;
begin
  if not is_admin(v_gym_id) then
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

  insert into payments (
    gym_id, order_id, amount, direction, status, method, provider, provider_reference, created_by
  )
  values (
    v_gym_id, p_order_id, p_amount, 'charge', p_status, p_method, p_provider, p_provider_reference, auth.uid()
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

comment on function register_payment(uuid, numeric, text, text, text, text) is 'Phase 1 RPC. Admin-only. Records a charge (or a zero-amount comp) against an existing order; always direction=charge. Not idempotent - accepted Phase 1 scope boundary (Design Review Section 10).';

revoke all on function register_payment(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function register_payment(uuid, numeric, text, text, text, text) to authenticated;

-- Rollback:
-- drop function if exists register_payment(uuid, numeric, text, text, text, text);
