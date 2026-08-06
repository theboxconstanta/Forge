-- Results Phase 2, Slice 3: the PR Event Ledger.
--
-- Implements RESULTS_DOMAIN_ARCHITECTURE.md v1.0 Section 8's own already-
-- specified model: "PR Event | True entity (append-only) | The historical,
-- permanent record that a specific Result achieved a Personal Record at
-- the moment it was logged - a ledger entry, never rewritten." This is a
-- NEW table, not an extension of `personal_records` - Architecture Section
-- 8.5 already drew this exact line: `personal_records` remains the narrow,
-- explicit manual-attestation path; `pr_events` is the automatic-detection
-- ledger. "Current PR" is neither table alone - it is the derived best of
-- both (Slice 3's read-side views, next migration).
--
-- gym-wide SELECT from day one (`_select_all`, not `_select_own`) -
-- deliberately avoiding the exact gap Phase 1.1 had to retroactively patch
-- on `personal_records` (migration 20260810090000): a coach/Admin must be
-- able to see a roster's PRs without a second, later fix.
--
-- NO insert/update/delete grant to `authenticated` at all - the ledger's
-- entire append-only integrity depends on the evaluation functions
-- (next migrations) being the ONLY writer, via SECURITY DEFINER, so no
-- client can ever fabricate a self-serving PR event with a direct
-- `.insert()` call. This is a stricter model than personal_records
-- (which IS directly athlete-writable, by design - it is a manual
-- attestation) and is the correct, deliberate distinction between the
-- two tables' own trust models, not an oversight.

CREATE TABLE IF NOT EXISTS "public"."pr_events" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "gym_id" uuid NOT NULL REFERENCES "public"."gyms"("id"),
    "member_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
    "pr_type" text NOT NULL CHECK ("pr_type" IN ('movement', 'benchmark')),

    -- Movement PRs only (NULL for pr_type='benchmark'). Free text, matching
    -- personal_records.movement exactly - no structured Movement Library
    -- entity exists yet (FCKB's own research found Movement.canonicalName
    -- already null everywhere in Programming too; this is not a Slice 3
    -- gap to solve, it is an already-known, already-disclosed platform
    -- state this slice inherits, not reopens).
    "movement" text,
    "rep_scheme" integer,

    -- Benchmark PRs only (NULL for pr_type='movement'). References the
    -- permanent Benchmark identity (Slice 1) - never a copied name, so a
    -- later Benchmark rename/retirement never orphans this event's own
    -- meaning.
    "benchmark_id" uuid REFERENCES "public"."benchmarks"("id"),

    -- The Scaling tier this PR was achieved under (RX/Intermediate/
    -- Beginner/OnRamp) - reuses variant_level's own existing, already-live
    -- vocabulary verbatim. Does NOT attempt Architecture Section 9's
    -- eventual structured Scaling Context redesign - that is real, future,
    -- separate work this slice does not reopen.
    "scaling_context" text,

    "score_value" numeric NOT NULL,
    "score_unit" text NOT NULL,
    "previous_best_value" numeric,
    "previous_best_unit" text,
    "improvement_value" numeric,
    "improvement_percentage" numeric,
    "is_first_recorded" boolean NOT NULL DEFAULT false,

    -- The originating Result. Exactly one of these two is set, matching
    -- pr_type. ON DELETE SET NULL, never CASCADE - deliberately mirroring
    -- Slice 2's own wod_id correction: an athlete deleting their own log
    -- (or a future admin correction) must never destroy the PR Event that
    -- log already produced. This IS the ledger's own "recalculation-safe,
    -- never silently rewrite history" principle applied to its source
    -- link, not just to the wod_logs/skill_logs rows themselves.
    "source_wod_log_id" uuid REFERENCES "public"."wod_logs"("id") ON DELETE SET NULL,
    "source_skill_log_id" uuid REFERENCES "public"."skill_logs"("id") ON DELETE SET NULL,

    -- occurred_at is the source Result's own logged_at (when the PR was
    -- actually achieved); created_at is when this ledger row itself was
    -- written (normally the same instant, but named separately on
    -- purpose - a future reconciliation event, per this slice's own
    -- "create reconciliation events, do not silently rewrite history"
    -- principle, would have a created_at long after its occurred_at).
    "occurred_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "pr_events_movement_xor_benchmark" CHECK (
        ("pr_type" = 'movement' AND "movement" IS NOT NULL AND "benchmark_id" IS NULL)
        OR ("pr_type" = 'benchmark' AND "benchmark_id" IS NOT NULL AND "movement" IS NULL)
    ),
    CONSTRAINT "pr_events_exactly_one_source" CHECK (
        ("source_wod_log_id" IS NOT NULL AND "source_skill_log_id" IS NULL)
        OR ("source_wod_log_id" IS NULL AND "source_skill_log_id" IS NOT NULL)
    )
);

COMMENT ON TABLE "public"."pr_events" IS 'Append-only PR Event Ledger (RESULTS_DOMAIN_ARCHITECTURE.md Section 8, RESULTS_PHASE2_IMPLEMENTATION_PLAN.md Slice 3). Never UPDATEd or DELETEd by any application code path - only inserted by the SECURITY DEFINER evaluation functions in this slice''s later migrations.';

CREATE INDEX "pr_events_member_movement_idx" ON "public"."pr_events" ("member_id", "movement", "rep_scheme") WHERE "pr_type" = 'movement';
CREATE INDEX "pr_events_member_benchmark_idx" ON "public"."pr_events" ("member_id", "benchmark_id", "scaling_context") WHERE "pr_type" = 'benchmark';
CREATE INDEX "pr_events_gym_id_idx" ON "public"."pr_events" ("gym_id");
CREATE INDEX "pr_events_occurred_at_idx" ON "public"."pr_events" ("occurred_at");

ALTER TABLE "public"."pr_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pr_events_select_all" ON "public"."pr_events"
    FOR SELECT TO "authenticated"
    USING ("gym_id" = "public"."my_gym_id"());

CREATE OR REPLACE TRIGGER "prevent_gym_id_change_trg"
    BEFORE UPDATE ON "public"."pr_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_gym_id_change"();

GRANT SELECT ON TABLE "public"."pr_events" TO "authenticated";
