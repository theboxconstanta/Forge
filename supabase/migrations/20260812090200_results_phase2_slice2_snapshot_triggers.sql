-- Results Phase 2, Slice 2: stable Result identity, step 3 of 4 - the
-- canonical Result identity service.
--
-- Every future write, from either client, gets its Scoring Snapshot
-- captured identically - the "shared domain service" this slice's own
-- mission calls for (future consumers: PR engine, Benchmark progression,
-- Analytics, Dashboard, Coach tools), implemented the same way every
-- other write-time correctness guarantee on this platform already is
-- (a database-level mechanism, not client code that could diverge between
-- PWA and Admin - matching RESULTS_DOMAIN_ARCHITECTURE.md Section 15
-- Invariant #11's own reasoning, extended here to snapshot capture).
--
-- Fires on INSERT, and on UPDATE only when wod_id itself changes - a
-- notes/result/score edit must never re-resolve or silently refresh an
-- already-frozen snapshot (that would defeat the entire point: the
-- snapshot is frozen at the moment the link to a Workout is established,
-- not kept live). No existing write path in either client ever changes
-- wod_id after insert; this trigger exists to make that guarantee
-- structural, not merely a convention every future write path has to
-- remember to honor.
--
-- SECURITY INVOKER (the default - no DEFINER clause), matching Slice 1's
-- own resolve_benchmark_names: every real caller (a member inserting
-- their own log) already has RLS-permitted read access to their own
-- gym's `wods` row and to every visible Benchmark, so no elevated
-- privilege is needed here either.

CREATE OR REPLACE FUNCTION "public"."snapshot_wod_log_context"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text;
  v_type text;
  v_format_config jsonb;
  v_benchmark_id uuid;
BEGIN
  IF NEW."wod_id" IS NOT NULL THEN
    SELECT "name", "type", "format_config" INTO v_name, v_type, v_format_config
    FROM "public"."wods" WHERE "id" = NEW."wod_id";

    NEW."wod_name_snapshot" := v_name;
    NEW."format_snapshot" := v_type;
    NEW."format_config_snapshot" := v_format_config;

    SELECT rb."benchmark_id" INTO v_benchmark_id
    FROM "public"."resolve_benchmark_names"(ARRAY[v_name]) rb
    LIMIT 1;
    NEW."benchmark_id" := v_benchmark_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."snapshot_wod_log_context"() IS 'Results Phase 2 Slice 2 - freezes a wod_logs row''s Workout context (name/format/Benchmark identity) at the moment wod_id is set, so it survives that Workout later being edited or deleted. Never re-fires on an unrelated field edit.';

CREATE OR REPLACE TRIGGER "snapshot_wod_log_context_trg"
    BEFORE INSERT OR UPDATE OF "wod_id" ON "public"."wod_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."snapshot_wod_log_context"();

CREATE OR REPLACE FUNCTION "public"."snapshot_skill_log_context"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text;
  v_type text;
  v_format_config jsonb;
  v_benchmark_id uuid;
BEGIN
  IF NEW."wod_id" IS NOT NULL THEN
    IF NEW."slot" = 2 THEN
      SELECT "skill2_name", "skill2_type", "skill2_format_config" INTO v_name, v_type, v_format_config
      FROM "public"."wods" WHERE "id" = NEW."wod_id";
    ELSE
      SELECT "skill_name", "skill_type", "skill_format_config" INTO v_name, v_type, v_format_config
      FROM "public"."wods" WHERE "id" = NEW."wod_id";
    END IF;

    NEW."skill_name_snapshot" := v_name;
    NEW."format_snapshot" := v_type;
    NEW."format_config_snapshot" := v_format_config;

    SELECT rb."benchmark_id" INTO v_benchmark_id
    FROM "public"."resolve_benchmark_names"(ARRAY[v_name]) rb
    LIMIT 1;
    NEW."benchmark_id" := v_benchmark_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."snapshot_skill_log_context"() IS 'skill_logs'' own version of snapshot_wod_log_context - slot-aware (Skill vs Skill 2 each has its own name/type/config on wods).';

CREATE OR REPLACE TRIGGER "snapshot_skill_log_context_trg"
    BEFORE INSERT OR UPDATE OF "wod_id" ON "public"."skill_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."snapshot_skill_log_context"();
