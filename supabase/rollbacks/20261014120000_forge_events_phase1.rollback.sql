-- ROLLBACK for 20261014120000_forge_events_phase1.sql.
-- NOT a migration (this folder is never read by the Supabase CLI). Run only
-- with explicit owner approval, as a single file, inside one transaction.
--
-- Removes ONLY objects created by that migration. No pre-existing table,
-- row, policy or function is touched (the migration altered none).
--
-- Data-loss guard: if any Events data exists (events, registrations,
-- acknowledgments, attempts, history), the rollback ABORTS unless the
-- operator first sets, for the session (this file opens its own
-- transaction):
--   select set_config('forge.events_rollback_confirm', 'destroy-event-data', false);
-- Preferred alternative when data exists: switch the feature off instead
-- (delete / set to 'false' the gym's app_settings 'events_enabled' row).

begin;

do $$
declare
  v_rows bigint;
begin
  select (select count(*) from public.events)
       + (select count(*) from public.event_registrations)
       + (select count(*) from public.event_announcement_acks)
       + (select count(*) from public.event_attempts)
       + (select count(*) from public.event_attempt_history)
    into v_rows;
  if v_rows > 0 and coalesce(current_setting('forge.events_rollback_confirm', true), '') <> 'destroy-event-data' then
    raise exception 'forge events rollback aborted: % Events row(s) exist - confirm explicitly or disable the feature flag instead', v_rows;
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'event-covers') then
    raise exception 'forge events rollback aborted: event-covers bucket still contains objects - remove them through the Storage API first';
  end if;
end;
$$;

-- Storage
drop policy if exists event_covers_select_staff on storage.objects;
drop policy if exists event_covers_insert_staff on storage.objects;
drop policy if exists event_covers_update_staff on storage.objects;
drop policy if exists event_covers_delete_staff on storage.objects;
-- Live storage.buckets has a statement-level protect_delete trigger that
-- rejects direct DELETEs unless storage.allow_delete_query = 'true'
-- (production catalog, read-only preflight 2026-10-14). Enabled for THIS
-- transaction only (is_local = true), and only reached after the guard above
-- proved the bucket holds no objects.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'event-covers';
select set_config('storage.allow_delete_query', 'false', true);

-- Realtime publication
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_attempts') then
    alter publication supabase_realtime drop table public.event_attempts;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_registrations') then
    alter publication supabase_realtime drop table public.event_registrations;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime drop table public.events;
  end if;
end;
$$;

-- RPCs (exact signatures - never a broad drop)
drop function if exists public.event_delete_attempt(uuid);
drop function if exists public.event_update_attempt(uuid, jsonb);
drop function if exists public.event_submit_attempt(uuid, uuid, jsonb);
drop function if exists public.forge_events_own_open_attempt(uuid);
drop function if exists public.forge_events_clean_score(jsonb);
drop function if exists public.my_pending_event_announcements();
drop function if exists public.event_ack_announcement(uuid, int, text);
drop function if exists public.event_registration_counts(uuid[]);
drop function if exists public.event_leave(uuid);
drop function if exists public.event_join(uuid, text);
drop function if exists public.event_archive(uuid);
drop function if exists public.event_cancel(uuid);
drop function if exists public.event_publish(uuid);
drop function if exists public.forge_events_staff_event(uuid);
drop function if exists public.forge_events_member_event(uuid, boolean);

-- Tables (their triggers and policies go with them), children first
drop table if exists public.event_attempt_history;
drop table if exists public.event_attempts;
drop table if exists public.event_announcement_acks;
drop table if exists public.event_registrations;
drop table if exists public.events;

-- Trigger / helper functions created by the migration
drop function if exists public.event_attempt_history_immutable();
drop function if exists public.event_attempts_record_history();
drop function if exists public.events_edit_guard();
drop function if exists public.forge_events_touch_updated_at();
drop function if exists public.forge_events_enabled(uuid);

commit;
