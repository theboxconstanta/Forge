-- Results Phase 2, Slice 4: resolving Performance Identity at logging
-- time - extends Slice 2's own Scoring Snapshot triggers rather than
-- adding a second, ordering-fragile trigger on the same tables.
--
-- Why extend instead of add a sibling trigger: Postgres runs multiple
-- BEFORE triggers for the same event in alphabetical order by trigger
-- name, and this new logic needs format_snapshot/format_config_snapshot/
-- benchmark_id already resolved before it can compute a signature or
-- look up a Benchmark-based identity - a second trigger would need a
-- fragile naming trick to sort after `snapshot_..._trg`. Folding it into
-- the SAME function keeps "capture this Result's context at logging
-- time" as one concern, one trigger, one ordering guarantee - exactly
-- Slice 2's own already-established pattern, just grown.
--
-- New columns: `movements_snapshot` (the raw movement-line array,
-- frozen the same way wod_name_snapshot/format_snapshot already are -
-- so Performance Identity resolution survives a Workout later being
-- edited or deleted, matching this slice's own required architectural
-- constraint), `performance_signature` (Signature V1's own output, kept
-- on the Result row itself for direct inspection/debugging), and
-- `performance_identity_id` (the resolved link - ON DELETE SET NULL,
-- never CASCADE, matching every other Result-survives-upstream-deletion
-- guarantee this domain has built since Slice 2).
--
-- SECURITY DEFINER is a deliberate, disclosed elevation from Slice 2's
-- original SECURITY INVOKER - this function now needs to WRITE to
-- performance_identities, a table with no client INSERT grant at all
-- (same trust model as pr_events, Slice 3). Because SECURITY DEFINER
-- bypasses RLS on every table the function touches, the `wods` lookup
-- below now ADDS an explicit `AND gym_id = NEW.gym_id` guard that was
-- previously unnecessary under INVOKER (RLS handled it there) - without
-- this guard, a caller could set wod_id to a DIFFERENT gym's wods row
-- and this DEFINER function would happily leak that other gym's
-- Workout name/format/movements into this Result's own snapshot. This
-- is real, deliberate hardening applied while extending the function,
-- not an oversight carried over from Slice 2 (Slice 2 never needed it).

ALTER TABLE "public"."wod_logs"
    ADD COLUMN "movements_snapshot" jsonb,
    ADD COLUMN "performance_signature" text,
    ADD COLUMN "performance_identity_id" uuid REFERENCES "public"."performance_identities"("id") ON DELETE SET NULL;

ALTER TABLE "public"."skill_logs"
    ADD COLUMN "movements_snapshot" jsonb,
    ADD COLUMN "performance_signature" text,
    ADD COLUMN "performance_identity_id" uuid REFERENCES "public"."performance_identities"("id") ON DELETE SET NULL;

CREATE INDEX "wod_logs_performance_identity_idx" ON "public"."wod_logs" ("performance_identity_id");
CREATE INDEX "skill_logs_performance_identity_idx" ON "public"."skill_logs" ("performance_identity_id");

CREATE OR REPLACE FUNCTION "public"."snapshot_wod_log_context"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_type text;
  v_format_config jsonb;
  v_movements jsonb;
  v_benchmark_id uuid;
  v_signature text;
  v_identity_id uuid;
BEGIN
  IF NEW."wod_id" IS NOT NULL THEN
    SELECT "name", "type", "format_config", to_jsonb("movements_rx")
      INTO v_name, v_type, v_format_config, v_movements
    FROM "public"."wods" WHERE "id" = NEW."wod_id" AND "gym_id" = NEW."gym_id";

    NEW."wod_name_snapshot" := v_name;
    NEW."format_snapshot" := v_type;
    NEW."format_config_snapshot" := v_format_config;
    NEW."movements_snapshot" := v_movements;

    SELECT rb."benchmark_id" INTO v_benchmark_id
    FROM "public"."resolve_benchmark_names"(ARRAY[v_name]) rb
    LIMIT 1;
    NEW."benchmark_id" := v_benchmark_id;

    v_signature := "public"."slice4_compute_performance_signature"(v_type, v_format_config, v_movements);
    NEW."performance_signature" := v_signature;

    IF v_benchmark_id IS NOT NULL THEN
      INSERT INTO "public"."performance_identities"
        ("gym_id", "benchmark_id", "signature", "signature_version", "format_snapshot", "format_config_snapshot", "movements_snapshot", "display_name", "first_seen_at")
      VALUES (NEW."gym_id", v_benchmark_id, v_signature, 1, v_type, v_format_config, v_movements, v_name, NEW."logged_at")
      ON CONFLICT ("gym_id", "benchmark_id") WHERE "benchmark_id" IS NOT NULL
      DO UPDATE SET "id" = "performance_identities"."id"
      RETURNING "id" INTO v_identity_id;
    ELSIF v_signature IS NOT NULL THEN
      INSERT INTO "public"."performance_identities"
        ("gym_id", "benchmark_id", "signature", "signature_version", "format_snapshot", "format_config_snapshot", "movements_snapshot", "display_name", "first_seen_at")
      VALUES (NEW."gym_id", NULL, v_signature, 1, v_type, v_format_config, v_movements, v_name, NEW."logged_at")
      ON CONFLICT ("gym_id", "signature") WHERE "benchmark_id" IS NULL
      DO UPDATE SET "id" = "performance_identities"."id"
      RETURNING "id" INTO v_identity_id;
    ELSE
      v_identity_id := NULL;
    END IF;
    NEW."performance_identity_id" := v_identity_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."snapshot_wod_log_context"() IS 'Results Phase 2 Slice 2+4 - freezes a wod_logs row''s Workout context (name/format/movements/Benchmark identity/Performance Identity) at the moment wod_id is set, so it survives that Workout later being edited or deleted. Never re-fires on an unrelated field edit. SECURITY DEFINER since Slice 4 - the only writer to performance_identities.';

CREATE OR REPLACE FUNCTION "public"."snapshot_skill_log_context"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_type text;
  v_format_config jsonb;
  v_movements jsonb;
  v_benchmark_id uuid;
  v_signature text;
  v_identity_id uuid;
BEGIN
  IF NEW."wod_id" IS NOT NULL THEN
    IF NEW."slot" = 2 THEN
      SELECT "skill2_name", "skill2_type", "skill2_format_config", to_jsonb("skill2")
        INTO v_name, v_type, v_format_config, v_movements
      FROM "public"."wods" WHERE "id" = NEW."wod_id" AND "gym_id" = NEW."gym_id";
    ELSE
      SELECT "skill_name", "skill_type", "skill_format_config", to_jsonb("skill")
        INTO v_name, v_type, v_format_config, v_movements
      FROM "public"."wods" WHERE "id" = NEW."wod_id" AND "gym_id" = NEW."gym_id";
    END IF;

    NEW."skill_name_snapshot" := v_name;
    NEW."format_snapshot" := v_type;
    NEW."format_config_snapshot" := v_format_config;
    NEW."movements_snapshot" := v_movements;

    SELECT rb."benchmark_id" INTO v_benchmark_id
    FROM "public"."resolve_benchmark_names"(ARRAY[v_name]) rb
    LIMIT 1;
    NEW."benchmark_id" := v_benchmark_id;

    v_signature := "public"."slice4_compute_performance_signature"(v_type, v_format_config, v_movements);
    NEW."performance_signature" := v_signature;

    IF v_benchmark_id IS NOT NULL THEN
      INSERT INTO "public"."performance_identities"
        ("gym_id", "benchmark_id", "signature", "signature_version", "format_snapshot", "format_config_snapshot", "movements_snapshot", "display_name", "first_seen_at")
      VALUES (NEW."gym_id", v_benchmark_id, v_signature, 1, v_type, v_format_config, v_movements, v_name, NEW."logged_at")
      ON CONFLICT ("gym_id", "benchmark_id") WHERE "benchmark_id" IS NOT NULL
      DO UPDATE SET "id" = "performance_identities"."id"
      RETURNING "id" INTO v_identity_id;
    ELSIF v_signature IS NOT NULL THEN
      INSERT INTO "public"."performance_identities"
        ("gym_id", "benchmark_id", "signature", "signature_version", "format_snapshot", "format_config_snapshot", "movements_snapshot", "display_name", "first_seen_at")
      VALUES (NEW."gym_id", NULL, v_signature, 1, v_type, v_format_config, v_movements, v_name, NEW."logged_at")
      ON CONFLICT ("gym_id", "signature") WHERE "benchmark_id" IS NULL
      DO UPDATE SET "id" = "performance_identities"."id"
      RETURNING "id" INTO v_identity_id;
    ELSE
      v_identity_id := NULL;
    END IF;
    NEW."performance_identity_id" := v_identity_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."snapshot_skill_log_context"() IS 'skill_logs'' own version of snapshot_wod_log_context - slot-aware (Skill vs Skill 2 each has its own name/type/config/movements on wods). SECURITY DEFINER since Slice 4.';
