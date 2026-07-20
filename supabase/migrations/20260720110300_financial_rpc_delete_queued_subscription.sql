-- Phase 1 Extension, RPC 3/4: delete_queued_subscription()
-- Per the approved Phase 1 Extension Design. Faithful translation of
-- stergeAbonament's queued-delete branch (src/App.jsx) - hard-delete a
-- queued subscription row. Admin-only, matching today's UI (this action
-- has no member-facing surface).
--
-- No Orders/Payments interaction, by design: create_subscription() never
-- creates an Order for the queued branch, so no FK conflict is possible
-- here and no cleanup is needed - this was the specific, concrete reason
-- Order-creation was deferred to activation in the first place.

create or replace function delete_queued_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid := my_gym_id();
  v_queued boolean;
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

  delete from subscriptions where id = p_subscription_id and gym_id = v_gym_id;
end;
$$;

comment on function delete_queued_subscription(uuid) is 'Phase 1 Extension RPC. Admin-only. Hard-deletes a queued subscription; no Orders/Payments interaction by design.';

revoke all on function delete_queued_subscription(uuid) from public, anon;
grant execute on function delete_queued_subscription(uuid) to authenticated;

-- Rollback:
-- drop function if exists delete_queued_subscription(uuid);
