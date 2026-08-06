-- Results Phase 2, Slice 4: Performance Identity & Universal Workout
-- Progression.
--
-- Introduces `performance_identities` - the generalization Slice 1's
-- `benchmarks` table was always a special case of, per this slice's own
-- mission: "Benchmark Identity becomes a special case of Performance
-- Identity." A row here represents ONE recognizably-repeatable workout,
-- resolved either from a Benchmark match (best case - already alias/
-- normalization-aware via resolve_benchmark_names, Slice 1) or from a
-- structural/textual Signature V1 (this slice's own new mechanism, see
-- migration 20260813100100) when no Benchmark match exists.
--
-- Two mutually-exclusive resolution paths, enforced by two partial unique
-- indexes rather than one column pair, because a benchmark-identified row
-- and a signature-identified row have different real-world uniqueness
-- rules: two DIFFERENTLY-WORDED logs of the same recognized Benchmark
-- must collapse to ONE identity (keyed by benchmark_id, alias-aware);
-- two structurally-IDENTICAL-text unrecognized workouts must also
-- collapse to ONE identity (keyed by signature) - but a benchmark match
-- always wins over a signature when both could apply (resolution order
-- enforced in the trigger, migration 20260813100200, not here).
--
-- `signature_version` exists specifically so Signature V1 (structural/
-- textual - format + format_config + normalized raw movement-line text,
-- approved this session after live data showed 0/320 movement elements
-- anywhere in production have populated canonicalName/reps/weight,
-- despite a real, tested AI-parsing pipeline existing) can be swapped
-- for a future canonical-movement Signature V2 (after a dedicated
-- Programming backfill project - explicitly NOT this slice's job) without
-- an identity-table redesign - a V2 pass can re-derive signatures,
-- write signature_version=2, and this table's own shape never changes.
--
-- SELECT-only RLS (gym-scoped), matching pr_events' own append-only
-- trust model exactly (Slice 3) - no client ever gets to fabricate or
-- rename a Performance Identity directly; only the SECURITY DEFINER
-- snapshot triggers (migration 20260813100200) can write here.

CREATE TABLE IF NOT EXISTS "public"."performance_identities" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "gym_id" uuid NOT NULL REFERENCES "public"."gyms"("id"),
    "benchmark_id" uuid REFERENCES "public"."benchmarks"("id"),

    -- Signature V1 (see migration 20260813100100's own function). NULL
    -- only when benchmark_id is set AND the underlying content was too
    -- sparse to sign (both paths failing at once means no identity row
    -- would exist at all - kept nullable for schema honesty, not because
    -- a real row is expected to ever have both null).
    "signature" text,
    "signature_version" smallint NOT NULL DEFAULT 1,

    -- The first-seen shape, kept purely for display/debugging (e.g. "what
    -- does identity X actually look like") - never re-derived from this;
    -- the per-Result Scoring Snapshot (wod_logs/skill_logs) remains each
    -- Result's own source of truth, per Slice 2's already-frozen model.
    "display_name" text,
    "format_snapshot" text,
    "format_config_snapshot" jsonb,
    "movements_snapshot" jsonb,

    "first_seen_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "performance_identities_has_key" CHECK (
        "benchmark_id" IS NOT NULL OR "signature" IS NOT NULL
    )
);

COMMENT ON TABLE "public"."performance_identities" IS 'Performance Identity registry (RESULTS_PHASE2_SLICE4). Benchmark Identity (Slice 1) is the preferred, alias-aware special case; Signature V1 (structural/textual, migration 20260813100100) is the fallback for any other repeated workout. Written only by the SECURITY DEFINER snapshot triggers - never directly by a client.';

CREATE UNIQUE INDEX "performance_identities_gym_benchmark_key"
    ON "public"."performance_identities" ("gym_id", "benchmark_id")
    WHERE "benchmark_id" IS NOT NULL;

CREATE UNIQUE INDEX "performance_identities_gym_signature_key"
    ON "public"."performance_identities" ("gym_id", "signature")
    WHERE "benchmark_id" IS NULL;

CREATE INDEX "performance_identities_gym_id_idx" ON "public"."performance_identities" ("gym_id");

ALTER TABLE "public"."performance_identities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "performance_identities_select_all" ON "public"."performance_identities"
    FOR SELECT TO "authenticated"
    USING ("gym_id" = "public"."my_gym_id"());

GRANT SELECT ON TABLE "public"."performance_identities" TO "authenticated";
