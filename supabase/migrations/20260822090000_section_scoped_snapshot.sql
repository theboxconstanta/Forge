-- Scoring Phase 1B, Layer 2a - snapshot_wod_log_context() is keyed purely
-- off NEW.wod_id, always pulling `wods`.name/type/format_config/
-- movements_rx - i.e. always the PRIMARY (metcon) section's content,
-- regardless of workout_section_id. Layer 1 made non-primary (skill/
-- skill2) sections independently loggable; without this fix, logging
-- against one of those sections would silently snapshot the UNRELATED
-- primary section's format/movements (e.g. a "1RM Clean" Weightlifting
-- section's log would snapshot "RFT" + the primary section's thrusters/
-- pull-ups) - wrong format_snapshot, wrong movements_snapshot, and a
-- corrupted Performance Identity signature. Found by tracing the actual
-- trigger before writing the write-path code, not assumed safe.
--
-- Narrow, additive fix: when the log is linked to a NON-PRIMARY section
-- (workout_section_id set, slot_key present and not 'metcon'), snapshot
-- from that section's own format/format_config/movements instead. Every
-- other case (primary-section logs, legacy logs with no section link)
-- takes the exact same branch as before, byte-for-byte - only reached via
-- ELSIF now, not reordered.
--
-- Benchmark/Performance-Identity resolution is deliberately skipped for
-- the new non-primary branch (benchmark_id/performance_identity_id stay
-- null) - a section like "1RM Clean" has no name of its own to match
-- against resolve_benchmark_names, and inventing a resolution strategy for
-- it is out of Layer 2a's scope (persistence, not analytics). Disclosed as
-- a known limitation in the implementation report, not silently guessed.

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
begin
  if new."workout_section_id" is not null then
    select "slot_key", "title", "format", "format_config", "movements"
      into v_section_slot_key, v_section_title, v_section_format, v_section_format_config, v_section_movements
    from "public"."workout_sections" where "id" = new."workout_section_id" and "gym_id" = new."gym_id";
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
