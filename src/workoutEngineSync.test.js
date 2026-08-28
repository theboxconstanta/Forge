import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from './supabase.js'
import { syncWorkoutEngineV2FromLegacyWod } from './workoutEngine.js'

vi.mock('./supabase.js', () => ({
  supabase: { rpc: vi.fn() },
}))

// INC-03 - Historical Workout Identity & Logging Integrity.
//
// The production divergence (workouts.date <> linked wods.date) was fixed at
// the DB layer (sync_workout_engine_v2 now upserts ON CONFLICT (legacy_wod_id)
// and derives the date from the linked wods row; a BEFORE trigger on
// `workouts` enforces workouts.date == wods.date). These tests guard the
// CLIENT half of the contract: syncWorkoutEngineV2FromLegacyWod must forward
// the just-saved wods row's OWN date - never "today", never a device date -
// so an edited WOD date actually reaches the sync RPC.

describe('INC-03 - syncWorkoutEngineV2FromLegacyWod forwards the WOD row identity, not today', () => {
  beforeEach(() => {
    supabase.rpc.mockReset()
  })

  const baseWod = {
    id: '8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95',
    gym_id: 'c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716',
    date: '2026-08-27',
    name: 'Test WOD',
  }

  it('passes the wods row own date/id/gym to sync_workout_engine_v2 (not the current calendar day)', async () => {
    supabase.rpc.mockResolvedValue({ data: 'workout-uuid', error: null })
    const ok = await syncWorkoutEngineV2FromLegacyWod(baseWod)
    expect(ok).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = supabase.rpc.mock.calls[0]
    expect(fn).toBe('sync_workout_engine_v2')
    expect(args.p_gym_id).toBe(baseWod.gym_id)
    expect(args.p_date).toBe('2026-08-27') // the WOD's own business date
    expect(args.p_legacy_wod_id).toBe(baseWod.id)
  })

  it('after a coach edits the WOD date, the NEW date is what gets synced', async () => {
    supabase.rpc.mockResolvedValue({ data: 'workout-uuid', error: null })
    // the editor saved wods with date moved 2026-08-27 -> 2026-08-28; the
    // saved row (what saveWod passes here) carries the new date.
    await syncWorkoutEngineV2FromLegacyWod({ ...baseWod, date: '2026-08-28' })
    expect(supabase.rpc.mock.calls[0][1].p_date).toBe('2026-08-28')
  })

  it('is best-effort: an RPC error is swallowed (returns false, never throws) - wods stays source of truth', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(syncWorkoutEngineV2FromLegacyWod(baseWod)).resolves.toBe(false)
  })

  it('returns false for a null/invalid wod without calling the RPC', async () => {
    const ok = await syncWorkoutEngineV2FromLegacyWod(null)
    expect(ok).toBe(false)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
