// Coach Quick Create Phase 2 (Movement Catalog Consolidation) - thin client
// for the `movements` DB table, mirroring forge-admin-web's own
// src/features/movements/api.ts (same repo-pair "disciplined port"
// pattern as movements.js/movements.ts, scalingEngine.js/scalingEngine.ts).
// Additive only - wods.movements_rx/etc stay plain text[], this exists
// purely to back autocomplete, AI-prompt grounding, deterministic-scaling
// overrides, and gym-local "Create New Movement".
import { supabase } from './supabase'

const MOVEMENT_COLUMNS = 'id, gym_id, name, aliases, equipment, category, movement_pattern, default_substitutions, created_by, created_at, updated_at'

export class DuplicateMovementError extends Error {
  constructor(name) {
    super(`A movement named "${name}" already exists for this gym.`)
  }
}

/** This gym's own rows plus the platform-global tier (gym_id null). */
export async function fetchMovementsForGym(gymId) {
  const { data, error } = await supabase
    .from('movements')
    .select(MOVEMENT_COLUMNS)
    .or(`gym_id.eq.${gymId},gym_id.is.null`)
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Plain insert, never upsert (see WOD-SIMPLE's own movements_catalog.sql
 * RLS review comment: INSERT...ON CONFLICT evaluates the INSERT policy
 * even on the UPDATE branch) - catches the unique-violation (Postgres
 * 23505) and surfaces it as DuplicateMovementError instead of a raw error.
 */
export async function createMovement(gymId, input) {
  const { data, error } = await supabase
    .from('movements')
    .insert({
      gym_id: gymId,
      name: input.name.trim(),
      aliases: input.aliases || [],
      equipment: input.equipment ?? null,
      category: input.category ?? null,
      movement_pattern: input.movementPattern ?? null,
    })
    .select(MOVEMENT_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') throw new DuplicateMovementError(input.name.trim())
    throw new Error(error.message)
  }
  return data
}

/**
 * Canonical Movement Identity, Phase 2 - display-metadata lookup for a set
 * of already-known `movements.id` UUIDs (a member's own Movement History's
 * distinct `sets_movement_ids` values), mirroring benchmarkResolution.js's
 * own getBenchmarksByIds exactly (same batched-by-id, empty-input-
 * short-circuits pattern). Never used to resolve identity - Phase 1's
 * server-side trigger already did that; this exists purely to hydrate a
 * canonical group's display name.
 */
export async function getMovementsByIds(ids) {
  const distinct = [...new Set((ids || []).filter(Boolean))]
  const result = new Map()
  if (distinct.length === 0) return result
  const { data, error } = await supabase.from('movements').select('id, name').in('id', distinct)
  if (error) throw error
  for (const row of data || []) {
    result.set(row.id, { name: row.name })
  }
  return result
}
