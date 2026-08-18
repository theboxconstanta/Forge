-- Member Performance, Phase 5 (PR Engine Hardening) - reconciliation
-- foundation: a nullable `voided_at` marker on `pr_events`, plus the
-- shared helper and DELETE-side triggers that use it.
--
-- CONFIRMED REAL GAP (MEMBER_PERFORMANCE_PHASE5_PR_ENGINE_HARDENING_
-- IMPLEMENTATION_REPORT.md, "Current Best" section): `movement_pr_events_
-- current`/`benchmark_pr_events_current` derive "current best" from
-- `pr_events.score_value` directly - a value frozen forever at INSERT
-- time. Editing the source Result's score downward, or deleting it
-- entirely (`source_wod_log_id`/`source_skill_log_id` are `ON DELETE SET
-- NULL`, never CASCADE, by original Slice 3 design - the event survives),
-- previously left the stale/orphaned event as "current best" forever,
-- with no mechanism to ever correct that.
--
-- Chosen model (of the four evaluated in the mission's own "Event
-- Immutability vs Correction" section): mark voided, not update/delete
-- event CONTENT. `score_value`/`movement`/`occurred_at`/etc. on an
-- existing row are NEVER changed by this or any later migration - the
-- ledger's own "what actually happened, when" record stays exactly as
-- historically true. `voided_at` adds a SEPARATE, additive status signal
-- ("is this event still trustworthy for CURRENT-BEST purposes"), set
-- exactly once, only by the reconciliation path below, only when the
-- event's own source Result has since changed value or been deleted.
-- This is a deliberate, disclosed evolution of the original comment
-- "Never UPDATEd... by any application code path" - that invariant now
-- means "event CONTENT is immutable", not "the row can never gain a
-- status flag".
--
-- `void_stale_pr_events` is the single shared function both the movement
-- and benchmark evaluation triggers (next two migrations) call before
-- re-evaluating an UPDATEd Result, and that the two new BEFORE DELETE
-- triggers here call directly - one implementation, not two independently
-- maintained copies (mission's own "comparator/logic parity" caution).

ALTER TABLE "public"."pr_events" ADD COLUMN IF NOT EXISTS "voided_at" timestamptz;

COMMENT ON COLUMN "public"."pr_events"."voided_at" IS 'Member Performance Phase 5 - set (once, never cleared) when this event''s own source Result has since changed value or been deleted, making the event no longer trustworthy for CURRENT-BEST derivation. The row''s own historical content (score_value, occurred_at, etc.) is never modified - this is an additive status flag, not a rewrite. NULL means still valid.';

CREATE INDEX IF NOT EXISTS "pr_events_voided_at_idx" ON "public"."pr_events" ("voided_at") WHERE "voided_at" IS NULL;

CREATE OR REPLACE FUNCTION "public"."void_stale_pr_events"("p_source_wod_log_id" uuid, "p_source_skill_log_id" uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE "public"."pr_events"
    SET "voided_at" = now()
    WHERE "voided_at" IS NULL
      AND (
        ("p_source_wod_log_id" IS NOT NULL AND "source_wod_log_id" = "p_source_wod_log_id")
        OR ("p_source_skill_log_id" IS NOT NULL AND "source_skill_log_id" = "p_source_skill_log_id")
      );
END;
$$;

COMMENT ON FUNCTION "public"."void_stale_pr_events"(uuid, uuid) IS 'Member Performance Phase 5 - marks any still-valid pr_events row sourced from the given wod_logs/skill_logs id as voided (score changed or source deleted). Shared by the movement/benchmark evaluation triggers'' own UPDATE path and the DELETE triggers below - the one place this logic lives.';

-- BEFORE DELETE (not AFTER) - deliberately, so this runs before the
-- existing `ON DELETE SET NULL` FK action nulls `source_wod_log_id`/
-- `source_skill_log_id` on any dependent pr_events row, guaranteeing
-- `OLD.id` still matches those columns' current values at the moment this
-- trigger's lookup runs (an AFTER DELETE trigger racing the FK's own
-- implicit action would be a real, subtle correctness risk here - not
-- theoretical, the FK action and a same-table AFTER trigger are not
-- guaranteed to be ordered the way a reader might assume).
CREATE OR REPLACE FUNCTION "public"."void_pr_events_on_wod_log_delete"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    BEGIN
        PERFORM "public"."void_stale_pr_events"(OLD.id, NULL);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'void_pr_events_on_wod_log_delete failed for wod_logs.id=%: %', OLD.id, SQLERRM;
    END;
    RETURN OLD;
END;
$$;

COMMENT ON FUNCTION "public"."void_pr_events_on_wod_log_delete"() IS 'Member Performance Phase 5 - BEFORE DELETE on wod_logs. Voids any pr_events row this Result sourced, before the FK''s own ON DELETE SET NULL action fires. Never blocks the underlying delete (EXCEPTION WHEN OTHERS).';

CREATE OR REPLACE TRIGGER "void_pr_events_before_wod_log_delete_trg"
    BEFORE DELETE ON "public"."wod_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."void_pr_events_on_wod_log_delete"();

CREATE OR REPLACE FUNCTION "public"."void_pr_events_on_skill_log_delete"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    BEGIN
        PERFORM "public"."void_stale_pr_events"(NULL, OLD.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'void_pr_events_on_skill_log_delete failed for skill_logs.id=%: %', OLD.id, SQLERRM;
    END;
    RETURN OLD;
END;
$$;

COMMENT ON FUNCTION "public"."void_pr_events_on_skill_log_delete"() IS 'Member Performance Phase 5 - BEFORE DELETE on skill_logs. Same reasoning as void_pr_events_on_wod_log_delete.';

CREATE OR REPLACE TRIGGER "void_pr_events_before_skill_log_delete_trg"
    BEFORE DELETE ON "public"."skill_logs"
    FOR EACH ROW EXECUTE FUNCTION "public"."void_pr_events_on_skill_log_delete"();
