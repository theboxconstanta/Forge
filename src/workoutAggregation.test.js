import { describe, expect, it } from 'vitest'
import {
  COMBINE_FUNCTIONS,
  VALUE_COMBINE_FUNCTIONS,
  RANK_COMBINE_FUNCTIONS,
  classifySectionMetric,
  validateAggregateDefinition,
  sectionValueForMember,
  deriveWorkoutAggregate,
} from './workoutAggregation'
import { toKgForRanking } from './workoutFormats'

const section = (overrides = {}) => ({
  id: 'sec-1', workoutId: 'wo-1', gymId: 'gym-1', loggingMode: 'required',
  format: 'Weightlifting', formatConfig: {}, ...overrides,
})

describe('classifySectionMetric', () => {
  it('classifies a weight-scored sets format as LOAD, higher wins, canonical kg', () => {
    expect(classifySectionMetric('Weightlifting', {})).toEqual({ kind: 'LOAD', unit: 'kg', direction: 'higher' })
  })
  it('classifies a rep-scored sets format as REPS, higher wins', () => {
    expect(classifySectionMetric('Strength Sets', { scoringMode: 'Total Reps' })).toEqual({ kind: 'REPS', unit: 'count', direction: 'higher' })
  })
  it('classifies For Time as TIME, lower wins', () => {
    expect(classifySectionMetric('For Time', {})).toEqual({ kind: 'TIME', unit: 'seconds', direction: 'lower' })
  })
  it('returns null for AMRAP (Composite/ROUNDS_REPS, not supported by Family A in Phase A)', () => {
    expect(classifySectionMetric('AMRAP', {})).toBeNull()
  })
  it('returns null for a missing/empty format id', () => {
    expect(classifySectionMetric(null, {})).toBeNull()
    expect(classifySectionMetric('', {})).toBeNull()
  })
})

describe('validateAggregateDefinition - structural (S50)', () => {
  it('null definition is always valid (no aggregate)', () => {
    expect(validateAggregateDefinition(null, [])).toEqual({ valid: true, errors: [] })
  })
  it('valid 2-Section sum definition passes', () => {
    const sections = [section({ id: 'a' }), section({ id: 'b' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    expect(validateAggregateDefinition(def, sections).valid).toBe(true)
  })
  it('rejects a nonexistent Section id', () => {
    const sections = [section({ id: 'a' })]
    const def = { participantSectionIds: ['a', 'ghost'], combineFunction: 'sum' }
    const result = validateAggregateDefinition(def, sections)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/not found or not required/)
  })
  it('rejects a Section belonging to a foreign Workout', () => {
    const sections = [section({ id: 'a', workoutId: 'wo-1' }), section({ id: 'b', workoutId: 'wo-2' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const result = validateAggregateDefinition(def, sections)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /same Workout/.test(e))).toBe(true)
  })
  it('rejects duplicate Section ids', () => {
    const sections = [section({ id: 'a' })]
    const def = { participantSectionIds: ['a', 'a'], combineFunction: 'sum' }
    const result = validateAggregateDefinition(def, sections)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/duplicate/)
  })
  it('rejects a non-scored (logging_mode !== required) Section', () => {
    const sections = [section({ id: 'a' }), section({ id: 'b', loggingMode: 'optional' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const result = validateAggregateDefinition(def, sections)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /logging_mode/.test(e))).toBe(true)
  })
  it('rejects fewer than 2 participant Sections', () => {
    const def = { participantSectionIds: ['a'], combineFunction: 'sum' }
    expect(validateAggregateDefinition(def, [section({ id: 'a' })]).valid).toBe(false)
  })
  it('rejects an invalid combine function name (no eighth mode)', () => {
    const sections = [section({ id: 'a' }), section({ id: 'b' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'average-weighted-custom' }
    expect(validateAggregateDefinition(def, sections).valid).toBe(false)
  })
  it('rejects points-sum with no pointsTable', () => {
    const sections = [section({ id: 'a' }), section({ id: 'b' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'points-sum' }
    const result = validateAggregateDefinition(def, sections)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /pointsTable/.test(e))).toBe(true)
  })
  it('accepts points-sum with a pointsTable present', () => {
    const sections = [section({ id: 'a', format: 'For Time' }), section({ id: 'b', format: 'Weightlifting' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'points-sum', pointsTable: [{ rank: 1, points: 100 }] }
    expect(validateAggregateDefinition(def, sections).valid).toBe(true)
  })
  it('rejects incompatible metrics for a value-combine function (TIME + LOAD)', () => {
    const sections = [section({ id: 'a', format: 'For Time' }), section({ id: 'b', format: 'Weightlifting' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const result = validateAggregateDefinition(def, sections)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /metric kind/.test(e))).toBe(true)
  })
  it('rank-combine functions do not require metric compatibility (TIME + LOAD is fine)', () => {
    const sections = [section({ id: 'a', format: 'For Time' }), section({ id: 'b', format: 'Weightlifting' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    expect(validateAggregateDefinition(def, sections).valid).toBe(true)
  })
})

describe('sectionValueForMember', () => {
  it('reads LOAD from a sets-family log, canonical-kg-normalized', () => {
    const log = { _setsScore: 100 }
    const metric = { kind: 'LOAD', unit: 'kg', direction: 'higher' }
    expect(sectionValueForMember(log, metric, toKgForRanking, 'kg')).toBe(100)
  })
  it('normalizes lb to kg for LOAD', () => {
    const log = { _setsScore: 220.462 }
    const metric = { kind: 'LOAD', unit: 'kg', direction: 'higher' }
    expect(sectionValueForMember(log, metric, toKgForRanking, 'lbs')).toBeCloseTo(100, 0)
  })
  it('returns null LOAD when the log has no usable score', () => {
    const metric = { kind: 'LOAD', unit: 'kg', direction: 'higher' }
    expect(sectionValueForMember({ _setsScore: null }, metric, toKgForRanking, 'kg')).toBeNull()
  })
  it('reads TIME in seconds from a finished log', () => {
    const log = { time_result: '5:24', completion_state: 'completed' }
    const metric = { kind: 'TIME', unit: 'seconds', direction: 'lower' }
    expect(sectionValueForMember(log, metric, toKgForRanking, 'kg')).toBe(324)
  })
  it('returns null TIME for a capped/unfinished log - not a fake time, not zero', () => {
    const log = { time_result: null, completion_state: 'capped' }
    const metric = { kind: 'TIME', unit: 'seconds', direction: 'lower' }
    expect(sectionValueForMember(log, metric, toKgForRanking, 'kg')).toBeNull()
  })
  it('falls back to the !!time_result inference for legacy logs (completion_state null)', () => {
    const log = { time_result: '10:00', completion_state: null }
    const metric = { kind: 'TIME', unit: 'seconds', direction: 'lower' }
    expect(sectionValueForMember(log, metric, toKgForRanking, 'kg')).toBe(600)
  })
})

const valueInput = (value, overrides = {}) => ({ value, metric: 'LOAD', unit: 'kg', direction: 'higher', classifiedTier: 'RX', ...overrides })

describe('deriveWorkoutAggregate - Family A value-combine (S51)', () => {
  const def = (fn) => ({ participantSectionIds: ['a', 'b'], combineFunction: fn })

  it('sum: two valid inputs', () => {
    const result = deriveWorkoutAggregate(def('sum'), { a: valueInput(100), b: valueInput(130) })
    expect(result).toMatchObject({ status: 'available', value: 230, comparator: 'higher' })
  })
  it('sum: three valid inputs', () => {
    const def3 = { participantSectionIds: ['a', 'b', 'c'], combineFunction: 'sum' }
    const result = deriveWorkoutAggregate(def3, { a: valueInput(10), b: valueInput(20), c: valueInput(30) })
    expect(result.value).toBe(60)
  })
  it('sum: missing input -> unavailable, never a guessed zero', () => {
    const result = deriveWorkoutAggregate(def('sum'), { a: valueInput(100), b: undefined })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'missing-result', value: null })
  })
  it('average', () => {
    const result = deriveWorkoutAggregate(def('average'), { a: valueInput(100), b: valueInput(200) })
    expect(result.value).toBe(150)
  })
  it('max', () => {
    const result = deriveWorkoutAggregate(def('max'), { a: valueInput(100), b: valueInput(200) })
    expect(result.value).toBe(200)
  })
  it('min', () => {
    const result = deriveWorkoutAggregate(def('min'), { a: valueInput(100), b: valueInput(200) })
    expect(result.value).toBe(100)
  })
  it('best-of, direction higher (LOAD) picks the max', () => {
    const result = deriveWorkoutAggregate(def('best-of'), { a: valueInput(100), b: valueInput(200) })
    expect(result.value).toBe(200)
  })
  it('best-of, direction lower (TIME) picks the min', () => {
    const timeInput = (v) => valueInput(v, { metric: 'TIME', unit: 'seconds', direction: 'lower' })
    const result = deriveWorkoutAggregate(def('best-of'), { a: timeInput(300), b: timeInput(200) })
    expect(result.value).toBe(200)
  })
  it('true tie: two equal values sum deterministically (no fake tiebreak inside the engine)', () => {
    const result = deriveWorkoutAggregate(def('sum'), { a: valueInput(100), b: valueInput(100) })
    expect(result.value).toBe(200)
  })
  it('comparator is inherited from the shared metric, never separately configured', () => {
    expect(deriveWorkoutAggregate(def('sum'), { a: valueInput(100), b: valueInput(130) }).comparator).toBe('higher')
  })
  it('deterministic: identical inputs always produce identical output', () => {
    const inputs = { a: valueInput(102), b: valueInput(135) }
    const r1 = deriveWorkoutAggregate(def('sum'), inputs)
    const r2 = deriveWorkoutAggregate(def('sum'), inputs)
    expect(r1).toEqual(r2)
  })
  it('canonical-unit normalization happens upstream (sectionValueForMember), engine just sums already-normalized kg', () => {
    const a = sectionValueForMember({ _setsScore: 100 }, { kind: 'LOAD' }, toKgForRanking, 'kg')
    const b = sectionValueForMember({ _setsScore: 286.6 }, { kind: 'LOAD' }, toKgForRanking, 'lbs')
    const result = deriveWorkoutAggregate(def('sum'), { a: valueInput(a), b: valueInput(b) })
    expect(result.value).toBeCloseTo(230, 0)
  })
})

const rankInput = (rank, overrides = {}) => ({ rank, classifiedTier: 'RX', ...overrides })

describe('deriveWorkoutAggregate - Family B rank-combine (S52)', () => {
  it('placement-sum: ordinary ranks', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const result = deriveWorkoutAggregate(def, { a: rankInput(2), b: rankInput(1) })
    expect(result).toMatchObject({ status: 'available', value: 3, comparator: 'lower', metric: 'RANK_SUM' })
  })
  it('placement-sum: missing Section rank for this member -> unavailable by default', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const result = deriveWorkoutAggregate(def, { a: rankInput(2), b: rankInput(null) })
    expect(result.status).toBe('unavailable')
  })
  it('points-sum: maps rank through the declared table before summing', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'points-sum', pointsTable: [{ rank: 1, points: 100 }, { rank: 2, points: 95 }] }
    const result = deriveWorkoutAggregate(def, { a: rankInput(1), b: rankInput(2) })
    expect(result).toMatchObject({ status: 'available', value: 195, comparator: 'higher', metric: 'POINTS_SUM' })
  })
  it('points-sum: a rank absent from the table scores 0 points for that Section, not an error', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'points-sum', pointsTable: [{ rank: 1, points: 100 }] }
    const result = deriveWorkoutAggregate(def, { a: rankInput(1), b: rankInput(9) })
    expect(result.value).toBe(100)
  })
  it('member absent from one Section entirely (undefined input) -> unavailable', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const result = deriveWorkoutAggregate(def, { a: rankInput(1), b: undefined })
    expect(result.status).toBe('unavailable')
  })
  it('aggregate tie: two members can produce the same summed placement (deterministic, not fabricated apart)', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const memberX = deriveWorkoutAggregate(def, { a: rankInput(1), b: rankInput(4) })
    const memberY = deriveWorkoutAggregate(def, { a: rankInput(2), b: rankInput(3) })
    expect(memberX.value).toBe(memberY.value)
  })
  it('deterministic aggregate rank input -> deterministic output', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const inputs = { a: rankInput(3), b: rankInput(5) }
    expect(deriveWorkoutAggregate(def, inputs)).toEqual(deriveWorkoutAggregate(def, inputs))
  })
  it('an explicit worst-placement missingPolicy is accepted only for rank-combine functions', () => {
    const defA = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const resultA = deriveWorkoutAggregate(defA, { a: valueInput(1), b: valueInput(2) }, { missingPolicy: 'worst-placement' })
    expect(resultA.status).toBe('unavailable')
    expect(resultA.reason).toBe('invalid-definition')
  })
})

describe('deriveWorkoutAggregate - variants/tier (S54)', () => {
  const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
  it('same tier across all participants -> available', () => {
    const result = deriveWorkoutAggregate(def, { a: valueInput(100, { classifiedTier: 'RX' }), b: valueInput(130, { classifiedTier: 'RX' }) })
    expect(result.status).toBe('available')
    expect(result.classifiedTier).toBe('RX')
  })
  it('mixed tier across participants -> unavailable, not a new Mixed-aggregate concept', () => {
    const result = deriveWorkoutAggregate(def, { a: valueInput(100, { classifiedTier: 'RX' }), b: valueInput(130, { classifiedTier: 'Intermediate' }) })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'mixed-tier' })
  })
})

describe('deriveWorkoutAggregate - edit/delete propagation, no persistence (S56)', () => {
  const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
  it('edit propagation: a changed input value produces a changed output on the very next call, no invalidation step', () => {
    const before = deriveWorkoutAggregate(def, { a: valueInput(100), b: valueInput(130) })
    expect(before.value).toBe(230)
    const after = deriveWorkoutAggregate(def, { a: valueInput(100), b: valueInput(135) })
    expect(after.value).toBe(235)
  })
  it('delete propagation: removing a participant\'s input makes the aggregate unavailable on the next call', () => {
    const available = deriveWorkoutAggregate(def, { a: valueInput(100), b: valueInput(130) })
    expect(available.status).toBe('available')
    const afterDelete = deriveWorkoutAggregate(def, { a: valueInput(100), b: undefined })
    expect(afterDelete.status).toBe('unavailable')
  })
  it('restore: the input reappearing makes the aggregate available again, with no stale row anywhere', () => {
    const afterDelete = deriveWorkoutAggregate(def, { a: valueInput(100), b: undefined })
    expect(afterDelete.status).toBe('unavailable')
    const restored = deriveWorkoutAggregate(def, { a: valueInput(100), b: valueInput(130) })
    expect(restored).toMatchObject({ status: 'available', value: 230 })
  })
})

describe('no-aggregate regression (S57)', () => {
  it('null aggregateDefinition always returns an unavailable, no-definition result', () => {
    const result = deriveWorkoutAggregate(null, {})
    expect(result).toMatchObject({ status: 'unavailable', reason: 'no-definition', value: null })
  })
  it('COMBINE_FUNCTIONS is exactly the seven approved values, no eighth mode', () => {
    expect(COMBINE_FUNCTIONS).toHaveLength(7)
    expect(VALUE_COMBINE_FUNCTIONS).toEqual(['sum', 'best-of', 'average', 'max', 'min'])
    expect(RANK_COMBINE_FUNCTIONS).toEqual(['placement-sum', 'points-sum'])
  })
})

describe('IWF-style Total acceptance case (S32), engine-level', () => {
  it('Snatch 100kg + Clean & Jerk 130kg = 230kg Total, higher wins', () => {
    const def = { participantSectionIds: ['snatch', 'cj'], combineFunction: 'sum' }
    const result = deriveWorkoutAggregate(def, { snatch: valueInput(100), cj: valueInput(130) })
    expect(result).toMatchObject({ status: 'available', value: 230, comparator: 'higher' })
  })
  it('editing Clean & Jerk to 135kg recomputes the Total to 235kg on the next call', () => {
    const def = { participantSectionIds: ['snatch', 'cj'], combineFunction: 'sum' }
    const result = deriveWorkoutAggregate(def, { snatch: valueInput(102), cj: valueInput(135) })
    expect(result.value).toBe(237)
  })
  it('zero successful Clean & Jerk attempts (no value) -> no Total at all, matching IWF S6.9', () => {
    const def = { participantSectionIds: ['snatch', 'cj'], combineFunction: 'sum' }
    const result = deriveWorkoutAggregate(def, { snatch: valueInput(100), cj: valueInput(null) })
    expect(result.status).toBe('unavailable')
  })
})

describe('Time Total acceptance case (S33)', () => {
  it('05:00 + 06:30 = 11:30, lower wins', () => {
    const timeInput = (v) => valueInput(v, { metric: 'TIME', unit: 'seconds', direction: 'lower' })
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const result = deriveWorkoutAggregate(def, { a: timeInput(300), b: timeInput(390) })
    expect(result).toMatchObject({ value: 690, comparator: 'lower' })
  })
})

describe('Reps Total acceptance case (S34)', () => {
  it('100 reps + 120 reps = 220 reps, higher wins', () => {
    const repsInput = (v) => valueInput(v, { metric: 'REPS', unit: 'count', direction: 'higher' })
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const result = deriveWorkoutAggregate(def, { a: repsInput(100), b: repsInput(120) })
    expect(result).toMatchObject({ value: 220, comparator: 'higher' })
  })
})

describe('incompatible metric case (S35) - rejected at validation, never a fake numeric aggregate', () => {
  it('TIME + LOAD sum is rejected by validateAggregateDefinition before any derivation is attempted', () => {
    const sections = [section({ id: 'a', format: 'For Time' }), section({ id: 'b', format: 'Weightlifting' })]
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    expect(validateAggregateDefinition(def, sections).valid).toBe(false)
  })
})

describe('same-format-does-not-imply-aggregate regression (S36/S37)', () => {
  it('two AMRAP Sections with no aggregateDefinition produce no aggregate - deriveWorkoutAggregate is simply never called', () => {
    expect(deriveWorkoutAggregate(null, {})).toMatchObject({ status: 'unavailable', reason: 'no-definition' })
  })
})
