import { describe, it, expect } from 'vitest'
import { scoreDefinitionFor, scoreKindForExistingLog, SCORE_KINDS } from './scoreDefinition'

// P9.5 — ScoreDefinition adapter. Maps Forge's EXISTING format catalog
// (workoutFormats.js family / scoreMode / effectiveScoreMode / isSequentialFormat
// / timeCapSec) to one UI-facing kind. It does not change persistence.

describe('P9.5 — scoreDefinitionFor', () => {
  it('AMRAP -> ROUNDS_REPS (integer)', () => {
    const d = scoreDefinitionFor('AMRAP', { durationSec: 900 })
    expect(d.kind).toBe('ROUNDS_REPS')
    expect(d.integer).toBe(true)
  })

  it('RFT with a time cap -> TIME_CAPPED, carries timeCapSec + roundsKnown', () => {
    const d = scoreDefinitionFor('RFT', { rounds: 3, timeCapSec: 1200 })
    expect(d.kind).toBe('TIME_CAPPED')
    expect(d.timeCapSec).toBe(1200)
    expect(d.roundsKnown).toBe(3)
    expect(d.sequential).toBe(false)
  })

  it('RFT with no cap -> TIME', () => {
    expect(scoreDefinitionFor('RFT', { rounds: 5 }).kind).toBe('TIME')
  })

  it('For Time (sequence) with a cap -> TIME_CAPPED + sequential', () => {
    const d = scoreDefinitionFor('For Time', { timeCapSec: 900 })
    expect(d.kind).toBe('TIME_CAPPED')
    expect(d.sequential).toBe(true)
  })

  it('For Time (Repeated Rounds) is NOT sequential', () => {
    const d = scoreDefinitionFor('For Time', { structure: 'Repeated Rounds', timeCapSec: 900, rounds: 4 })
    expect(d.sequential).toBe(false)
    expect(d.roundsKnown).toBe(4)
  })

  it('Chipper / Ladder -> TIME_CAPPED when capped', () => {
    expect(scoreDefinitionFor('Chipper', { timeCapSec: 1800 }).kind).toBe('TIME_CAPPED')
    expect(scoreDefinitionFor('Ladder', { timeCapSec: 1800 }).kind).toBe('TIME_CAPPED')
  })

  it('Partner WOD follows its baseFormat (effectiveScoreMode)', () => {
    expect(scoreDefinitionFor('Partner WOD', { baseFormat: 'AMRAP', durationSec: 1200 }).kind).toBe('ROUNDS_REPS')
    expect(scoreDefinitionFor('Partner WOD', { baseFormat: 'For Time', timeCapSec: 1200 }).kind).toBe('TIME_CAPPED')
  })

  it('sets-family formats -> SETS', () => {
    for (const f of ['Weightlifting', 'Strength Sets', 'EMOM', 'Tabata', 'Intervals', 'Complex']) {
      expect(scoreDefinitionFor(f, {}).kind).toBe('SETS')
    }
  })

  it('Chained AMRAP -> STAGES', () => {
    expect(scoreDefinitionFor('Chained AMRAP', { stages: [] }).kind).toBe('STAGES')
  })

  it('Not For Time -> NONE', () => {
    expect(scoreDefinitionFor('Not For Time', {}).kind).toBe('NONE')
  })

  it('Max Effort (single_value): FREE by default, unit-shaped when a deterministic metric is passed', () => {
    expect(scoreDefinitionFor('Max Effort', {}).kind).toBe('FREE')
    expect(scoreDefinitionFor('Max Effort', {}, { singleValueUnit: 'reps' })).toMatchObject({ kind: 'REPS', integer: true })
    expect(scoreDefinitionFor('Max Effort', {}, { singleValueUnit: 'load', unit: 'kg' })).toMatchObject({ kind: 'LOAD', unit: 'kg' })
    expect(scoreDefinitionFor('Max Effort', {}, { singleValueUnit: 'calories' })).toMatchObject({ kind: 'CALORIES', integer: true })
    expect(scoreDefinitionFor('Max Effort', {}, { singleValueUnit: 'distance', unit: 'm' })).toMatchObject({ kind: 'DISTANCE', unit: 'm' })
  })

  it('unknown / missing format -> FREE (never throws, never a wrong default)', () => {
    expect(scoreDefinitionFor(null, null).kind).toBe('FREE')
    expect(scoreDefinitionFor(undefined, {}).kind).toBe('FREE')
  })

  it('every returned kind is in SCORE_KINDS', () => {
    const seen = ['AMRAP', 'RFT', 'For Time', 'Chipper', 'Ladder', 'Weightlifting', 'EMOM', 'Chained AMRAP', 'Not For Time', 'Max Effort', null]
      .map((f) => scoreDefinitionFor(f, {}).kind)
    for (const k of seen) expect(SCORE_KINDS).toContain(k)
  })
})

describe('P9.5 — scoreKindForExistingLog (edit flow)', () => {
  it('a capped RFT log edits as TIME_CAPPED even from a finished-shaped def', () => {
    const d = scoreKindForExistingLog(
      { completion_state: 'capped', time_result: null, result: '2 runde + 43 Wallball' },
      'RFT', { rounds: 3, timeCapSec: 1200 },
    )
    expect(d.kind).toBe('TIME_CAPPED')
  })

  it('a finished RFT log edits as TIME_CAPPED shell (has the toggle) but starts Finished', () => {
    const d = scoreKindForExistingLog(
      { completion_state: 'completed', time_result: '17:42', result: '3 runde complete' },
      'RFT', { rounds: 3, timeCapSec: 1200 },
    )
    expect(d.kind).toBe('TIME_CAPPED')
  })

  it('legacy row (completion_state null, no time, rounds text) edits as capped', () => {
    const d = scoreKindForExistingLog(
      { completion_state: null, time_result: null, result: '2 runde + 10 reps' },
      'RFT', { rounds: 3 },
    )
    expect(d.kind).toBe('TIME_CAPPED')
  })

  it('AMRAP edit is unchanged (ROUNDS_REPS)', () => {
    expect(scoreKindForExistingLog({ completion_state: null, result: '7 runde + 12' }, 'AMRAP', {}).kind).toBe('ROUNDS_REPS')
  })
})
