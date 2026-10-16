-- FORGE EVENTS - optional member division choice ("Show divisions to members").
-- Owner-approved design, 2026-10-16. Applies after 20261014130000.
--
-- ADDITIVE ONLY:
--   1. events.member_division_choice boolean NOT NULL DEFAULT true. Every
--      existing event keeps today's behaviour (members choose a division
--      when the event offers more than one). Constant default = metadata
--      only on PostgreSQL 17: no row is rewritten.
--   2. CHECK: divisions may be hidden ONLY on unscored events, so scored
--      events and their division leaderboards are unchanged.
--   3. Column grants (insert/update) for staff writes through the API,
--      same pattern as every other staff-editable events column. RLS
--      (is_coach_or_admin) still decides who may write.
--   4. event_join - same signature (uuid, text): when divisions are hidden
--      the client's division is ignored and the server assigns it (the
--      member's existing registration division, else the event's first
--      division). Capacity, deadline, status, gym and flag checks unchanged.
--   5. events_edit_guard - same signature: the new column is read-only on
--      archived events like every other content column.
-- No other table, policy, grant, trigger or function changes. No row is
-- updated. CREATE OR REPLACE keeps each function's owner and privileges.
-- Applied ONLY as a single file after explicit owner approval (never
-- `supabase db push` - the remote ledger is known to drift).
-- Rollback: supabase/rollbacks/20261016120000_forge_events_member_division_choice.rollback.sql

alter table public.events
  add column member_division_choice boolean not null default true;

alter table public.events
  add constraint events_division_choice_requires_unscored
  check (member_division_choice or not scoring_enabled);

grant insert (member_division_choice) on public.events to authenticated;
grant update (member_division_choice) on public.events to authenticated;

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
  select * into v_reg from event_registrations where event_id = p_event_id and member_id = v_uid for update;
  -- Captured once: FOUND is overwritten by later SELECT INTO statements.
  v_has_row := found;

  if v_event.member_division_choice then
    v_division := coalesce(p_division, v_event.divisions[1]);
  else
    -- Divisions hidden from members (staff setting, unscored events only):
    -- the client's value is ignored. A member keeps the division already
    -- stored on their registration row (also when re-joining after leaving);
    -- otherwise the event's first division is the internal division.
    v_division := case when v_has_row and v_reg.division = any (v_event.divisions)
                       then v_reg.division else v_event.divisions[1] end;
  end if;
  if not (v_division = any (v_event.divisions)) then
    raise exception using errcode = 'P0001', message = 'invalid_division';
  end if;

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
          new.workout_standards, new.scoring_enabled, new.leaderboard_visible, new.divisions, new.event_type,
          new.member_division_choice)
         is distinct from
         (old.title, old.description, old.location, old.cover_path, old.starts_at, old.ends_at,
          old.registration_enabled, old.capacity, old.registration_deadline, old.participants_visible,
          old.has_workout, old.workout_format, old.workout_format_config, old.workout_description,
          old.workout_standards, old.scoring_enabled, old.leaderboard_visible, old.divisions, old.event_type,
          old.member_division_choice) then
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
