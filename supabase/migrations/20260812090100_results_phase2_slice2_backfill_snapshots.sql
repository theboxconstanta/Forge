-- Results Phase 2, Slice 2: stable Result identity, step 2 of 4 - backfill.
--
-- Populates the snapshot columns (previous migration) for every EXISTING
-- wod_logs/skill_logs row from its still-intact `wods` link, before the
-- FK correction (migration 4 of this slice) changes what happens when
-- that link's target is later deleted. Every row backfilled here today
-- has wod_id IS NOT NULL by construction (a still-cascading FK cannot
-- have produced an orphaned reference) - this is a one-time historical
-- catch-up, not an ongoing mechanism (the trigger in migration 3 handles
-- every future write automatically).
--
-- Uses resolve_benchmark_names (Slice 1) directly - the same canonical
-- resolution every client already calls, not a separate migration-only
-- guess at benchmark identity.
--
-- skill_logs is split into two UPDATEs, one per slot, rather than one
-- UPDATE with a CASE inside the LATERAL join's own arguments - Postgres
-- does not allow a LATERAL subquery to reference the UPDATE target's own
-- alias (confirmed live: "invalid reference to FROM-clause entry for
-- table sl", SQLSTATE 42P10, on the first attempt at this migration).
-- Two straightforward, slot-fixed UPDATEs sidestep that restriction
-- entirely rather than working around it with a more convoluted single
-- statement.

UPDATE "public"."wod_logs" wl
SET
    "wod_name_snapshot" = w."name",
    "format_snapshot" = w."type",
    "format_config_snapshot" = w."format_config",
    "benchmark_id" = rb."benchmark_id"
FROM "public"."wods" w
LEFT JOIN LATERAL "public"."resolve_benchmark_names"(ARRAY[w."name"]) rb ON true
WHERE wl."wod_id" = w."id";

UPDATE "public"."skill_logs" sl
SET
    "skill_name_snapshot" = w."skill_name",
    "format_snapshot" = w."skill_type",
    "format_config_snapshot" = w."skill_format_config",
    "benchmark_id" = rb."benchmark_id"
FROM "public"."wods" w
LEFT JOIN LATERAL "public"."resolve_benchmark_names"(ARRAY[w."skill_name"]) rb ON true
WHERE sl."wod_id" = w."id" AND sl."slot" = 1;

UPDATE "public"."skill_logs" sl
SET
    "skill_name_snapshot" = w."skill2_name",
    "format_snapshot" = w."skill2_type",
    "format_config_snapshot" = w."skill2_format_config",
    "benchmark_id" = rb."benchmark_id"
FROM "public"."wods" w
LEFT JOIN LATERAL "public"."resolve_benchmark_names"(ARRAY[w."skill2_name"]) rb ON true
WHERE sl."wod_id" = w."id" AND sl."slot" = 2;
