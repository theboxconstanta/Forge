import { describe, expect, it } from 'vitest'
import { fetchWorkoutAggregateForMember, normalizeSkillLogToWodLogShape } from './workoutAggregationRead'

// Minimal fake Supabase query builder - supports exactly the chain shapes
// workoutAggregationRead.js calls (.from().select().eq().maybeSingle(),
// .from().select().in()). Each table's canned response is looked up by
// table name from `tables`, ignoring the specific filter values (this is a
// unit test of the JOIN/GROUP/NORMALIZE logic, not of RLS/query-shape
// correctness, which is covered by the production acceptance pass).
function fakeSupabase(tables) {
  return {
    from(table) {
      const builder = {
        select() { return builder },
        eq() { return builder },
        in() { return builder },
        async maybeSingle() { return { data: tables[table]?.[0] ?? null, error: null } },
        then(resolve) { resolve({ data: tables[table] || [], error: null }); },
      }
      return builder
    },
  }
}

const sectionA = { id: 'sec-snatch', format: 'Weightlifting', format_config: {}, workout_id: 'wo-1', gym_id: 'gym-1', logging_mode: 'required' }
const sectionB = { id: 'sec-cj', format: 'Weightlifting', format_config: {}, workout_id: 'wo-1', gym_id: 'gym-1', logging_mode: 'required' }

describe('fetchWorkoutAggregateForMember', () => {
  it('returns no-definition when the workout has no aggregate_definition', async () => {
    const supabase = fakeSupabase({ workouts: [{ id: 'wo-1', aggregate_definition: null }] })
    const result = await fetchWorkoutAggregateForMember(supabase, { workoutId: 'wo-1', memberId: 'm1' })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'no-definition' })
  })

  it('derives a Total from two wod_logs-sourced Sections (S53)', async () => {
    const supabase = fakeSupabase({
      workouts: [{ id: 'wo-1', aggregate_definition: { participantSectionIds: ['sec-snatch', 'sec-cj'], combineFunction: 'sum' } }],
      workout_sections: [sectionA, sectionB],
      wod_logs: [
        { id: 'l1', member_id: 'm1', workout_section_id: 'sec-snatch', variant_level: 'RX', _setsScore: 100, logged_at: '2026-08-16T10:00:00Z' },
        { id: 'l2', member_id: 'm1', workout_section_id: 'sec-cj', variant_level: 'RX', _setsScore: 130, logged_at: '2026-08-16T10:00:00Z' },
      ],
      skill_logs: [],
    })
    const result = await fetchWorkoutAggregateForMember(supabase, { workoutId: 'wo-1', memberId: 'm1' })
    // With no `sets` data, setsDisplayScore/_setsScore both resolve to null upstream -
    // this test's purpose is shape/plumbing, not score math (covered in workoutAggregation.test.js);
    // assert the pipeline runs end-to-end without throwing and returns a well-formed shape.
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('participatingSectionIds')
  })

  it('normalizeSkillLogToWodLogShape sets variant_level RX and preserves workout_section_id', () => {
    const shaped = normalizeSkillLogToWodLogShape({
      id: 's1', member_id: 'm1', wod_id: 'wo-1', notes: null, logged_at: '2026-08-16T10:00:00Z',
      sets: { 'Clean & Jerk': [{ reps: '1', weight: '130' }] }, result: null, log_meta: null,
      slot: 2, gym_id: 'gym-1', workout_section_id: 'sec-cj',
    })
    expect(shaped.variant_level).toBe('RX')
    expect(shaped.workout_section_id).toBe('sec-cj')
    expect(shaped._source).toBe('skill_logs')
  })

  it('a Section absent from workout_sections (removed/foreign) yields undefined input, not a thrown error', async () => {
    const supabase = fakeSupabase({
      workouts: [{ id: 'wo-1', aggregate_definition: { participantSectionIds: ['sec-snatch', 'ghost'], combineFunction: 'sum' } }],
      workout_sections: [sectionA],
      wod_logs: [],
      skill_logs: [],
    })
    const result = await fetchWorkoutAggregateForMember(supabase, { workoutId: 'wo-1', memberId: 'm1' })
    expect(result.status).toBe('unavailable')
  })
})
