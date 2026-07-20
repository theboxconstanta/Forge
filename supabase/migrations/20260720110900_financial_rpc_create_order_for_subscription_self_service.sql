-- Approved authorization change to one of the three original, frozen
-- Phase 1 RPCs. Not a schema change, not an architecture change - the only
-- prior instance of this RPC's contract being touched since Phase 1 closed.
--
-- Context: activate_queued_subscription() (Phase 1 Extension) must be
-- callable by a member self-activating their own queued subscription -
-- that authorization shape is already approved and live. But its nested
-- call to create_order_for_subscription() was still unconditionally
-- admin-only, so a self-service activation produced a subscription with NO
-- Order at all - violating the architecture's own invariant that every
-- Subscription must have an Order (Section 4 of the working session doc),
-- not merely "should have a Payment" (which the same doc explicitly
-- tolerates being absent - "a subscription pending payment").
--
-- Two ways to close this were considered: widen create_order_for_
-- subscription (this migration), or widen register_payment. Rejected
-- widening register_payment: its amount is always caller-attested money
-- movement, so self-service access would let a member declare their own
-- subscription paid in any amount without an admin ever seeing real money
-- - a fraud vector, not a narrow risk. create_order_for_subscription's
-- amount is always server-derived from subscription_plans.price, never
-- caller-supplied - widening it only lets a member trigger a bookkeeping
-- record for their own subscription's already-fixed price, no money
-- attestation involved. register_payment's contract is NOT touched by
-- this migration and remains admin-only, per explicit decision.
--
-- Authorization changes from is_admin(gym_id) only, to
-- is_admin(gym_id) OR the caller being the subscription's own owner
-- (auth.uid() resolves to the same profile the subscription's client_id
-- would resolve to) - the identical self-or-admin shape already approved
-- and live on activate_queued_subscription(), not a new pattern.

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
  v_gym_id uuid := my_gym_id();
  v_client_id uuid;
  v_order_id uuid;
begin
  select p.id into v_client_id
  from subscriptions s
  join profiles p on lower(p.email) = lower(s.member_email) and p.gym_id = s.gym_id
  where s.id = p_subscription_id
    and s.gym_id = v_gym_id;

  if not (is_admin(v_gym_id) or v_client_id = auth.uid()) then
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

-- Rollback: re-apply 20260720100100's CREATE OR REPLACE body (admin-only).
