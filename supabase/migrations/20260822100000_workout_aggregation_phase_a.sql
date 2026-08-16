-- Workout Aggregation, Phase A - Piece 1: the additive `aggregate_definition`
-- field + its structural validation trigger. Per WORKOUT_AGGREGATION_
-- ARCHITECTURE.md S16/S19/S44-D: Programming (here: `workouts`, the live
-- Workout Engine V2 row, the closest real-schema analog to the paper
-- WorkoutVersion entity - PROGRAMMING_DOMAIN_V1_2.md's WorkoutVersion does
-- not exist in live schema, confirmed by direct query this session, and by
-- SCORING_PHASE1A...READINESS.md S6's own prior finding that no revision/
-- version entity exists for workout_sections either) owns the DECLARATION;
-- Results/Leaderboard (a future phase, not this one) owns the read-time
-- DERIVATION. Nothing in this migration computes, ranks, or persists a
-- derived aggregate result - see workoutAggregation.js/.ts (pure engine,
-- no DB access) for that, per S20's "derived, never persisted" decision.
--
-- Column choice: `workouts`, not `wods` (legacy). `workouts` is the row
-- that owns `workout_sections` via a real FK (workout_id), so
-- participantSectionIds can be validated against real, gym-scoped,
-- workout-scoped rows - `wods` has no notion of Section UUIDs at all.
--
-- Stale-client safety (mission S45), verified directly against
-- sync_workout_engine_v2 (20260716110000_workout_engine_v2_stabilization.sql)
-- before writing this migration, not assumed: that RPC's `on conflict...
-- do update set` clause only ever touches title/legacy_wod_id/updated_at -
-- it never mentions this new column, so every ordinary WOD save (which
-- re-triggers that RPC) leaves `aggregate_definition` completely untouched,
-- by construction, with zero change needed to that RPC. An old/unaware
-- client re-saving a WOD cannot erase this field, because the one write
-- path every client already goes through was already narrow enough not to.

alter table workouts add column if not exists aggregate_definition jsonb;

comment on column workouts.aggregate_definition is
  'Workout Aggregation Phase A - optional, coach-declared cross-Section combine rule. Shape: {participantSectionIds: uuid[] (>=2, distinct), combineFunction: sum|best-of|average|max|min|placement-sum|points-sum, pointsTable?: [{rank,points}]}. Null (the default, for every existing and new row) means no aggregate - WORKOUT_AGGREGATION_ARCHITECTURE.md S7/S44-B. Derived aggregate results are NEVER persisted (S20) - this column holds only the declaration, never a computed value.';

-- ============================================================
-- Structural validation trigger - mirrors sync_workout_engine_v2's own
-- SECURITY DEFINER + explicit is_coach_or_admin pattern (already used
-- twice in this codebase for exactly this class of "the RLS row-owner
-- check alone isn't enough, the JSON content itself needs enforcing"
-- problem). Enforces ONLY structural/tenant-safety constraints (mission
-- S42: existence, same-Workout, same-gym, logging_mode='required',
-- combine-function vocabulary, no duplicates, minimum 2 participants -
-- reusing SEGMENT_MODEL_SPEC_v1.md Invariant 4's own "a composite needs
-- >=2 children, or it isn't composing anything" precedent verbatim).
-- Family-A metric-kind/unit/direction compatibility (S13/S19c of the
-- architecture doc) is NOT checked here - that requires inspecting
-- format/format_config semantics already modeled in workoutFormats.js/
-- formatCatalog.ts, not duplicated into SQL; it is checked in the pure
-- engine's own validateAggregateDefinition (both repos), matching the
-- mission's own explicit instruction (S42) to document the trust boundary
-- when full DB-level validation is impractical for a JSON field's semantic
-- content, not just its existence.
-- ============================================================

create or replace function public.validate_workout_aggregate_definition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_combine_function text;
  v_participant_ids text[];
  v_distinct_count int;
  v_valid_count int;
  v_points_table jsonb;
begin
  if new."aggregate_definition" is null then
    return new;
  end if;

  if jsonb_typeof(new."aggregate_definition") <> 'object' then
    raise exception 'aggregate_definition must be a JSON object or null';
  end if;

  v_combine_function := new."aggregate_definition" ->> 'combineFunction';
  if v_combine_function is null or v_combine_function not in
    ('sum', 'best-of', 'average', 'max', 'min', 'placement-sum', 'points-sum') then
    raise exception 'aggregate_definition.combineFunction must be one of the seven approved values, got: %', v_combine_function;
  end if;

  if jsonb_typeof(new."aggregate_definition" -> 'participantSectionIds') <> 'array' then
    raise exception 'aggregate_definition.participantSectionIds must be an array';
  end if;

  select array_agg(value) into v_participant_ids
  from jsonb_array_elements_text(new."aggregate_definition" -> 'participantSectionIds');

  if v_participant_ids is null or array_length(v_participant_ids, 1) < 2 then
    raise exception 'aggregate_definition.participantSectionIds must reference at least 2 Sections - a single Section is not an aggregate (SEGMENT_MODEL_SPEC_v1.md Invariant 4 precedent)';
  end if;

  select count(distinct v) into v_distinct_count from unnest(v_participant_ids) as v;
  if v_distinct_count <> array_length(v_participant_ids, 1) then
    raise exception 'aggregate_definition.participantSectionIds must not contain duplicate Section ids';
  end if;

  select count(*) into v_valid_count
  from workout_sections ws
  where ws.id::text = any(v_participant_ids)
    and ws.workout_id = new."id"
    and ws.gym_id = new."gym_id"
    and ws.logging_mode = 'required';

  if v_valid_count <> array_length(v_participant_ids, 1) then
    raise exception 'aggregate_definition.participantSectionIds must reference only currently-required Sections of this same Workout (found % of % valid)', v_valid_count, array_length(v_participant_ids, 1);
  end if;

  if v_combine_function = 'points-sum' then
    v_points_table := new."aggregate_definition" -> 'pointsTable';
    if v_points_table is null or jsonb_typeof(v_points_table) <> 'array' or jsonb_array_length(v_points_table) = 0 then
      raise exception 'aggregate_definition.pointsTable is required and must be a non-empty array when combineFunction is points-sum';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_workout_aggregate_definition_trg on workouts;
create trigger validate_workout_aggregate_definition_trg
  before insert or update of aggregate_definition on workouts
  for each row
  execute function public.validate_workout_aggregate_definition();
