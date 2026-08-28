-- INC-03 — HISTORICAL WORKOUT IDENTITY & LOGGING INTEGRITY — recurrence prevention.
--
-- The confirmed production data divergence (workouts.date=2026-08-27 /
-- wods.date=2026-08-28 for the linked pair workout 7daeed8f / wods 8cd9666b)
-- was corrected out-of-band by an authorized one-row guarded UPDATE
-- (wods.date 2026-08-28 -> 2026-08-27). This migration eliminates the ROOT
-- CAUSE so the same class of silent divergence cannot recur.
--
-- ROOT CAUSE (reproduced deterministically)
-- ----------------------------------------
-- `workouts` has TWO uniqueness rules:
--   * workouts_gym_id_date_key      UNIQUE (gym_id, date)
--   * workouts_legacy_wod_id_uidx   UNIQUE (legacy_wod_id) WHERE legacy_wod_id IS NOT NULL
-- i.e. the Engine V2 workout <-> legacy WOD relationship is strictly 1:1.
--
-- `sync_workout_engine_v2` (the SOLE writer of `workouts` rows — the client
-- only ever SELECTs or DELETEs `workouts`) upserted the workout row with
-- `ON CONFLICT (gym_id, date)` and did NOT include `date` in its DO UPDATE
-- set. So when a coach edits a WOD's date (D -> D'):
--   1. `wods.update({date: D'})` succeeds (client, tx 1).
--   2. the dual-write calls sync_workout_engine_v2(..., p_date := D', ...).
--   3. `INSERT INTO workouts (... date=D' ..., legacy_wod_id=L)
--       ON CONFLICT (gym_id, date) DO UPDATE ...` — no workout row exists for
--      (gym, D'), so the ON CONFLICT (gym_id,date) arbiter does NOT fire and
--      Postgres attempts a fresh INSERT.
--   4. that INSERT carries legacy_wod_id = L, which already exists on the
--      OLD workout row (still dated D) -> UNIQUE VIOLATION on
--      workouts_legacy_wod_id_uidx -> the RPC raises.
--   5. `syncWorkoutEngineV2FromLegacyWod` (workoutEngine.js) catches EVERY
--      error (`catch (err) { console.error(...); return false }`) — the
--      coach sees a success toast; `wods.date = D'` while `workouts.date = D`
--      forever. Silent.
--
-- FIX (two layers)
-- ---------------
-- LAYER A — sync_workout_engine_v2:
--   * the authoritative business date is now read from the linked `wods` row
--     itself (single source of truth), not trusted from the client's p_date;
--   * the workout row is upserted `ON CONFLICT (legacy_wod_id)` — the stable
--     1:1 identity — with `date` INCLUDED in the DO UPDATE, so an edited date
--     propagates instead of colliding;
--   * an explicit guard raises a clear error (SQLSTATE 'FRG03') if the target
--     (gym_id, date) is already occupied by a DIFFERENT workout, instead of a
--     raw constraint violation that the client would swallow.
--   Everything else in the function (authorization check, the whole section
--   upsert/delete loop) is byte-for-byte unchanged. Signature unchanged
--   (p_date is kept for call-site compatibility; it is now only used as a
--   cross-check hint, never as the stored date).
--
-- LAYER C — enforce_workout_legacy_date_sync() trigger on `workouts`:
--   BEFORE INSERT OR UPDATE OF (date, legacy_wod_id) — when legacy_wod_id is
--   set, asserts workouts.date == the linked wods.date. Proven safe against
--   every legitimate ordering: sync_workout_engine_v2 is the only INSERT/
--   UPDATE writer of `workouts` and (post Layer A) always writes date = the
--   linked wods.date within the same statement; the client's only other
--   `workouts` write is DELETE (trigger does not fire on DELETE); WOD deletion
--   deletes `workouts` before `wods` (FK RESTRICT), never touching this
--   trigger. It is a cheap belt-and-suspenders invariant that makes any
--   future regression (a new writer, a botched backfill) fail loudly instead
--   of silently.
--
-- No RLS / grant / security-posture change. No `wod_logs` change. No schema
-- column added. Does not touch P0-01, dashboard_resolve_window,
-- m9_publish_waiver, or any Financial object.

-- ─────────────────────────────────────────────────────────────────────────────
-- LAYER A — sync_workout_engine_v2 (CREATE OR REPLACE, same signature)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_workout_engine_v2(
  p_gym_id uuid, p_date date, p_title text, p_legacy_wod_id uuid, p_sections jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_workout_id uuid;
  v_section jsonb;
  v_type_id uuid;
  v_default_type_id uuid;
  v_keep_slot_keys text[];
  v_wod_date date;
  v_occupant uuid;
begin
  if not is_coach_or_admin(p_gym_id) then
    raise exception 'not authorized';
  end if;

  -- INC-03: the linked legacy WOD row is the single source of truth for the
  -- workout's business date. Never derive it independently / trust p_date.
  select date into v_wod_date from wods where id = p_legacy_wod_id;
  if v_wod_date is null then
    raise exception 'sync_workout_engine_v2: legacy wod % does not exist', p_legacy_wod_id
      using errcode = 'FRG03';
  end if;

  -- INC-03: if a DIFFERENT workout already owns (gym, target date), surface it
  -- explicitly rather than letting workouts_gym_id_date_key raise a raw error
  -- that the fire-and-forget client would swallow.
  select id into v_occupant
  from workouts
  where gym_id = p_gym_id and date = v_wod_date
    and (legacy_wod_id is distinct from p_legacy_wod_id);
  if v_occupant is not null then
    raise exception 'sync_workout_engine_v2: date % already has a different workout (%) for this gym', v_wod_date, v_occupant
      using errcode = 'FRG03';
  end if;

  -- INC-03: upsert on the stable 1:1 identity (legacy_wod_id), and INCLUDE
  -- `date` in the update so an edited WOD date propagates to Engine V2.
  insert into workouts (gym_id, date, title, legacy_wod_id)
  values (p_gym_id, v_wod_date, p_title, p_legacy_wod_id)
  on conflict (legacy_wod_id) where legacy_wod_id is not null do update
    set gym_id = excluded.gym_id,
        date = excluded.date,
        title = excluded.title,
        updated_at = now()
  returning id into v_workout_id;

  select coalesce(array_agg(s ->> 'slotKey'), array[]::text[])
    into v_keep_slot_keys
  from jsonb_array_elements(p_sections) as s;

  -- sterge DOAR sloturile legacy care nu mai apar in lista noua (ex. coach
  -- a oprit vizibilitatea Warm-up) - niciodata sectiuni native (slot_key
  -- null), niciodata un delete general.
  delete from workout_sections
  where workout_id = v_workout_id
    and slot_key is not null
    and not (slot_key = any(v_keep_slot_keys));

  select id into v_default_type_id from workout_section_types where key = 'metcon' and gym_id is null;

  for v_section in select * from jsonb_array_elements(p_sections) loop
    select id into v_type_id
    from workout_section_types
    where key = (v_section ->> 'type') and gym_id is null;

    insert into workout_sections (
      workout_id, gym_id, section_type_id, slot_key, order_index, title, description,
      format, format_config, movements, scaling_versions, logging_mode, score_type,
      duration_minutes, benchmark_metadata, metadata
    )
    values (
      v_workout_id, p_gym_id, coalesce(v_type_id, v_default_type_id), v_section ->> 'slotKey',
      (v_section ->> 'order')::int, v_section ->> 'title', v_section ->> 'description',
      v_section ->> 'format', coalesce(v_section -> 'formatConfig', '{}'::jsonb),
      coalesce(v_section -> 'movements', '[]'::jsonb), coalesce(v_section -> 'scalingVersions', '[]'::jsonb),
      coalesce(v_section ->> 'loggingMode', 'none'), v_section ->> 'scoreType',
      (v_section ->> 'duration')::int, coalesce(v_section -> 'benchmarkMetadata', '{}'::jsonb),
      coalesce(v_section -> 'metadata', '{}'::jsonb)
    )
    on conflict (workout_id, slot_key) where slot_key is not null do update set
      section_type_id = excluded.section_type_id,
      order_index = excluded.order_index,
      title = excluded.title,
      description = excluded.description,
      format = excluded.format,
      format_config = excluded.format_config,
      movements = excluded.movements,
      scaling_versions = excluded.scaling_versions,
      logging_mode = excluded.logging_mode,
      score_type = excluded.score_type,
      duration_minutes = excluded.duration_minutes,
      benchmark_metadata = excluded.benchmark_metadata,
      metadata = excluded.metadata,
      updated_at = now();
  end loop;

  return v_workout_id;
end;
$function$;

comment on function public.sync_workout_engine_v2(uuid, date, text, uuid, jsonb) is
  'Dual-write sync: legacy wods row -> Engine V2 workouts+workout_sections. INC-03: the workout business date is read from the linked wods row (single source of truth) and the workout is upserted on legacy_wod_id (stable 1:1 identity) with date included, so an edited WOD date propagates and can never leave workouts.date <> wods.date. p_date is retained only for call-site compatibility.';

-- ─────────────────────────────────────────────────────────────────────────────
-- LAYER C — invariant: linked workouts.date == wods.date
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_workout_legacy_date_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wod_date date;
begin
  if new.legacy_wod_id is null then
    return new;
  end if;
  select date into v_wod_date from wods where id = new.legacy_wod_id;
  if v_wod_date is null then
    raise exception 'workout %: legacy_wod_id % has no wods row', new.id, new.legacy_wod_id
      using errcode = 'FRG03';
  end if;
  if new.date is distinct from v_wod_date then
    raise exception 'workout identity integrity (INC-03): workouts.date (%) must equal the linked wods.date (%) for legacy_wod_id %',
      new.date, v_wod_date, new.legacy_wod_id
      using errcode = 'FRG03';
  end if;
  return new;
end;
$function$;

comment on function public.enforce_workout_legacy_date_sync() is
  'INC-03 recurrence guard - BEFORE INSERT OR UPDATE OF (date, legacy_wod_id) ON workouts. For a workout linked to a legacy WOD, forces workouts.date = wods.date. sync_workout_engine_v2 is the only INSERT/UPDATE writer of workouts and always satisfies this; the guard makes any future regression fail loudly instead of silently diverging.';

drop trigger if exists workouts_enforce_legacy_date_sync on public.workouts;
create trigger workouts_enforce_legacy_date_sync
  before insert or update of date, legacy_wod_id on public.workouts
  for each row execute function public.enforce_workout_legacy_date_sync();
