-- Member Performance, Phase 5 (PR Engine Hardening) - fixes a confirmed,
-- pre-existing, previously-untested Slice 3 bug: `pr_events_exactly_one_
-- source` required EXACTLY one of source_wod_log_id/source_skill_log_id
-- to be non-NULL - but the table's own `ON DELETE SET NULL` FK behavior
-- (deliberately chosen so a PR event survives its source Result being
-- deleted) sets that column to NULL on delete, leaving BOTH columns NULL
-- for a movement/benchmark PR whose only source was just removed. That
-- combination VIOLATED the CHECK constraint, meaning deleting ANY
-- wod_logs/skill_logs row that had ever sourced a pr_events row has been
-- broken since Slice 3's original migration - confirmed live this phase
-- (first real end-to-end delete test this constraint had ever seen).
--
-- Fix: relax to "at most one source", not "exactly one". A freshly
-- inserted event still must have exactly one (the INSERT statements in
-- evaluate_movement_prs/evaluate_benchmark_pr always set exactly one),
-- but a later DELETE of that source correctly leaves both NULL without
-- violating the schema - the event survives, orphaned but present, per
-- Slice 3's own original intent, now actually enforceable.

ALTER TABLE "public"."pr_events" DROP CONSTRAINT "pr_events_exactly_one_source";

ALTER TABLE "public"."pr_events" ADD CONSTRAINT "pr_events_at_most_one_source" CHECK (
    NOT ("source_wod_log_id" IS NOT NULL AND "source_skill_log_id" IS NOT NULL)
);

COMMENT ON CONSTRAINT "pr_events_at_most_one_source" ON "public"."pr_events" IS 'Member Performance Phase 5 - relaxed from "exactly one" (Slice 3 original): a PR event''s source Result can be deleted (ON DELETE SET NULL on both FKs), which correctly leaves both source columns NULL - the event survives (per Slice 3''s own "never CASCADE" design) but the CHECK constraint must permit that state. Still forbids both being set simultaneously.';
