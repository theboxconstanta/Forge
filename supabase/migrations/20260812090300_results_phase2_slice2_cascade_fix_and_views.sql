-- Results Phase 2, Slice 2: stable Result identity, step 4 of 4 - the
-- cascade-delete correction itself, plus the shared read path.
--
-- This is the single highest-priority correction named repeatedly across
-- RESULTS_DOMAIN_ARCHITECTURE.md Section 5, RESULTS_PHASE1_IMPLEMENTATION_
-- REPORT_FINAL.md, and RESULTS_PHASE2_IMPLEMENTATION_PLAN.md Section 14.4:
-- deleting a `wods` row must never destroy the athlete Results logged
-- against it. `wod_id` becomes a permanent-identity reference that can go
-- NULL (a tombstone, matching Programming's own already-frozen content-
-- stability contract - PROGRAMMING_DOMAIN_ARCHITECTURE.md Section 3:
-- "must resolve to 'this content used to exist and has been withdrawn,'
-- never to nothing at all") rather than taking the Result row down with
-- it. Safe to apply now specifically because the previous three
-- migrations in this slice already guarantee every row - existing
-- (backfilled) and future (trigger-captured) - has its own frozen
-- Scoring Snapshot to fall back on the moment this happens.
--
-- Mirrors the exact pattern `workout_section_id` already proved safe in
-- production (migration 20260716120000_logs_workout_section_link.sql) -
-- not a new, unproven mechanism.

ALTER TABLE "public"."wod_logs" DROP CONSTRAINT "wod_logs_wod_id_fkey";
ALTER TABLE "public"."wod_logs"
    ADD CONSTRAINT "wod_logs_wod_id_fkey" FOREIGN KEY ("wod_id") REFERENCES "public"."wods"("id") ON DELETE SET NULL;

ALTER TABLE "public"."skill_logs" DROP CONSTRAINT "skill_logs_wod_id_fkey";
ALTER TABLE "public"."skill_logs"
    ADD CONSTRAINT "skill_logs_wod_id_fkey" FOREIGN KEY ("wod_id") REFERENCES "public"."wods"("id") ON DELETE SET NULL;

-- The shared read path this slice's own mission calls for ("Create the
-- canonical Result identity service that future slices can reuse...
-- PR engine, Benchmark progression, Analytics aggregation, Dashboard,
-- Coach tools"): one COALESCE between the live `wods` join (when it still
-- exists) and the frozen snapshot (when it doesn't), so no future
-- consumer has to reconstruct that fallback logic itself, or risk getting
-- it wrong. `security_invoker = true` is required, explicitly, not
-- optional - without it this view would evaluate RLS as its own OWNER
-- (whichever role runs migrations, effectively unrestricted), not as
-- whichever real user queries it, silently defeating every gym-scoping
-- policy on the underlying tables.
CREATE OR REPLACE VIEW "public"."wod_logs_with_context"
WITH (security_invoker = true) AS
SELECT
    wl.*,
    COALESCE(w."name", wl."wod_name_snapshot") AS "effective_wod_name",
    COALESCE(w."type", wl."format_snapshot") AS "effective_format",
    COALESCE(w."format_config", wl."format_config_snapshot") AS "effective_format_config",
    (wl."wod_id" IS NULL AND wl."wod_name_snapshot" IS NOT NULL) AS "workout_deleted"
FROM "public"."wod_logs" wl
LEFT JOIN "public"."wods" w ON w."id" = wl."wod_id";

COMMENT ON VIEW "public"."wod_logs_with_context" IS 'The canonical read path for a wod_logs row''s Workout context - COALESCEs the live wods join with the frozen Scoring Snapshot, so callers never need their own fallback logic. workout_deleted distinguishes "was linked, Workout since removed" from "was always a free/standalone log" (wod_id NULL with no snapshot either).';

CREATE OR REPLACE VIEW "public"."skill_logs_with_context"
WITH (security_invoker = true) AS
SELECT
    sl.*,
    COALESCE(
        CASE WHEN sl."slot" = 2 THEN w."skill2_name" ELSE w."skill_name" END,
        sl."skill_name_snapshot"
    ) AS "effective_skill_name",
    COALESCE(
        CASE WHEN sl."slot" = 2 THEN w."skill2_type" ELSE w."skill_type" END,
        sl."format_snapshot"
    ) AS "effective_format",
    COALESCE(
        CASE WHEN sl."slot" = 2 THEN w."skill2_format_config" ELSE w."skill_format_config" END,
        sl."format_config_snapshot"
    ) AS "effective_format_config",
    (sl."wod_id" IS NULL AND sl."skill_name_snapshot" IS NOT NULL) AS "workout_deleted"
FROM "public"."skill_logs" sl
LEFT JOIN "public"."wods" w ON w."id" = sl."wod_id";

COMMENT ON VIEW "public"."skill_logs_with_context" IS 'skill_logs'' own version of wod_logs_with_context, slot-aware.';

GRANT SELECT ON TABLE "public"."wod_logs_with_context" TO "authenticated";
GRANT SELECT ON TABLE "public"."skill_logs_with_context" TO "authenticated";
