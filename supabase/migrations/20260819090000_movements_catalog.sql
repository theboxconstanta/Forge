-- Coach Quick Create Phase 1 (Automatic Variant Generation) - the new
-- `movements` catalog table. Additive only, per the explicit product
-- decision made this session: `wods.movements_rx/intermediate/beginner/
-- onramp` stay `text[]` exactly as today (no Programming Domain data-model
-- rewrite) - this table exists purely to back autocomplete, AI-prompt
-- grounding, and a "Create New Movement" affordance, so a coach-typed
-- movement becomes available everywhere immediately without waiting on a
-- static-list redeploy. The three existing static lists (WOD-SIMPLE's
-- movements.js, forge-admin-web's movements.ts, the edge function's own
-- movementCatalog.ts) remain the zero-latency default source and are NOT
-- migrated into this table - it starts empty per gym and only grows from
-- "Create New Movement" going forward.
--
-- Same multi-tenant content-table shape as `wods` (is_coach_or_admin/
-- my_gym_id/prevent_gym_id_change), not the lookup-table shape of
-- workout_section_types/workout_scaling_levels (20260715180000) - those
-- are small, platform-seeded reference sets; this is coach-authored
-- content that grows per gym, closer in nature to `wods` itself. The
-- gym_id-nullable + partial-unique-index trick is still reused from that
-- migration, though: gym_id null is reserved for a future platform-global
-- promotion path (Phase 2+, unbuilt - `prevent_gym_id_change` blocks any
-- transition into or out of null, deliberately, until that workflow is
-- designed).

create table movements (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references gyms(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  equipment text,
  category text,
  -- Free text, no CHECK constraint - loosely matches the vocabulary
  -- analyze-workout/openaiSchema.ts already uses for MOVEMENT_PATTERN_VALUES
  -- (Squat/Hinge/Push/Pull/Lunge/Carry/Rotation/Gait) for AI-prompt
  -- consistency, without coupling this table to that edge function's own
  -- schema file.
  movement_pattern text,
  -- Nullable override map consumed by the scaling engine's CALLER (not
  -- the engine function itself, which stays pure/synchronous) -
  -- {"intermediate": "...", "beginner": "...", "onramp": "..."}.
  default_substitutions jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same NULL <> NULL reasoning as workout_section_types: a single
-- UNIQUE(gym_id, name) would not catch two platform-global rows (gym_id
-- null) with the same name, since Postgres treats every NULL as distinct
-- in a UNIQUE constraint. Two partial indexes, one per scope.
create unique index movements_platform_name_uidx
  on movements (lower(name)) where gym_id is null;
create unique index movements_gym_name_uidx
  on movements (gym_id, lower(name)) where gym_id is not null;
create index movements_gym_id_idx on movements (gym_id);
create index movements_aliases_gin_idx on movements using gin (aliases);

alter table movements enable row level security;

-- SELECT: structural/reference data (a movement's name/aliases/equipment
-- is never sensitive), open to every authenticated gym member, not just
-- coach/admin - same reasoning as workout_section_types_select. A member
-- never edits this table, but there's no reason to hide it from them
-- either (autocomplete-adjacent data, not member PII).
create policy movements_select on movements
  for select to authenticated
  using (gym_id is null or gym_id = my_gym_id());

-- INSERT/UPDATE/DELETE: is_coach_or_admin on the ROW's OWN gym_id (which
-- already implies membership in that gym), platform rows (gym_id null)
-- reserved for a future platform-admin promotion workflow - a coach can
-- never create/edit/delete a platform-global movement, only their own
-- gym's rows. Identical shape to workout_section_types_insert/update/
-- delete and workout_scaling_levels_insert/update/delete.
create policy movements_insert on movements
  for insert to authenticated
  with check (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );
create policy movements_update on movements
  for update to authenticated
  using (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  )
  with check (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );
create policy movements_delete on movements
  for delete to authenticated
  using (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );

create trigger prevent_gym_id_change_trg before update on movements
  for each row execute function prevent_gym_id_change();

-- No seed data - unlike workout_section_types/workout_scaling_levels
-- (every gym needs those keys immediately), this table intentionally
-- starts empty; seeding the ~250 static-list entries per gym here would
-- be pure duplication with zero readers of the duplicated rows in Phase 1.
