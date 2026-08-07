-- P0 fix (FINANCIAL_P0_UNAUTHORIZED_MEMBERSHIP_ACTIVATION_REPORT.md).
--
-- Root cause of "scheduled subscriptions could not be deleted": every
-- self-service purchase attempt (Membership Catalog -> Stripe Checkout,
-- even one immediately abandoned) creates an Order row referencing the
-- queued subscription (create_subscription -> create_order_for_subscription,
-- unchanged, not touched here) via orders.subscription_id, a foreign key
-- with no ON DELETE clause (defaults to NO ACTION/RESTRICT). The previous
-- version of this function only ever issued `delete from subscriptions`,
-- which fails with a foreign-key-violation for essentially every
-- self-service-originated queued row - exactly the reported symptom.
-- (A second, separate bug compounded this: the client-side caller,
-- stergeAbonament in App.jsx, ignored this RPC's error entirely and
-- unconditionally showed a "deleted" success toast regardless of outcome -
-- fixed separately in App.jsx, not here.)
--
-- Fix: also delete the linked order in the same transaction, but ONLY when
-- it carries zero payment rows of any status - a queued (never-activated)
-- subscription's order should never have a real payment against it under
-- the new activate_queued_subscription payment guard (a payment can only
-- land on an order that is about to be marked 'paid', which immediately
-- precedes activation, not queuing), so this is expected to be the normal
-- case for every abandoned/legitimately-unpaid queued subscription. If a
-- payment row somehow exists anyway (a genuine data anomaly, not a normal
-- state), this function refuses to delete anything and raises a clear
-- error instead of silently destroying payment history - that case needs
-- a human to look at it, not an automatic cleanup.

CREATE OR REPLACE FUNCTION public.delete_queued_subscription(p_subscription_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid := my_gym_id();
  v_queued boolean;
  v_order_id uuid;
  v_has_payment boolean;
begin
  if not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  select queued into v_queued from subscriptions where id = p_subscription_id and gym_id = v_gym_id;
  if v_queued is null then
    raise exception 'subscription not found';
  end if;
  if v_queued is not true then
    raise exception 'subscription is not queued';
  end if;

  select o.id into v_order_id from orders o where o.subscription_id = p_subscription_id and o.gym_id = v_gym_id;

  if v_order_id is not null then
    select exists(select 1 from payments p where p.order_id = v_order_id) into v_has_payment;
    if v_has_payment then
      raise exception 'cannot delete a queued subscription whose order has a recorded payment';
    end if;
    delete from orders where id = v_order_id;
  end if;

  delete from subscriptions where id = p_subscription_id and gym_id = v_gym_id;
end;
$function$;
