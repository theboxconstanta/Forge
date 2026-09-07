-- CANONICAL STRENGTH RESULT INTELLIGENCE, Phase E (section 18) -
-- movement_pr_events_current no-bridge correction.
--
-- CONFIRMED GAP (forensic, this phase's own audit): Canonical Movement
-- Identity Phase 3 (20260824090000) added `pr_events.movement_id` and
-- rewrote the WRITE-side trigger (evaluate_movement_prs) to a strict
-- no-bridge policy - a canonical candidate (movement_id IS NOT NULL) is
-- matched against prior pr_events ONLY by movement_id, NEVER by text,
-- NEVER unioned with personal_records. That migration explicitly did NOT
-- touch this READ-side view (20260813090400), which still groups
-- "current PR" purely by `DISTINCT ON (member_id, movement, rep_scheme)`
-- - TEXT only, no movement_id at all. Left as-is, a member with BOTH a
-- canonical pr_events row (movement_id set, e.g. a NEW correctly-resolved
-- "Front Squat" log) and a legacy pr_events/personal_records row for the
-- SAME movement text (movement_id null, e.g. an OLD pre-Phase-1 log)
-- would have those two silently merged into ONE "current best" here,
-- picking whichever value is higher - exactly the text-based bridging the
-- write-side policy was built to prevent, just moved to the read side.
--
-- No client queries this view today (verified: zero matches for
-- `movement_pr_events_current` in src/ or forge-admin-web/src, beyond a
-- single explanatory comment) - the migration that created it explicitly
-- built it for FUTURE readers (PWA Personal Records, Admin Athlete
-- Results, a future Dashboard). This fix closes the gap before any of
-- those readers exist, rather than leaving a landmine for whichever one
-- ships first.
--
-- FIX (smallest additive change, per the mission's own instruction):
-- split the single DISTINCT-ON into two independently-computed streams,
-- exactly mirroring the write-side's own separation -
--   canonical_best: DISTINCT ON (member_id, movement_id, rep_scheme),
--     scoped to rows WHERE movement_id IS NOT NULL (pr_events only -
--     personal_records never carries a movement_id, by construction).
--   legacy_best: DISTINCT ON (member_id, movement, rep_scheme), scoped to
--     rows WHERE movement_id IS NULL - BYTE-IDENTICAL to the view's
--     previous full behavior, restricted to legacy rows only.
-- UNION ALL of the two, never a single cross-stream DISTINCT ON. Adds one
-- new `movement_id` output column, APPENDED LAST (Postgres' CREATE OR
-- REPLACE VIEW forbids reordering/renaming existing output columns -
-- 42P16 - so every pre-existing column keeps its exact original name and
-- ordinal position; this is backward compatible with a hypothetical
-- existing consumer selecting the old columns by name or position).
--
-- Known, disclosed consequence (the SAME accepted trade-off Phase 3's own
-- write-side migration already made, now also true here): a member with
-- both a canonical and a legacy PR for "the same" movement by name will
-- see TWO separate "current best" rows from this view (one per stream),
-- not one merged row - visible fragmentation during the transition,
-- safer than silently guessing they are the same movement. Additive,
-- rollback-safe (CREATE OR REPLACE VIEW).

CREATE OR REPLACE VIEW "public"."movement_pr_events_current"
WITH (security_invoker = true) AS
WITH "combined" AS (
    SELECT
        "member_id", "gym_id", "movement", "rep_scheme",
        "score_value" AS "value_kg", "occurred_at",
        'pr_events'::text AS "source", "id" AS "source_id",
        "movement_id"
    FROM "public"."pr_events"
    WHERE "pr_type" = 'movement' AND "voided_at" IS NULL

    UNION ALL

    SELECT
        "pr"."member_id", "pr"."gym_id", "pr"."movement",
        COALESCE("pr"."reps", 1) AS "rep_scheme",
        "public"."slice3_convert_weight"("pr"."value", "pr"."unit", 'kg') AS "value_kg",
        "pr"."recorded_at" AS "occurred_at",
        'personal_records'::text AS "source", "pr"."id" AS "source_id",
        NULL::uuid AS "movement_id"
    FROM "public"."personal_records" "pr"
    WHERE "pr"."unit" IN ('kg', 'lbs') AND "pr"."value" IS NOT NULL
),
-- Canonical stream - matched ONLY by movement_id, never by text, never
-- unioned with personal_records (which never has one). Mirrors
-- evaluate_movement_prs's own canonical-candidate query exactly.
"canonical_best" AS (
    SELECT DISTINCT ON ("member_id", "movement_id", "rep_scheme")
        "member_id", "gym_id", "movement", "rep_scheme", "value_kg", "occurred_at", "source", "source_id", "movement_id"
    FROM "combined"
    WHERE "movement_id" IS NOT NULL AND "value_kg" IS NOT NULL
    ORDER BY "member_id", "movement_id", "rep_scheme", "value_kg" DESC, "occurred_at" DESC
),
-- Legacy stream - matched by text, restricted to movement_id IS NULL rows
-- only (byte-identical to this view's previous full behavior, applied
-- here to legacy rows exclusively).
"legacy_best" AS (
    SELECT DISTINCT ON ("member_id", "movement", "rep_scheme")
        "member_id", "gym_id", "movement", "rep_scheme", "value_kg", "occurred_at", "source", "source_id", "movement_id"
    FROM "combined"
    WHERE "movement_id" IS NULL AND "value_kg" IS NOT NULL
    ORDER BY "member_id", "movement", "rep_scheme", "value_kg" DESC, "occurred_at" DESC
)
SELECT * FROM "canonical_best"
UNION ALL
SELECT * FROM "legacy_best";

COMMENT ON VIEW "public"."movement_pr_events_current" IS 'Derived "current Movement PR" per (member, movement identity, rep_scheme) - the higher of pr_events (Slice 3) and personal_records (pre-existing), kg-canonical. Canonical Movement Identity Phase 3 (read-side, 20260907090000): a canonical row (movement_id set) is matched ONLY by movement_id; a legacy row (movement_id null, incl. every personal_records row) is matched by movement text - the two streams are computed independently and UNIONed, never bridged by text. A member with both streams for "the same" movement by name sees two rows, not one merged row (accepted, disclosed fragmentation). Never stored, always computed (Architecture Section 8.5). Excludes voided pr_events rows.';

GRANT SELECT ON TABLE "public"."movement_pr_events_current" TO "authenticated";
