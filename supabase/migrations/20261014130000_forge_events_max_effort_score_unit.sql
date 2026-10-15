-- FORGE EVENTS - Phase 3.2: server-side validation of the Max Effort score
-- type (owner-approved `scoreUnit`, 2026-10-14) and of Max Effort scores.
--
-- ADDITIVE ONLY. Applies after 20261014120000_forge_events_phase1.sql.
-- No table, column, policy, grant or existing function is changed: one
-- CHECK constraint, one validation function, one trigger. No row is
-- rewritten. Applied ONLY as a single file after explicit owner approval
-- (never `supabase db push` - the remote ledger is known to drift).
-- Rollback: supabase/rollbacks/20261014130000_forge_events_max_effort_score_unit.rollback.sql
--
-- THE GAP this closes (Phase 1 relied on the clients):
--   1. events.workout_format_config was only checked to be a JSON object.
--      Staff (column-granted INSERT/UPDATE through the API) could store a
--      scored Max Effort event with a missing / unknown scoreUnit.
--   2. event_submit_attempt / event_update_attempt validate only key names
--      and JSON types (forge_events_clean_score). A member calling the RPC
--      directly could store ANY text as a Max Effort result (negative,
--      non-numeric, a decimal rep count, a time_result, a completion state,
--      a load without kg/lb, a kg/lb unit on a non-load score).
--
-- Approved score types (identical in the Admin editor and member PWA):
--   load        positive number, weight_unit REQUIRED ('kg' | 'lb')
--   reps        positive whole number, no weight_unit
--   calories    positive whole number, no weight_unit
--   distance_m  positive number (metres), no weight_unit
--   distance_km positive number (kilometres), no weight_unit
-- Every Max Effort score: time_result NULL, completion_state NULL, no sets.

-- ------------------------------------------------------------
-- 1. Event configuration
-- ------------------------------------------------------------
create or replace function public.forge_events_max_effort_unit_valid(p_unit text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_unit in ('load', 'reps', 'calories', 'distance_m', 'distance_km')
$$;

-- A scored Max Effort event MUST carry a valid scoreUnit; scoreUnit belongs to
-- Max Effort only (never left on another format). NOT VALID: an event row that
-- already exists is not re-checked or rewritten by this migration (there are
-- none in production - Phase 1 is unapplied - but the migration must never
-- fail or alter data on a database that has some). New rows and every later
-- UPDATE of a row are checked.
alter table public.events
  add constraint events_max_effort_score_unit check (
    (
      not (scoring_enabled and workout_format = 'Max Effort')
      or coalesce(public.forge_events_max_effort_unit_valid(workout_format_config ->> 'scoreUnit'), false)
    )
    and (
      workout_format_config is null
      or not (workout_format_config ? 'scoreUnit')
      or (workout_format = 'Max Effort'
          and coalesce(public.forge_events_max_effort_unit_valid(workout_format_config ->> 'scoreUnit'), false))
    )
  ) not valid;

-- ------------------------------------------------------------
-- 2. Max Effort scores (every write path: RPCs and any future direct write)
-- ------------------------------------------------------------
-- Validates against the attempt's FROZEN format_snapshot /
-- format_config_snapshot (set server-side by event_submit_attempt from the
-- event; the client cannot choose them). Only Max Effort is checked - every
-- other v1 format keeps exactly its Phase 1 behaviour. On UPDATE the score is
-- re-validated only when a score field changes, so a soft delete (deleted_at)
-- or a notes edit never fails on a historical row.
create or replace function public.event_attempts_validate_max_effort()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unit text;
  v_value numeric;
begin
  if new.format_snapshot is distinct from 'Max Effort' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.result, new.time_result, new.completion_state, new.weight_unit, new.weight_logged, new.sets, new.log_meta)
         is not distinct from
         (old.result, old.time_result, old.completion_state, old.weight_unit, old.weight_logged, old.sets, old.log_meta) then
    return new;
  end if;

  v_unit := new.format_config_snapshot ->> 'scoreUnit';
  if not coalesce(public.forge_events_max_effort_unit_valid(v_unit), false) then
    raise exception using errcode = 'P0001', message = 'score_type_missing';
  end if;

  if new.time_result is not null or new.completion_state is not null
     or new.sets is not null or new.log_meta is not null or new.weight_logged is not null then
    raise exception using errcode = 'P0001', message = 'invalid_score_for_format', detail = 'max_effort_extra_fields';
  end if;

  if new.result is null or new.result !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception using errcode = 'P0001', message = 'invalid_score_for_format', detail = 'max_effort_not_a_number';
  end if;
  v_value := new.result::numeric;
  if v_value <= 0 or v_value > 1000000 then
    raise exception using errcode = 'P0001', message = 'invalid_score_for_format', detail = 'max_effort_out_of_range';
  end if;
  if v_unit in ('reps', 'calories') and v_value <> trunc(v_value) then
    raise exception using errcode = 'P0001', message = 'invalid_score_for_format', detail = 'max_effort_not_whole';
  end if;

  if v_unit = 'load' then
    if new.weight_unit is null then
      raise exception using errcode = 'P0001', message = 'invalid_score_for_format', detail = 'max_effort_load_unit_missing';
    end if;
  elsif new.weight_unit is not null then
    raise exception using errcode = 'P0001', message = 'invalid_score_for_format', detail = 'max_effort_unexpected_weight_unit';
  end if;

  return new;
end;
$$;

-- BEFORE trigger: a refused score raises before the row is written, so
-- nothing is inserted and the AFTER UPDATE history trigger never records it.
-- (BEFORE triggers fire alphabetically; this one only reads NEW/OLD, so its
-- position relative to prevent_gym_id_change / touch_updated_at is irrelevant.)
create trigger event_attempts_validate_max_effort_trg
  before insert or update on public.event_attempts
  for each row execute function public.event_attempts_validate_max_effort();

-- ------------------------------------------------------------
-- 3. Privileges (Supabase default privileges grant EXECUTE to anon /
--    authenticated on new functions - revoke explicitly). The CHECK helper
--    stays callable by authenticated: CHECK constraints run with the
--    privileges of the writing role.
-- ------------------------------------------------------------
revoke all on function public.forge_events_max_effort_unit_valid(text) from public, anon;
grant execute on function public.forge_events_max_effort_unit_valid(text) to authenticated;
revoke all on function public.event_attempts_validate_max_effort() from public, anon, authenticated;
