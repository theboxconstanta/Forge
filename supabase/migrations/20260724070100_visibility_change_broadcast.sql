-- Forge Platform Architecture Decision (M13.X): visibility-removing events
-- cannot reach postgres_changes, since Supabase Realtime evaluates every
-- subscriber's RLS policy against the row AFTER the change - a row whose
-- gym_id transitions to null fails the departing gym's own policy, so the
-- event is never emitted to anyone. Confirmed against Supabase's own
-- documented authorization model, reproduced independently three times
-- with a raw client bypassing all application code - not a Forge RLS,
-- publication, or application bug.
--
-- Approved fix (architecture review, M13.X, two rounds): a minimal,
-- gym-scoped, private Broadcast channel used ONLY as an invalidation
-- signal - it carries no authoritative data, and clients must always
-- re-fetch through their existing RLS-protected queries. No event
-- ledger, no new synchronization paradigm - every existing
-- postgres_changes flow (subscriptions, classes, bookings, wods, etc.)
-- is completely untouched by this migration.

-- Generic, reusable trigger function - mirrors the existing
-- prevent_gym_id_change()/prevent_profiles_gym_id_change() convention of
-- one shared function driven by trigger arguments rather than one
-- function per table. Only Remove Member uses it today; a future
-- visibility-removing operation (Transfer Member, Remove Coach, Remove
-- Admin - none of which exist as implemented features) would attach this
-- same function to its own table/column with its own arguments, with no
-- new function code required.
create or replace function notify_visibility_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_type text := TG_ARGV[0];
  v_event text := TG_ARGV[1];
begin
  if OLD.gym_id is not null then
    perform realtime.send(
      jsonb_build_object(
        'event', v_event,
        'entityType', v_entity_type,
        'gymId', OLD.gym_id
      ),
      v_event,
      'gym:' || OLD.gym_id::text || ':visibility',
      true
    );
  end if;
  return new;
end;
$$;

comment on function notify_visibility_change() is
  'Generic invalidation-only Broadcast for visibility-removing transitions - carries no authoritative data. See M13.X architecture review (Broadcast, not Platform Events).';

-- Remove Member: profiles.gym_id -> null is the only visibility-removing
-- transition that exists in Forge today. Fires only on that exact
-- transition - every other profiles UPDATE (name/email edits, rejoining
-- a gym, etc.) is unaffected and continues to rely on the existing
-- profiles postgres_changes subscription, which already works correctly
-- for those cases.
drop trigger if exists notify_member_removed_visibility on profiles;
create trigger notify_member_removed_visibility
after update of gym_id on profiles
for each row
when (old.gym_id is distinct from new.gym_id and new.gym_id is null)
execute function notify_visibility_change('profile', 'member.removed');

-- Realtime Authorization: only a gym's own members/admins may receive
-- broadcasts on that gym's visibility topic - preserves tenant isolation
-- for the new channel exactly as source-table RLS already does for
-- postgres_changes. profiles_select_all and every other existing RLS
-- policy is completely untouched by this migration.
create policy "gym members receive their own visibility broadcasts"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.topic() = 'gym:' || my_gym_id()::text || ':visibility'
);
