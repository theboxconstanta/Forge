-- Financial Domain Phase 0, migration 5/7: triggers.
-- Per the working session's Section 9 amendment ("Database-Level
-- Enforcement of Business Invariants") plus the existing
-- prevent_gym_id_change() convention already applied to every other tenant
-- table (20260714130000_multitenant_rls_rewrite.sql) - reused verbatim
-- here, not redefined.

-- 1. Tenant-isolation convention, reused as-is. See that migration's own
--    comment for why it exists: a row's own "self" RLS policy (e.g.
--    client_id = auth.uid()) does not by itself stop a client from moving
--    their own row into another gym's tenant via a crafted UPDATE payload.
create trigger prevent_gym_id_change_trg
  before update on orders
  for each row execute function prevent_gym_id_change();

create trigger prevent_gym_id_change_trg
  before update on payments
  for each row execute function prevent_gym_id_change();

-- 2. Refund validation (Findings 4 and 5; Section 9 amendment). This is the
--    actual guarantee - the register_payment/refund_payment RPCs (Phase 1)
--    will duplicate a lighter check as a fast-fail, but this trigger is
--    what makes the invariant hold regardless of write path, per the
--    amendment's own reasoning: "the RPC is the only way in, RLS blocks
--    everything else" is two mechanisms that must both stay correctly
--    configured forever; a trigger enforces the invariant regardless of
--    which mechanism let a write through.
create or replace function validate_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_direction text;
  v_original_order_id uuid;
  v_charged numeric;
  v_refunded numeric;
begin
  if new.direction <> 'refund' then
    return new;
  end if;

  if new.original_payment_id is null then
    raise exception 'refund payments must reference original_payment_id';
  end if;

  select direction, order_id into v_original_direction, v_original_order_id
  from payments
  where id = new.original_payment_id;

  if v_original_direction is distinct from 'charge' then
    raise exception 'a refund must reference a charge payment, not another refund or a missing payment';
  end if;

  if v_original_order_id is distinct from new.order_id then
    raise exception 'a refund must be recorded against the same order as the payment it refunds';
  end if;

  -- Lock the order row for the remainder of this transaction so two
  -- concurrent refund inserts against the same order serialize instead of
  -- both independently observing "not yet over-refunded" (Finding 5).
  perform 1 from orders where id = new.order_id for update;

  select coalesce(sum(amount), 0) into v_charged
  from payments
  where order_id = new.order_id and direction = 'charge' and status = 'succeeded';

  select coalesce(sum(amount), 0) into v_refunded
  from payments
  where order_id = new.order_id and direction = 'refund';

  if v_refunded + new.amount > v_charged then
    raise exception 'refund amount % would exceed the order''s remaining refundable balance (charged %, already refunded %)',
      new.amount, v_charged, v_refunded;
  end if;

  return new;
end;
$$;

create trigger validate_payment_refund_trg
  before insert on payments
  for each row execute function validate_payment_refund();

-- 3. Order status derivation (Section 9 amendment: "Order's status field is
--    recomputed by a trigger reacting to Payment inserts against its
--    Order, not written by the RPC/service layer - cannot drift from the
--    true sum of Payments regardless of write path"). Status vocabulary
--    matches migration 1/7's CHECK constraint - same ASSUMPTION flag.
--    'cancelled' is not set by this trigger - it applies only when a
--    payment is inserted; cancellation without any payment is a Phase 1
--    RPC concern, out of scope here.
create or replace function recompute_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged numeric;
  v_refunded numeric;
  v_total numeric;
  v_new_status text;
begin
  select coalesce(sum(amount), 0) into v_charged
  from payments
  where order_id = new.order_id and direction = 'charge' and status = 'succeeded';

  select coalesce(sum(amount), 0) into v_refunded
  from payments
  where order_id = new.order_id and direction = 'refund';

  select total_amount into v_total from orders where id = new.order_id;

  if v_refunded > 0 and v_refunded >= v_charged then
    v_new_status := 'refunded';
  elsif v_charged >= v_total then
    v_new_status := 'paid';
  elsif v_charged > 0 then
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update orders set status = v_new_status where id = new.order_id;

  return new;
end;
$$;

create trigger recompute_order_status_trg
  after insert on payments
  for each row execute function recompute_order_status();

-- Rollback:
-- drop trigger if exists recompute_order_status_trg on payments;
-- drop function if exists recompute_order_status();
-- drop trigger if exists validate_payment_refund_trg on payments;
-- drop function if exists validate_payment_refund();
-- drop trigger if exists prevent_gym_id_change_trg on payments;
-- drop trigger if exists prevent_gym_id_change_trg on orders;
-- (prevent_gym_id_change() itself is shared with other tables - do not drop the function)
