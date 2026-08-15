-- Scoring Phase 1B, Layer 2a - workout_section_id integrity.
--
-- wod_logs_insert_own's RLS CHECK only validates member_id/gym_id - it
-- never validates that a client-supplied workout_section_id actually
-- belongs to the workout (wod_id) being logged, or even to the caller's
-- own gym. Pre-existing since Faza 8 introduced the column, but Layer 2a
-- makes it load-bearing (it now determines which independently-scored
-- Section a result counts against), so hardening it now rather than
-- deferring - mission requirement: "the Section being logged actually
-- belongs to the Workout being logged... do not blindly trust
-- client-supplied Section IDs."
--
-- Extends the same BEFORE INSERT/UPDATE trigger already added for
-- section-scoped snapshotting (20260822090000) - one write-boundary check,
-- not a second trigger. Rejects (raises) only when workout_section_id is
-- set and does NOT resolve to a workout_sections row belonging to the same
-- gym AND the same legacy Workout (workouts.legacy_wod_id = NEW.wod_id).
-- A NULL workout_section_id (legacy/free-form logging, or V2 not yet
-- synced) is unaffected - existing behavior, unchanged.

create or replace function public.snapshot_wod_log_context()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_type text;
  v_format_config jsonb;
  v_movements jsonb;
  v_benchmark_id uuid;
  v_signature text;
  v_identity_id uuid;
  v_section_slot_key text;
  v_section_title text;
  v_section_format text;
  v_section_format_config jsonb;
  v_section_movements jsonb;
  v_section_legacy_wod_id uuid;
begin
  if new."workout_section_id" is not null then
    select ws."slot_key", ws."title", ws."format", ws."format_config", ws."movements", w."legacy_wod_id"
      into v_section_slot_key, v_section_title, v_section_format, v_section_format_config, v_section_movements, v_section_legacy_wod_id
    from "public"."workout_sections" ws
    join "public"."workouts" w on w."id" = ws."workout_id"
    where ws."id" = new."workout_section_id" and ws."gym_id" = new."gym_id";

    if v_section_slot_key is null or v_section_legacy_wod_id is distinct from new."wod_id" then
      raise exception 'workout_section_id % does not belong to wod_id % in gym %', new."workout_section_id", new."wod_id", new."gym_id";
    end if;
  end if;

  if v_section_slot_key is not null and v_section_slot_key <> 'metcon' then
    -- Phase 1B, Layer 2a - independently-scored non-primary section.
    new."wod_name_snapshot" := v_section_title;
    new."format_snapshot" := v_section_format;
    new."format_config_snapshot" := v_section_format_config;
    new."movements_snapshot" := v_section_movements;
    new."benchmark_id" := null;
    new."performance_signature" := null;
    new."performance_identity_id" := null;
  elsif new."wod_id" is not null then
    select "name", "type", "format_config", to_jsonb("movements_rx")
      into v_name, v_type, v_format_config, v_movements
    from "public"."wods" where "id" = new."wod_id" and "gym_id" = new."gym_id";

    new."wod_name_snapshot" := v_name;
    new."format_snapshot" := v_type;
    new."format_config_snapshot" := v_format_config;
    new."movements_snapshot" := v_movements;

    select rb."benchmark_id" into v_benchmark_id
    from "public"."resolve_benchmark_names"(array[v_name]) rb
    limit 1;
    new."benchmark_id" := v_benchmark_id;

    v_signature := "public"."slice4_compute_performance_signature"(v_type, v_format_config, v_movements);
    new."performance_signature" := v_signature;

    if v_benchmark_id is not null then
      insert into "public"."performance_identities"
        ("gym_id", "benchmark_id", "signature", "signature_version", "format_snapshot", "format_config_snapshot", "movements_snapshot", "display_name", "first_seen_at")
      values (new."gym_id", v_benchmark_id, v_signature, 1, v_type, v_format_config, v_movements, v_name, new."logged_at")
      on conflict ("gym_id", "benchmark_id") where "benchmark_id" is not null
      do update set "id" = "performance_identities"."id"
      returning "id" into v_identity_id;
    elsif v_signature is not null then
      insert into "public"."performance_identities"
        ("gym_id", "benchmark_id", "signature", "signature_version", "format_snapshot", "format_config_snapshot", "movements_snapshot", "display_name", "first_seen_at")
      values (new."gym_id", null, v_signature, 1, v_type, v_format_config, v_movements, v_name, new."logged_at")
      on conflict ("gym_id", "signature") where "benchmark_id" is null
      do update set "id" = "performance_identities"."id"
      returning "id" into v_identity_id;
    else
      v_identity_id := null;
    end if;
    new."performance_identity_id" := v_identity_id;
  end if;
  return new;
end;
$function$;
