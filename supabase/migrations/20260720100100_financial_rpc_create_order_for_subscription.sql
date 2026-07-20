-- Financial Domain Phase 1, RPC 1/3: create_order_for_subscription()
-- Per the approved Phase 1 Design Review, Sections 2-13. Additive only -
-- Phase 0's schema, tables, constraints, triggers, and RLS are untouched.
--
-- client_id/gym_id are never accepted as parameters - both are resolved
-- server-side (gym_id via my_gym_id(), client_id via the same case-
-- insensitive member_email -> profiles.email lookup already used by
-- stergeAbonament and the subscriptions_select_own_or_admin RLS policy),
-- so a caller can never spoof tenant or identity (Design Review Section 7).
--
-- Idempotent by construction (Section 10, approved): a retry that hits
-- orders_subscription_id_unique returns the existing order's id instead of
-- erroring.

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
  if not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  if p_total_amount < 0 then
    raise exception 'total_amount must be >= 0';
  end if;

  select p.id into v_client_id
  from subscriptions s
  join profiles p on lower(p.email) = lower(s.member_email) and p.gym_id = s.gym_id
  where s.id = p_subscription_id
    and s.gym_id = v_gym_id;

  if v_client_id is null then
    raise exception 'subscription not found';
  end if;

  begin
    insert into orders (gym_id, client_id, subscription_id, total_amount, currency, created_by)
    values (v_gym_id, v_client_id, p_subscription_id, p_total_amount, p_currency, auth.uid())
    returning id into v_order_id;
  exception when unique_violation then
    select id into v_order_id
    from orders
    where subscription_id = p_subscription_id and gym_id = v_gym_id;
  end;

  return v_order_id;
end;
$$;

comment on function create_order_for_subscription(uuid, numeric, text) is 'Phase 1 RPC. Admin-only. Creates the Order for a subscription; idempotent retry returns the existing order (Design Review Section 10).';

revoke all on function create_order_for_subscription(uuid, numeric, text) from public, anon;
grant execute on function create_order_for_subscription(uuid, numeric, text) to authenticated;

-- Rollback:
-- drop function if exists create_order_for_subscription(uuid, numeric, text);
