-- Final engineering review (M13.X, pre-merge quality gate) of
-- notify_visibility_change() (20260724070100_visibility_change_broadcast.sql):
-- realtime.send() runs inside the same AFTER trigger as the profiles
-- UPDATE that removes a member from their gym. An AFTER trigger's
-- exception is not isolated from its statement - if realtime.send() ever
-- raised (Realtime subsystem outage, malformed topic, anything), the
-- entire Remove Member transaction would roll back with it. That would
-- make a core, business-critical action depend on the availability of a
-- best-effort invalidation signal that is explicitly documented (see the
-- architecture review) as non-authoritative and allowed to be missed.
-- Isolating the broadcast in its own sub-transaction (a plpgsql exception
-- block) so a failure there can only ever cost a missed live-refresh
-- (already an accepted, pre-existing limitation - clients still see
-- correct data on their next reload), never a failed member removal.
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
    begin
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
    exception when others then
      raise warning 'notify_visibility_change: broadcast failed for % (gym %): %', v_entity_type, OLD.gym_id, SQLERRM;
    end;
  end if;
  return new;
end;
$$;

comment on function notify_visibility_change() is
  'Generic invalidation-only Broadcast for visibility-removing transitions - carries no authoritative data. Broadcast failures are isolated and never block the underlying mutation. See M13.X architecture review (Broadcast, not Platform Events).';
