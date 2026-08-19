-- Canonical Movement Identity, Phase 1 (Result-Side Movement Identity
-- Resolution). Extends the existing, live `movements` catalog (Coach
-- Quick Create Phase 1 + Movement Catalog Consolidation - 465 seeded
-- rows, global gym_id-null tier + gym-scoped tier, `aliases[]`, RLS
-- already correct) to reach Results for the first time - see
-- CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md §5, §7's own explicit
-- decision: additive `sets_movement_ids jsonb` map on `wod_logs`/
-- `skill_logs`, keyed identically to the row's own `sets` column, never a
-- single `movement_id` column (a Result can carry multiple movements).
--
-- The raw `sets` object keys remain the PERMANENT, immutable historical
-- display truth (Results Phase 2 Slice 2's own precedent) - this map is a
-- pure, additive enrichment a reader consults ALONGSIDE `sets`, never
-- instead of it. A member/coach never sends this field; it is computed
-- exclusively server-side by the triggers below and unconditionally
-- overwrites whatever (if anything) a client payload happens to include,
-- which is the entire DB-integrity story here (mission §13/§54) - there
-- is no path by which a forged UUID could ever reach this column, since
-- nothing but `resolve_movement_id()`'s own return value is ever assigned
-- to it.

alter table "public"."wod_logs" add column "sets_movement_ids" jsonb;
alter table "public"."skill_logs" add column "sets_movement_ids" jsonb;

comment on column "public"."wod_logs"."sets_movement_ids" is 'Canonical Movement Identity Phase 1 - additive, nullable, server-resolved map from a `sets` key to its resolved `movements.id` (or JSON null if unresolved). Keys always match `sets`''s own keys exactly - never a dangling key. Legacy rows and rows whose format is not movement-keyed (per MOVEMENT_KEYED_FORMATS) are NULL. Never migrate Movement History/PR Engine to read this yet - see CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md.';
comment on column "public"."skill_logs"."sets_movement_ids" is 'skill_logs'' own version of wod_logs.sets_movement_ids - see that column''s comment. Non-Superset skill formats pool every sets key under the row''s own skill_name_snapshot (mirrors Phase 2''s extractMovementEntriesFromSkillLogs pooling rule exactly, not a new behavior).';

-- Deterministic resolver against the real `movements` catalog table -
-- the FIRST resolver in this codebase that actually queries `movements`
-- by id (the pre-existing edge-function resolveCanonicalMovement() in
-- analyze-workout/movementCatalog.ts operates on a separate, hardcoded,
-- non-DB-backed list for a different purpose - AI-output display-text
-- cleanup, never identity - see CANONICAL_MOVEMENT_IDENTITY_CURRENT_STATE_AUDIT.md
-- §4; this is not a second resolver competing with an existing one, it is
-- the first resolver for this specific, previously-unaddressed job).
--
-- Order (CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md §4): exact
-- canonical name -> exact alias -> one safe, narrow normalization (strip
-- a single leading "N " numeral prefix, e.g. "1 Squat clean") -> each
-- tier re-tried after normalization -> unresolved. Every tier requires
-- EXACTLY ONE distinct match; more than one is ambiguous and returns
-- NULL rather than guessing (mission §7/§30/MI-6) - never a fuzzy/
-- edit-distance step of any kind. Gym-scoped: only `gym_id IS NULL`
-- (platform) or `gym_id = p_gym_id` (this Result's own gym) rows are ever
-- visible to the lookup, so a different gym's custom movement can never
-- resolve here (mission §14/§31/MI-9) - enforced structurally by the
-- WHERE clause itself, not by a separate check.
create or replace function "public"."resolve_movement_id"("p_raw_name" text, "p_gym_id" uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_name text := trim(regexp_replace(coalesce(p_raw_name, ''), '\s+', ' ', 'g'));
  v_stripped text;
  v_ids uuid[];
begin
  if v_name = '' then
    return null;
  end if;

  -- Tier 1: exact canonical name, case-insensitive.
  select array_agg(distinct "id") into v_ids
  from "public"."movements"
  where ("gym_id" is null or "gym_id" = p_gym_id) and lower("name") = lower(v_name);
  if array_length(v_ids, 1) = 1 then return v_ids[1]; end if;
  if array_length(v_ids, 1) > 1 then return null; end if;

  -- Tier 2: exact approved alias, case-insensitive.
  select array_agg(distinct "id") into v_ids
  from "public"."movements"
  where ("gym_id" is null or "gym_id" = p_gym_id)
    and lower(v_name) = any (select lower(a) from unnest("aliases") a);
  if array_length(v_ids, 1) = 1 then return v_ids[1]; end if;
  if array_length(v_ids, 1) > 1 then return null; end if;

  -- Tier 3: the one Phase-0-approved safe normalization (leading numeral
  -- prefix strip), re-trying name then alias. Only attempted when the
  -- strip actually changes something, to avoid a pointless repeat query.
  v_stripped := regexp_replace(v_name, '^\d+\s+', '');
  if v_stripped <> v_name and v_stripped <> '' then
    select array_agg(distinct "id") into v_ids
    from "public"."movements"
    where ("gym_id" is null or "gym_id" = p_gym_id) and lower("name") = lower(v_stripped);
    if array_length(v_ids, 1) = 1 then return v_ids[1]; end if;
    if array_length(v_ids, 1) > 1 then return null; end if;

    select array_agg(distinct "id") into v_ids
    from "public"."movements"
    where ("gym_id" is null or "gym_id" = p_gym_id)
      and lower(v_stripped) = any (select lower(a) from unnest("aliases") a);
    if array_length(v_ids, 1) = 1 then return v_ids[1]; end if;
    if array_length(v_ids, 1) > 1 then return null; end if;
  end if;

  return null;
end;
$function$;

comment on function "public"."resolve_movement_id"(text, uuid) is 'Canonical Movement Identity Phase 1 - the one deterministic movement-name-to-UUID resolver, gym-scoped, no fuzzy matching, ambiguous match returns NULL. Consumed by wod_logs/skill_logs snapshot triggers only - not called from either client, and not intended to be.';

-- wod_logs: a NEW, separate trigger, deliberately not folded into
-- snapshot_wod_log_context() (which only fires BEFORE INSERT OR UPDATE OF
-- "wod_id" - by design, so format_snapshot/wod_name_snapshot/etc. stay
-- frozen across a later score/notes edit, per Results Phase 2 Slice 2's
-- own "never re-fires on an unrelated field edit" invariant). Movement
-- identity has the OPPOSITE requirement: an edit to `sets` (e.g. a member
-- correcting a mistyped movement name, or a coach editing weight/reps
-- within an existing key - composeWodLogFields always resends the WHOLE
-- `sets` object on any sets-family log edit, see App.jsx's saveWodLog)
-- must re-resolve, while the OTHER snapshot fields it does not touch must
-- stay exactly as frozen. Folding this into snapshot_wod_log_context()
-- would force it to also listen on "sets", which would then ALSO
-- re-derive wod_name_snapshot/format_snapshot/etc. from current `wods`/
-- `workout_sections` state on every sets-only edit - a real regression of
-- that trigger's own immutability guarantee. Hence: a second, narrowly-
-- scoped trigger, firing on a different column, touching only this one
-- new field.
--
-- Fires BEFORE INSERT OR UPDATE OF "sets" - INSERT always fires
-- regardless of the column list; UPDATE fires only when a statement's SET
-- clause actually includes `sets` (true for every sets-family wod_logs
-- write in this codebase today).
--
-- Ordering: on INSERT, this must run AFTER snapshot_wod_log_context_trg
-- has already set NEW.format_snapshot, since the movement-keyed gate
-- below reads it. Postgres fires same-event BEFORE triggers in
-- alphabetical order by trigger name (see 20260813100200's own header
-- comment for this exact, already-established reasoning) -
-- "snapshot_wod_log_movement_ids_trg" sorts after
-- "snapshot_wod_log_context_trg" ('m' > 'c' at the first differing
-- character), guaranteeing the required order without a second,
-- fragile cross-trigger dependency mechanism. On an UPDATE OF "sets" that
-- does NOT also touch "wod_id", snapshot_wod_log_context_trg does not
-- fire at all - NEW.format_snapshot is then simply inherited unchanged
-- from the existing row (Postgres UPDATE semantics), which is exactly the
-- already-frozen value this trigger is supposed to read.
create or replace function "public"."snapshot_wod_log_movement_ids"()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only formats Phase 2's own extractMovementEntriesFromWodLogs already
  -- treats as movement-keyed (movementHistory.js/.ts's
  -- MOVEMENT_KEYED_FORMATS) - every other format's `sets` keys are
  -- round/interval labels ("Rundă N", "Min N") or entirely absent, never
  -- movement text, and must never be run through the resolver (mission
  -- §40-42's own explicit adversarial case, confirmed live in
  -- CANONICAL_MOVEMENT_IDENTITY_CURRENT_STATE_AUDIT.md §3a/§3c).
  if new."format_snapshot" = any (array['Weightlifting', 'Strength Sets', 'Build to Heavy/1RM', 'Superset'])
     and new."sets" is not null and jsonb_typeof(new."sets") = 'object' then
    select jsonb_object_agg(k, "public"."resolve_movement_id"(k, new."gym_id"))
      into new."sets_movement_ids"
    from jsonb_object_keys(new."sets") as k;
  else
    new."sets_movement_ids" := null;
  end if;
  return new;
end;
$function$;

comment on function "public"."snapshot_wod_log_movement_ids"() is 'Canonical Movement Identity Phase 1 - resolves wod_logs.sets_movement_ids. Deliberately separate from snapshot_wod_log_context() - see this function''s own header comment in the migration for why.';

create or replace trigger "snapshot_wod_log_movement_ids_trg"
    before insert or update of "sets" on "public"."wod_logs"
    for each row execute function "public"."snapshot_wod_log_movement_ids"();

-- skill_logs: folded directly into the EXISTING snapshot_skill_log_context()
-- (unlike wod_logs, no separate trigger needed) - skill_logs is always
-- written via `.upsert(..., { onConflict: 'member_id,wod_id,slot' })`
-- (App.jsx's saveSkillLog), whose payload always includes `wod_id` in the
-- ON CONFLICT DO UPDATE SET list (it's part of the conflict target
-- itself), so the existing "BEFORE INSERT OR UPDATE OF wod_id" trigger
-- already re-fires on every skill-log save, new or edited - there is no
-- "frozen across an unrelated edit" concern to protect here the way
-- wod_logs has, since format_snapshot/skill_name_snapshot are themselves
-- already recomputed on every skill_logs upsert today.
--
-- Movement-keying rule mirrors Phase 2's own extractMovementEntriesFromSkillLogs
-- EXACTLY (mission §41's own explicit warning against inventing a new
-- rule): only format_snapshot='Superset' treats each `sets` key as its
-- own movement name. Every other skill format (including Weightlifting -
-- the real, disclosed Phase 5 case of 3 different chained movements
-- pooled under one skill_name_snapshot) resolves ONE movement identity,
-- from the row's own skill_name_snapshot, and repeats that SAME resolved
-- value under every key in the map - deliberately reproducing, not
-- fighting, Phase 2's already-shipped pooling behavior, so a future
-- Movement History reader's per-key lookup agrees with what it already
-- groups these entries as today.
create or replace function "public"."snapshot_skill_log_context"() returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  IF NEW."sets" IS NOT NULL AND jsonb_typeof(NEW."sets") = 'object' THEN
    IF NEW."format_snapshot" = 'Superset' THEN
      SELECT jsonb_object_agg(k, "public"."resolve_movement_id"(k, NEW."gym_id"))
        INTO NEW."sets_movement_ids"
      FROM jsonb_object_keys(NEW."sets") AS k;
    ELSE
      SELECT jsonb_object_agg(k, "public"."resolve_movement_id"(NEW."skill_name_snapshot", NEW."gym_id"))
        INTO NEW."sets_movement_ids"
      FROM jsonb_object_keys(NEW."sets") AS k;
    END IF;
  ELSE
    NEW."sets_movement_ids" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

comment on function "public"."snapshot_skill_log_context"() is 'skill_logs'' own version of snapshot_wod_log_context - slot-aware (Skill vs Skill 2 each has its own name/type/config/movements on wods). SECURITY DEFINER since Slice 4. Canonical Movement Identity Phase 1 - also resolves sets_movement_ids (Superset = per-key, every other format = pooled under skill_name_snapshot, mirroring Phase 2''s own extraction rule).';
