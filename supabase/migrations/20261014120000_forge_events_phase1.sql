-- FORGE EVENTS - Phase 1: schema, security and lifecycle (DATABASE ONLY).
--
-- Additive only: creates new objects, never alters or rewrites an existing
-- table, row, policy or function. Applied ONLY as a single file after
-- explicit owner approval (never `supabase db push` - the remote migration
-- ledger is known to drift). Rollback: supabase/rollbacks/
-- 20261014120000_forge_events_phase1.rollback.sql.
--
-- Owner-approved rules this migration enforces in the database itself:
--   * Access = gym affiliation only: gym_id = my_gym_id(). There is NO
--     subscription / membership-status condition anywhere - members with an
--     expired subscription keep full Events access by design.
--   * Feature flag: member-facing access additionally requires the gym's
--     existing app_settings row (gym_id, key 'events_enabled', value 'true').
--     No row = OFF. Staff (is_coach_or_admin) can prepare events while OFF.
--     app_settings writes are already admin-only (live RLS).
--   * Registrations and attempts never touch classes, bookings,
--     subscriptions, orders or payments - no function here references them.
--   * Multiple attempts per member: every attempt is kept; edits and deletes
--     are recorded in an append-only history; delete is soft. The 20-attempt
--     cap counts EVERY attempt ever created (soft-deleted included). A retry
--     with the same client_attempt_id returns the original attempt and never
--     consumes another one.
--   * Once any attempt exists, the workout/scoring configuration is frozen
--     and the dates cannot move so that an existing attempt would fall
--     outside the event window.
--   * Best attempt / ranking is NOT computed here: the client ranks with
--     FORGE's existing sortSectionLogs (workoutFormats.js), unchanged.

-- ============================================================
-- 0. Helpers
-- ============================================================
create or replace function public.forge_events_enabled(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from app_settings
    where gym_id = p_gym_id and key = 'events_enabled' and value = 'true'
  );
$$;

create or replace function public.forge_events_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- 1. Tables
-- ============================================================
create table public.events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id),
  event_type text not null check (char_length(btrim(event_type)) between 1 and 40),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 5000),
  location text check (location is null or char_length(location) <= 200),
  cover_path text check (cover_path is null or (char_length(cover_path) <= 300 and cover_path like gym_id::text || '/%')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'archived')),
  published_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  announcement_revision int not null default 0 check (announcement_revision >= 0),
  registration_enabled boolean not null default true,
  capacity int check (capacity is null or capacity > 0),
  registration_deadline timestamptz,
  participants_visible boolean not null default true,
  has_workout boolean not null default false,
  workout_format text check (workout_format is null or char_length(workout_format) between 1 and 60),
  workout_format_config jsonb check (workout_format_config is null or jsonb_typeof(workout_format_config) = 'object'),
  workout_description text check (workout_description is null or char_length(workout_description) <= 5000),
  workout_standards text check (workout_standards is null or char_length(workout_standards) <= 5000),
  scoring_enabled boolean not null default false,
  leaderboard_visible boolean not null default true,
  divisions text[] not null default '{rx,beginner}',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_id_gym_unique unique (id, gym_id),
  constraint events_dates_check check (ends_at is null or ends_at > starts_at),
  constraint events_deadline_check check (registration_deadline is null or registration_deadline <= coalesce(ends_at, starts_at)),
  constraint events_divisions_check check (
    divisions <@ array['rx', 'intermediate', 'beginner', 'onramp']
    and cardinality(divisions) between 1 and 4
    and array_position(divisions, null) is null
  ),
  constraint events_scoring_requires_workout check (
    not scoring_enabled or (has_workout and workout_format is not null and ends_at is not null)
  ),
  -- v1 scoring scope (owner-approved D10): only formats whose input,
  -- composition and ranking already go through FORGE's pure, tested helpers.
  -- SETS / STAGES / MIXED / Composer need a separate, approved change.
  constraint events_scoring_v1_formats check (
    not scoring_enabled or workout_format in (
      'AMRAP', 'Ascending AMRAP', 'For Time', 'RFT', 'Chipper', 'Ladder', 'Partner WOD', 'Once', 'Max Effort'
    )
  ),
  constraint events_lifecycle_timestamps check (
    (status = 'draft' and published_at is null and announcement_revision = 0)
    or (status <> 'draft' and published_at is not null and announcement_revision >= 1)
  )
);
create index events_gym_status_starts_idx on public.events (gym_id, status, starts_at);

create table public.event_registrations (
  event_id uuid not null,
  gym_id uuid not null,
  member_id uuid not null references auth.users(id) on delete cascade,
  division text not null check (division in ('rx', 'intermediate', 'beginner', 'onramp')),
  status text not null check (status in ('registered', 'withdrawn')),
  registered_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id),
  constraint event_registrations_event_gym_fkey foreign key (event_id, gym_id)
    references public.events (id, gym_id) on delete restrict
);
create index event_registrations_event_status_idx on public.event_registrations (event_id, status);
create index event_registrations_member_idx on public.event_registrations (member_id);

create table public.event_announcement_acks (
  event_id uuid not null,
  gym_id uuid not null,
  member_id uuid not null references auth.users(id) on delete cascade,
  revision int not null check (revision >= 1),
  action text not null check (action in ('dismissed', 'joined')),
  acknowledged_at timestamptz not null default now(),
  primary key (event_id, member_id),
  constraint event_announcement_acks_event_gym_fkey foreign key (event_id, gym_id)
    references public.events (id, gym_id) on delete restrict
);
create index event_announcement_acks_member_idx on public.event_announcement_acks (member_id);

create table public.event_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  gym_id uuid not null,
  member_id uuid not null references auth.users(id) on delete cascade,
  client_attempt_id uuid not null,
  division text not null check (division in ('rx', 'intermediate', 'beginner', 'onramp')),
  -- Score fields: same names and meaning as wod_logs, so FORGE's existing
  -- composition (composeWodLogFields helpers) and ranking (sortSectionLogs)
  -- apply unchanged.
  result text check (result is null or char_length(result) <= 500),
  time_result text check (time_result is null or char_length(time_result) <= 20),
  sets jsonb check (sets is null or jsonb_typeof(sets) = 'object'),
  log_meta jsonb check (log_meta is null or jsonb_typeof(log_meta) = 'object'),
  completion_state text check (completion_state is null or completion_state in ('completed', 'capped')),
  weight_logged text check (weight_logged is null or char_length(weight_logged) <= 20),
  weight_unit text check (weight_unit is null or weight_unit in ('kg', 'lb')),
  notes text check (notes is null or char_length(notes) <= 1000),
  -- Frozen server-side from the event at submit time (P10 invariant: a
  -- result is always interpreted against the format it was submitted under).
  format_snapshot text not null,
  format_config_snapshot jsonb,
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint event_attempts_idempotency_unique unique (event_id, member_id, client_attempt_id),
  constraint event_attempts_event_gym_fkey foreign key (event_id, gym_id)
    references public.events (id, gym_id) on delete restrict,
  constraint event_attempts_has_score check (result is not null or time_result is not null or sets is not null or log_meta is not null)
);
create index event_attempts_event_division_live_idx on public.event_attempts (event_id, division) where deleted_at is null;
create index event_attempts_member_event_idx on public.event_attempts (member_id, event_id);

create table public.event_attempt_history (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.event_attempts(id) on delete cascade,
  event_id uuid not null,
  gym_id uuid not null,
  member_id uuid not null,
  op text not null check (op in ('update', 'delete')),
  old jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index event_attempt_history_attempt_idx on public.event_attempt_history (attempt_id);
create index event_attempt_history_event_idx on public.event_attempt_history (event_id);

-- ============================================================
-- 2. Triggers
-- ============================================================
create trigger events_prevent_gym_id_change_trg before update on public.events
  for each row execute function prevent_gym_id_change();
create trigger event_registrations_prevent_gym_id_change_trg before update on public.event_registrations
  for each row execute function prevent_gym_id_change();
create trigger event_announcement_acks_prevent_gym_id_change_trg before update on public.event_announcement_acks
  for each row execute function prevent_gym_id_change();
create trigger event_attempts_prevent_gym_id_change_trg before update on public.event_attempts
  for each row execute function prevent_gym_id_change();

create trigger events_touch_updated_at_trg before update on public.events
  for each row execute function forge_events_touch_updated_at();
create trigger event_registrations_touch_updated_at_trg before update on public.event_registrations
  for each row execute function forge_events_touch_updated_at();
create trigger event_attempts_touch_updated_at_trg before update on public.event_attempts
  for each row execute function forge_events_touch_updated_at();

-- Edit rules for events (owner requirement 5 + Phase 1 safeguard 3).
-- Status / lifecycle columns are not even grantable to clients (section 4);
-- this guard covers the content edits staff ARE allowed to make.
create or replace function public.events_edit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts int;
  v_first timestamptz;
  v_last timestamptz;
  v_registered int;
begin
  -- An archived event is read-only: no content column may change.
  if old.status = 'archived'
     and (new.title, new.description, new.location, new.cover_path, new.starts_at, new.ends_at,
          new.registration_enabled, new.capacity, new.registration_deadline, new.participants_visible,
          new.has_workout, new.workout_format, new.workout_format_config, new.workout_description,
          new.workout_standards, new.scoring_enabled, new.leaderboard_visible, new.divisions, new.event_type)
         is distinct from
         (old.title, old.description, old.location, old.cover_path, old.starts_at, old.ends_at,
          old.registration_enabled, old.capacity, old.registration_deadline, old.participants_visible,
          old.has_workout, old.workout_format, old.workout_format_config, old.workout_description,
          old.workout_standards, old.scoring_enabled, old.leaderboard_visible, old.divisions, old.event_type) then
    raise exception using errcode = 'P0001', message = 'event_archived_read_only';
  end if;

  -- Every attempt ever created counts here, soft-deleted ones included.
  select count(*), min(created_at), max(created_at)
    into v_attempts, v_first, v_last
  from event_attempts where event_id = old.id;

  if v_attempts > 0 then
    if (new.has_workout, new.workout_format, new.workout_format_config, new.scoring_enabled)
       is distinct from (old.has_workout, old.workout_format, old.workout_format_config, old.scoring_enabled) then
      raise exception using errcode = 'P0001', message = 'scoring_locked';
    end if;
    if new.starts_at > v_first or (new.ends_at is not null and new.ends_at < v_last) then
      raise exception using errcode = 'P0001', message = 'dates_would_invalidate_attempts';
    end if;
  end if;

  if exists (
    select 1 from event_registrations r
    where r.event_id = old.id and not (r.division = any (new.divisions))
  ) or exists (
    select 1 from event_attempts a
    where a.event_id = old.id and not (a.division = any (new.divisions))
  ) then
    raise exception using errcode = 'P0001', message = 'division_in_use';
  end if;

  if new.capacity is not null and new.capacity is distinct from old.capacity then
    select count(*) into v_registered from event_registrations r
    where r.event_id = old.id and r.status = 'registered';
    if new.capacity < v_registered then
      raise exception using errcode = 'P0001', message = 'capacity_below_registrations';
    end if;
  end if;

  return new;
end;
$$;
create trigger events_edit_guard_trg before update on public.events
  for each row execute function events_edit_guard();

-- Append-only attempt history.
create or replace function public.event_attempts_record_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if row(new.*) is not distinct from row(old.*) then
    return new;
  end if;
  insert into event_attempt_history (attempt_id, event_id, gym_id, member_id, op, old, changed_by)
  values (old.id, old.event_id, old.gym_id, old.member_id,
          case when old.deleted_at is null and new.deleted_at is not null then 'delete' else 'update' end,
          to_jsonb(old), auth.uid());
  return new;
end;
$$;
create trigger event_attempts_record_history_trg after update on public.event_attempts
  for each row execute function event_attempts_record_history();

-- History rows are immutable (even for the owner role used by RPCs).
create or replace function public.event_attempt_history_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'P0001', message = 'history_immutable';
end;
$$;
create trigger event_attempt_history_no_update_trg before update on public.event_attempt_history
  for each row execute function event_attempt_history_immutable();

-- ============================================================
-- 3. Row Level Security
-- ============================================================
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_announcement_acks enable row level security;
alter table public.event_attempts enable row level security;
alter table public.event_attempt_history enable row level security;

create policy events_select on public.events for select to authenticated
  using (
    is_coach_or_admin(gym_id)
    or (gym_id = my_gym_id() and status <> 'draft' and forge_events_enabled(gym_id))
  );
create policy events_insert_staff on public.events for insert to authenticated
  with check (is_coach_or_admin(gym_id) and status = 'draft');
create policy events_update_staff on public.events for update to authenticated
  using (is_coach_or_admin(gym_id))
  with check (is_coach_or_admin(gym_id));
create policy events_delete_draft_staff on public.events for delete to authenticated
  using (is_coach_or_admin(gym_id) and status = 'draft');

create policy event_registrations_select on public.event_registrations for select to authenticated
  using (
    is_coach_or_admin(gym_id)
    or (
      gym_id = my_gym_id() and forge_events_enabled(gym_id) and (
        member_id = auth.uid()
        or (status = 'registered' and exists (
          select 1 from events e where e.id = event_id and e.participants_visible and e.status <> 'draft'))
      )
    )
  );

create policy event_announcement_acks_select_own on public.event_announcement_acks for select to authenticated
  using (member_id = auth.uid());

create policy event_attempts_select on public.event_attempts for select to authenticated
  using (
    is_coach_or_admin(gym_id)
    or (
      gym_id = my_gym_id() and forge_events_enabled(gym_id) and (
        member_id = auth.uid()
        or (deleted_at is null and exists (
          select 1 from events e where e.id = event_id and e.leaderboard_visible and e.status <> 'draft'))
      )
    )
  );

create policy event_attempt_history_select on public.event_attempt_history for select to authenticated
  using (member_id = auth.uid() or is_coach_or_admin(gym_id));

-- ============================================================
-- 4. Grants (Supabase default privileges grant ALL to anon/authenticated
--    on new tables - revoke first, then grant only what is needed).
-- ============================================================
revoke all on public.events, public.event_registrations, public.event_announcement_acks,
  public.event_attempts, public.event_attempt_history from anon, authenticated, public;

grant select on public.events, public.event_registrations, public.event_announcement_acks,
  public.event_attempts, public.event_attempt_history to authenticated;

-- Staff content columns only. status / published_at / cancelled_at /
-- archived_at / announcement_revision / created_by / created_at are changed
-- exclusively by the lifecycle RPCs below.
grant insert (gym_id, event_type, title, description, location, cover_path, starts_at, ends_at,
  registration_enabled, capacity, registration_deadline, participants_visible, has_workout,
  workout_format, workout_format_config, workout_description, workout_standards, scoring_enabled,
  leaderboard_visible, divisions) on public.events to authenticated;
grant update (event_type, title, description, location, cover_path, starts_at, ends_at,
  registration_enabled, capacity, registration_deadline, participants_visible, has_workout,
  workout_format, workout_format_config, workout_description, workout_standards, scoring_enabled,
  leaderboard_visible, divisions) on public.events to authenticated;
grant delete on public.events to authenticated;

-- ============================================================
-- 5. RPCs (all SECURITY DEFINER + fixed search_path; explicit checks).
--    Every function pins `public, pg_temp`: pg_temp LAST, otherwise a
--    session's temp table would shadow public.* inside a definer function
--    (reproduced on real Postgres in Phase 1B).
-- ============================================================

-- Shared: load an event the caller may act on as a MEMBER (gym + flag).
-- Unknown / other-gym / flag-off / draft events are all "not found" so
-- nothing leaks.
create or replace function public.forge_events_member_event(p_event_id uuid, p_lock boolean)
returns public.events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  if p_lock then
    select * into v_event from events where id = p_event_id for update;
  else
    select * into v_event from events where id = p_event_id;
  end if;
  if not found or v_event.gym_id is distinct from my_gym_id()
     or not forge_events_enabled(v_event.gym_id) or v_event.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'event_not_found';
  end if;
  return v_event;
end;
$$;

create or replace function public.forge_events_staff_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
begin
  select * into v_event from events where id = p_event_id for update;
  if not found or not is_coach_or_admin(v_event.gym_id) then
    raise exception using errcode = 'P0001', message = 'event_not_found';
  end if;
  return v_event;
end;
$$;

-- ---------- Lifecycle (staff) ----------
create or replace function public.event_publish(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
begin
  v_event := forge_events_staff_event(p_event_id);
  if v_event.status not in ('draft', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;
  if coalesce(v_event.ends_at, v_event.starts_at) <= now() then
    raise exception using errcode = 'P0001', message = 'event_already_ended';
  end if;
  update events set
    status = 'published',
    published_at = now(),
    cancelled_at = null,
    announcement_revision = announcement_revision + 1
  where id = p_event_id
  returning * into v_event;
  return jsonb_build_object('id', v_event.id, 'status', v_event.status, 'announcement_revision', v_event.announcement_revision);
end;
$$;

create or replace function public.event_cancel(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
begin
  v_event := forge_events_staff_event(p_event_id);
  if v_event.status <> 'published' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;
  update events set status = 'cancelled', cancelled_at = now() where id = p_event_id returning * into v_event;
  return jsonb_build_object('id', v_event.id, 'status', v_event.status);
end;
$$;

create or replace function public.event_archive(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
begin
  v_event := forge_events_staff_event(p_event_id);
  if not (v_event.status = 'cancelled'
          or (v_event.status = 'published' and coalesce(v_event.ends_at, v_event.starts_at) <= now())) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;
  update events set status = 'archived', archived_at = now() where id = p_event_id returning * into v_event;
  return jsonb_build_object('id', v_event.id, 'status', v_event.status);
end;
$$;

-- ---------- Registration (member) ----------
create or replace function public.event_join(p_event_id uuid, p_division text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
  v_uid uuid := auth.uid();
  v_reg event_registrations%rowtype;
  v_has_row boolean;
  v_division text;
  v_count int;
begin
  v_event := forge_events_member_event(p_event_id, true);  -- row lock serializes joins per event
  if v_event.status <> 'published' then
    raise exception using errcode = 'P0001', message = 'event_not_open';
  end if;
  if not v_event.registration_enabled
     or now() >= coalesce(v_event.registration_deadline, v_event.ends_at, v_event.starts_at) then
    raise exception using errcode = 'P0001', message = 'registration_closed';
  end if;
  v_division := coalesce(p_division, v_event.divisions[1]);
  if not (v_division = any (v_event.divisions)) then
    raise exception using errcode = 'P0001', message = 'invalid_division';
  end if;

  select * into v_reg from event_registrations where event_id = p_event_id and member_id = v_uid for update;
  -- Captured once: FOUND is overwritten by later SELECT INTO statements.
  v_has_row := found;

  if v_has_row and v_reg.status = 'registered' then
    if v_reg.division = v_division then
      return jsonb_build_object('status', 'registered', 'division', v_reg.division, 'changed', false);
    end if;
    if exists (select 1 from event_attempts a where a.event_id = p_event_id and a.member_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'division_locked';
    end if;
    update event_registrations set division = v_division where event_id = p_event_id and member_id = v_uid;
    return jsonb_build_object('status', 'registered', 'division', v_division, 'changed', true);
  end if;

  if v_has_row and v_reg.division <> v_division
     and exists (select 1 from event_attempts a where a.event_id = p_event_id and a.member_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'division_locked';
  end if;

  if v_event.capacity is not null then
    select count(*) into v_count from event_registrations
    where event_id = p_event_id and status = 'registered';
    if v_count >= v_event.capacity then
      raise exception using errcode = 'P0001', message = 'event_full';
    end if;
  end if;

  if v_has_row then
    update event_registrations
      set status = 'registered', division = v_division, registered_at = now(), withdrawn_at = null
    where event_id = p_event_id and member_id = v_uid;
  else
    insert into event_registrations (event_id, gym_id, member_id, division, status)
    values (p_event_id, v_event.gym_id, v_uid, v_division, 'registered');
  end if;
  return jsonb_build_object('status', 'registered', 'division', v_division, 'changed', true);
end;
$$;

create or replace function public.event_leave(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
  v_uid uuid := auth.uid();
  v_reg event_registrations%rowtype;
begin
  v_event := forge_events_member_event(p_event_id, true);
  select * into v_reg from event_registrations where event_id = p_event_id and member_id = v_uid for update;
  if not found or v_reg.status = 'withdrawn' then
    return jsonb_build_object('status', 'withdrawn', 'changed', false);
  end if;
  if v_event.status <> 'published' then
    raise exception using errcode = 'P0001', message = 'event_not_open';
  end if;
  if v_event.scoring_enabled then
    if exists (select 1 from event_attempts a where a.event_id = p_event_id and a.member_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'leave_locked_attempts_exist';
    end if;
    if now() >= v_event.ends_at then
      raise exception using errcode = 'P0001', message = 'event_ended';
    end if;
  elsif now() >= v_event.starts_at then
    raise exception using errcode = 'P0001', message = 'event_started';
  end if;
  update event_registrations set status = 'withdrawn', withdrawn_at = now()
  where event_id = p_event_id and member_id = v_uid;
  return jsonb_build_object('status', 'withdrawn', 'changed', true);
end;
$$;

-- Counts only (no identities) for any event the caller can see - so a
-- card can show "12 going" even when the participant list is hidden.
create or replace function public.event_registration_counts(p_event_ids uuid[])
returns table (event_id uuid, registered_count int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, (select count(*)::int from event_registrations r where r.event_id = e.id and r.status = 'registered')
  from events e
  where e.id = any (p_event_ids)
    and (
      is_coach_or_admin(e.gym_id)
      or (e.gym_id = my_gym_id() and e.status <> 'draft' and forge_events_enabled(e.gym_id))
    );
$$;

-- ---------- Announcements (member) ----------
create or replace function public.event_ack_announcement(p_event_id uuid, p_revision int, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
  v_uid uuid := auth.uid();
begin
  v_event := forge_events_member_event(p_event_id, false);
  if p_action is null or p_action not in ('dismissed', 'joined') then
    raise exception using errcode = 'P0001', message = 'invalid_action';
  end if;
  if p_revision is null or p_revision < 1 or p_revision > v_event.announcement_revision then
    raise exception using errcode = 'P0001', message = 'invalid_revision';
  end if;
  insert into event_announcement_acks (event_id, gym_id, member_id, revision, action)
  values (p_event_id, v_event.gym_id, v_uid, p_revision, p_action)
  on conflict (event_id, member_id) do update set
    revision = greatest(event_announcement_acks.revision, excluded.revision),
    action = case when excluded.revision >= event_announcement_acks.revision then excluded.action else event_announcement_acks.action end,
    acknowledged_at = case when excluded.revision >= event_announcement_acks.revision then now() else event_announcement_acks.acknowledged_at end;
  return jsonb_build_object('event_id', p_event_id, 'revision',
    (select revision from event_announcement_acks where event_id = p_event_id and member_id = v_uid));
end;
$$;

-- SECURITY INVOKER: the events and acks RLS policies above decide visibility.
create or replace function public.my_pending_event_announcements()
returns table (
  id uuid, event_type text, title text, description text, cover_path text, location text,
  starts_at timestamptz, ends_at timestamptz, has_workout boolean, workout_format text,
  workout_description text, registration_enabled boolean, announcement_revision int,
  published_at timestamptz, is_registered boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.id, e.event_type, e.title, e.description, e.cover_path, e.location,
         e.starts_at, e.ends_at, e.has_workout, e.workout_format,
         e.workout_description, e.registration_enabled, e.announcement_revision,
         e.published_at,
         exists (select 1 from event_registrations r
                 where r.event_id = e.id and r.member_id = auth.uid() and r.status = 'registered')
  from events e
  where e.gym_id = my_gym_id()
    and e.status = 'published'
    and forge_events_enabled(e.gym_id)
    and coalesce(e.ends_at, e.starts_at) > now()
    and not exists (
      select 1 from event_announcement_acks a
      where a.event_id = e.id and a.member_id = auth.uid() and a.revision >= e.announcement_revision
    )
  order by e.published_at, e.id
  limit 20;
$$;

-- ---------- Attempts (member) ----------
-- Validates the client-composed score payload (shape + bounds only; the
-- score MEANING is FORGE's existing client composition, unchanged).
create or replace function public.forge_events_clean_score(p_fields jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  k text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_fields';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('result', 'time_result', 'sets', 'log_meta', 'completion_state', 'weight_logged', 'weight_unit', 'notes') then
      raise exception using errcode = 'P0001', message = 'invalid_fields', detail = k;
    end if;
  end loop;
  if (p_fields ? 'result' and jsonb_typeof(p_fields->'result') not in ('string', 'null'))
     or (p_fields ? 'time_result' and jsonb_typeof(p_fields->'time_result') not in ('string', 'null'))
     or (p_fields ? 'weight_logged' and jsonb_typeof(p_fields->'weight_logged') not in ('string', 'null'))
     or (p_fields ? 'weight_unit' and jsonb_typeof(p_fields->'weight_unit') not in ('string', 'null'))
     or (p_fields ? 'notes' and jsonb_typeof(p_fields->'notes') not in ('string', 'null'))
     or (p_fields ? 'completion_state' and jsonb_typeof(p_fields->'completion_state') not in ('string', 'null'))
     or (p_fields ? 'sets' and jsonb_typeof(p_fields->'sets') not in ('object', 'null'))
     or (p_fields ? 'log_meta' and jsonb_typeof(p_fields->'log_meta') not in ('object', 'null')) then
    raise exception using errcode = 'P0001', message = 'invalid_fields';
  end if;
  if nullif(p_fields->>'completion_state', '') not in ('completed', 'capped')
     or nullif(p_fields->>'weight_unit', '') not in ('kg', 'lb') then
    raise exception using errcode = 'P0001', message = 'invalid_fields';
  end if;
  if coalesce(nullif(btrim(p_fields->>'result'), ''), nullif(btrim(p_fields->>'time_result'), '')) is null
     and jsonb_typeof(p_fields->'sets') is distinct from 'object'
     and jsonb_typeof(p_fields->'log_meta') is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'empty_score';
  end if;
  return jsonb_build_object(
    'result', nullif(btrim(p_fields->>'result'), ''),
    'time_result', nullif(btrim(p_fields->>'time_result'), ''),
    'sets', case when jsonb_typeof(p_fields->'sets') = 'object' then p_fields->'sets' end,
    'log_meta', case when jsonb_typeof(p_fields->'log_meta') = 'object' then p_fields->'log_meta' end,
    'completion_state', nullif(p_fields->>'completion_state', ''),
    'weight_logged', nullif(btrim(p_fields->>'weight_logged'), ''),
    'weight_unit', nullif(p_fields->>'weight_unit', ''),
    'notes', nullif(p_fields->>'notes', '')
  );
end;
$$;

create or replace function public.event_submit_attempt(p_event_id uuid, p_client_attempt_id uuid, p_fields jsonb)
returns public.event_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
  v_uid uuid := auth.uid();
  v_reg event_registrations%rowtype;
  v_existing event_attempts%rowtype;
  v_clean jsonb;
  v_total int;
  v_row event_attempts%rowtype;
begin
  if p_client_attempt_id is null then
    raise exception using errcode = 'P0001', message = 'missing_client_attempt_id';
  end if;
  v_event := forge_events_member_event(p_event_id, true);  -- row lock: serializes the cap check

  -- Idempotency first: a retry returns the original attempt and never
  -- consumes another one (even if the window closed in between).
  select * into v_existing from event_attempts
  where event_id = p_event_id and member_id = v_uid and client_attempt_id = p_client_attempt_id;
  if found then
    return v_existing;
  end if;

  if v_event.status <> 'published' then
    raise exception using errcode = 'P0001', message = 'event_not_open';
  end if;
  if not v_event.scoring_enabled then
    raise exception using errcode = 'P0001', message = 'scoring_disabled';
  end if;
  if now() < v_event.starts_at or now() > v_event.ends_at then
    raise exception using errcode = 'P0001', message = 'outside_scoring_window';
  end if;
  select * into v_reg from event_registrations
  where event_id = p_event_id and member_id = v_uid and status = 'registered';
  if not found then
    raise exception using errcode = 'P0001', message = 'not_registered';
  end if;

  -- Safeguard 1: the cap counts EVERY attempt ever created, soft-deleted included.
  select count(*) into v_total from event_attempts where event_id = p_event_id and member_id = v_uid;
  if v_total >= 20 then
    raise exception using errcode = 'P0001', message = 'attempt_limit_reached';
  end if;

  v_clean := forge_events_clean_score(p_fields);
  insert into event_attempts (
    event_id, gym_id, member_id, client_attempt_id, division,
    result, time_result, sets, log_meta, completion_state, weight_logged, weight_unit, notes,
    format_snapshot, format_config_snapshot
  ) values (
    p_event_id, v_event.gym_id, v_uid, p_client_attempt_id, v_reg.division,
    -- ->> turns a JSON null into SQL NULL; for jsonb columns do it explicitly.
    v_clean->>'result', v_clean->>'time_result', nullif(v_clean->'sets', 'null'::jsonb), nullif(v_clean->'log_meta', 'null'::jsonb),
    v_clean->>'completion_state', v_clean->>'weight_logged', v_clean->>'weight_unit', v_clean->>'notes',
    v_event.workout_format, v_event.workout_format_config
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.forge_events_own_open_attempt(p_attempt_id uuid)
returns public.event_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt event_attempts%rowtype;
  v_event events%rowtype;
begin
  select * into v_attempt from event_attempts where id = p_attempt_id;
  if not found or v_attempt.member_id is distinct from auth.uid() then
    raise exception using errcode = 'P0001', message = 'attempt_not_found';
  end if;
  v_event := forge_events_member_event(v_attempt.event_id, true);
  select * into v_attempt from event_attempts where id = p_attempt_id for update;
  if v_attempt.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'attempt_deleted';
  end if;
  if v_event.status <> 'published' or not v_event.scoring_enabled
     or now() < v_event.starts_at or now() > v_event.ends_at then
    raise exception using errcode = 'P0001', message = 'outside_scoring_window';
  end if;
  return v_attempt;
end;
$$;

create or replace function public.event_update_attempt(p_attempt_id uuid, p_fields jsonb)
returns public.event_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt event_attempts%rowtype;
  v_clean jsonb;
  v_score_changed boolean;
  v_row event_attempts%rowtype;
begin
  v_attempt := forge_events_own_open_attempt(p_attempt_id);
  v_clean := forge_events_clean_score(p_fields);
  v_score_changed := (v_clean->>'result', v_clean->>'time_result', nullif(v_clean->'sets', 'null'::jsonb), nullif(v_clean->'log_meta', 'null'::jsonb),
                      v_clean->>'completion_state', v_clean->>'weight_logged', v_clean->>'weight_unit')
                     is distinct from
                     (v_attempt.result, v_attempt.time_result, v_attempt.sets, v_attempt.log_meta,
                      v_attempt.completion_state, v_attempt.weight_logged, v_attempt.weight_unit);
  update event_attempts set
    result = v_clean->>'result',
    time_result = v_clean->>'time_result',
    sets = nullif(v_clean->'sets', 'null'::jsonb),
    log_meta = nullif(v_clean->'log_meta', 'null'::jsonb),
    completion_state = v_clean->>'completion_state',
    weight_logged = v_clean->>'weight_logged',
    weight_unit = v_clean->>'weight_unit',
    notes = v_clean->>'notes',
    -- Tie-break stability: an edited score cannot keep an earlier tie position.
    scored_at = case when v_score_changed then now() else scored_at end
  where id = p_attempt_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.event_delete_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform forge_events_own_open_attempt(p_attempt_id);
  update event_attempts set deleted_at = now() where id = p_attempt_id;
  return jsonb_build_object('id', p_attempt_id, 'deleted', true);
end;
$$;

-- ============================================================
-- 6. Function privileges (Supabase default privileges grant EXECUTE to
--    anon/authenticated on new functions - revoke explicitly).
-- ============================================================
revoke all on function public.forge_events_enabled(uuid) from public, anon;
grant execute on function public.forge_events_enabled(uuid) to authenticated;  -- used inside RLS policies

revoke all on function public.forge_events_touch_updated_at() from public, anon, authenticated;
revoke all on function public.events_edit_guard() from public, anon, authenticated;
revoke all on function public.event_attempts_record_history() from public, anon, authenticated;
revoke all on function public.event_attempt_history_immutable() from public, anon, authenticated;
revoke all on function public.forge_events_member_event(uuid, boolean) from public, anon, authenticated;
revoke all on function public.forge_events_staff_event(uuid) from public, anon, authenticated;
revoke all on function public.forge_events_own_open_attempt(uuid) from public, anon, authenticated;
revoke all on function public.forge_events_clean_score(jsonb) from public, anon, authenticated;

revoke all on function public.event_publish(uuid) from public, anon;
revoke all on function public.event_cancel(uuid) from public, anon;
revoke all on function public.event_archive(uuid) from public, anon;
revoke all on function public.event_join(uuid, text) from public, anon;
revoke all on function public.event_leave(uuid) from public, anon;
revoke all on function public.event_registration_counts(uuid[]) from public, anon;
revoke all on function public.event_ack_announcement(uuid, int, text) from public, anon;
revoke all on function public.my_pending_event_announcements() from public, anon;
revoke all on function public.event_submit_attempt(uuid, uuid, jsonb) from public, anon;
revoke all on function public.event_update_attempt(uuid, jsonb) from public, anon;
revoke all on function public.event_delete_attempt(uuid) from public, anon;

grant execute on function public.event_publish(uuid) to authenticated;
grant execute on function public.event_cancel(uuid) to authenticated;
grant execute on function public.event_archive(uuid) to authenticated;
grant execute on function public.event_join(uuid, text) to authenticated;
grant execute on function public.event_leave(uuid) to authenticated;
grant execute on function public.event_registration_counts(uuid[]) to authenticated;
grant execute on function public.event_ack_announcement(uuid, int, text) to authenticated;
grant execute on function public.my_pending_event_announcements() to authenticated;
grant execute on function public.event_submit_attempt(uuid, uuid, jsonb) to authenticated;
grant execute on function public.event_update_attempt(uuid, jsonb) to authenticated;
grant execute on function public.event_delete_attempt(uuid) to authenticated;

-- ============================================================
-- 7. Realtime (RLS is evaluated per subscriber before delivery)
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_registrations') then
    alter publication supabase_realtime add table public.event_registrations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_attempts') then
    alter publication supabase_realtime add table public.event_attempts;
  end if;
end;
$$;

-- ============================================================
-- 8. Storage: event-covers (public read by URL, staff-only writes into
--    their own gym's folder: <gym_id>/<event_id>/<file>). Members get no
--    SELECT policy - covers are served by public URL, never listed. Staff
--    get SELECT on their own gym's folder because the Storage API's
--    remove / upsert read the row back (DELETE/UPDATE ... RETURNING): without
--    it a staff delete silently removes nothing (Phase 1B, real Postgres).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy event_covers_select_staff on storage.objects for select to authenticated
  using (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (my_gym_id())::text
    and is_coach_or_admin(my_gym_id())
  );

create policy event_covers_insert_staff on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (my_gym_id())::text
    and is_coach_or_admin(my_gym_id())
  );
create policy event_covers_update_staff on storage.objects for update to authenticated
  using (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (my_gym_id())::text
    and is_coach_or_admin(my_gym_id())
  )
  with check (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (my_gym_id())::text
    and is_coach_or_admin(my_gym_id())
  );
create policy event_covers_delete_staff on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (my_gym_id())::text
    and is_coach_or_admin(my_gym_id())
  );
