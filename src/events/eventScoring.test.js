import { describe, it, expect } from 'vitest'
import {
  EVENT_SCORING_FORMATS, eventScoreDefinition, composeEventScoreFields, eventScoreReady,
  attemptToEditorValue, hasScore, isPositiveTime, MAX_EFFORT_UNIT_KEY,
} from './eventScoring'
import {
  composeCappedRoundsResult, composeFortimeOrAmrapFields, normalizeCompletionState,
  composePartialText, repsEfectiveSecvential, deriveDurationCompletionState, sortSectionLogs,
} from '../workoutFormats'
import { scoreDefinitionFor } from '../scoreDefinition'

const ev = (workout_format, workout_format_config = {}) => ({ workout_format, workout_format_config, has_workout: true, scoring_enabled: true })

describe('v1 format matrix (migration events_scoring_v1_formats)', () => {
  it('is exactly the approved list', () => {
    expect(EVENT_SCORING_FORMATS).toEqual(['AMRAP', 'Ascending AMRAP', 'For Time', 'RFT', 'Chipper', 'Ladder', 'Partner WOD', 'Once', 'Max Effort'])
  })
  it('never offers SETS / STAGES / MIXED / NONE inputs', () => {
    for (const f of ['EMOM', 'Tabata', 'Chained AMRAP', 'Buy-In/Cash-Out', 'Not For Time', 'Strength Sets', 'Death By']) {
      expect(eventScoreDefinition(ev(f)).kind).toBe('UNSUPPORTED')
    }
    expect(() => composeEventScoreFields(ev('EMOM'), { result: '5' })).toThrow('invalid_fields')
  })
})

describe('definitions come from scoreDefinitionFor (no parallel engine)', () => {
  it('matches scoreDefinitionFor for every non-Max-Effort v1 format', () => {
    const cases = [['AMRAP', {}], ['Ascending AMRAP', {}], ['For Time', {}], ['For Time', { timeCapSec: 600 }],
      ['For Time', { structure: 'Repeated Rounds', rounds: 5, timeCapSec: 900 }], ['RFT', { rounds: 5 }], ['Chipper', { timeCapSec: 1200 }],
      ['Ladder', {}], ['Partner WOD', { baseFormat: 'AMRAP' }], ['Partner WOD', { baseFormat: 'For Time', durationSec: 1200 }], ['Once', {}]]
    for (const [f, c] of cases) expect(eventScoreDefinition(ev(f, c))).toEqual(scoreDefinitionFor(f, c, { singleValueUnit: null, unit: undefined }))
  })
  it('Max Effort: score type from scoreUnit; missing / unknown / bare "distance" fails safe (never free text)', () => {
    expect(eventScoreDefinition(ev('Max Effort')).kind).toBe('MISCONFIGURED')
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'reps' })).kind).toBe('REPS')
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'calories' })).kind).toBe('CALORIES')
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'distance' })).kind).toBe('MISCONFIGURED')
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'distance_m' }))).toEqual({ kind: 'DISTANCE', unit: 'm' })
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'distance_km' }))).toEqual({ kind: 'DISTANCE', unit: 'km' })
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'reps' }))).toEqual(scoreDefinitionFor('Max Effort', {}, { singleValueUnit: 'reps' }))
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'load' }), 'lbs')).toEqual({ kind: 'LOAD', unit: 'lb' })
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'nonsense' })).kind).toBe('MISCONFIGURED')
    expect(eventScoreDefinition(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'load' }), 'kg')).toEqual({ kind: 'LOAD', unit: 'kg' })
  })
  it('Sequence AMRAP (no structured stations) captures total reps', () => {
    expect(eventScoreDefinition(ev('AMRAP', { structure: 'Sequence' }))).toMatchObject({ kind: 'REPS', eventsTotalReps: true })
  })
})

// GOLDEN PARITY - each branch must equal the exact helper chain App.jsx's
// composeWodLogFieldsInner runs on its primary Log WOD path (logWodPrimaryPath),
// followed by normalizeCompletionState. Same inputs -> byte-identical fields.
describe('golden parity with the existing Log WOD composition', () => {
  const pick = (f) => ({ result: f.result, time_result: f.time_result, completion_state: f.completion_state })

  it('AMRAP / Ascending AMRAP: composeCappedRoundsResult(rounds, additional)', () => {
    for (const format of ['AMRAP', 'Ascending AMRAP']) {
      for (const [r, a] of [['7', '12'], ['7', ''], ['0', '45'], ['12', '0']]) {
        const got = composeEventScoreFields(ev(format), { roundsCompleted: r, additionalReps: a })
        const want = normalizeCompletionState({ result: composeCappedRoundsResult(r, a) || null, time_result: null, completion_state: null })
        expect(pick(got)).toEqual(pick(want))
      }
    }
  })

  it('RFT / For Time Repeated Rounds / Partner WOD For Time: composeFortimeOrAmrapFields', () => {
    const cases = [
      [ev('RFT', { rounds: 5, timeCapSec: 900 }), { time: '12:34' }],
      [ev('RFT', { rounds: 5, timeCapSec: 900 }), { roundsCompleted: '4', additionalReps: '17' }],
      [ev('For Time', { structure: 'Repeated Rounds', rounds: 7 }), { time: '9:05' }],
      [ev('Partner WOD', { baseFormat: 'For Time', rounds: 3, durationSec: 1200 }), { roundsCompleted: '2', additionalReps: '' }],
    ]
    for (const [event, v] of cases) {
      const cfg = event.workout_format_config
      const { result, time_result, completionState } = composeFortimeOrAmrapFields({
        wodTime: v.time || '', wodRoundsCompleted: v.roundsCompleted || '', wodPartialReps: [], movements: [],
        rounds: cfg.rounds, wodResult: '', wodAdditionalReps: v.additionalReps ?? '',
      })
      const want = normalizeCompletionState({ result, time_result, completion_state: completionState })
      expect(pick(composeEventScoreFields(event, v))).toEqual(pick(want))
    }
  })

  it('Partner WOD with base AMRAP scores as AMRAP', () => {
    expect(pick(composeEventScoreFields(ev('Partner WOD', { baseFormat: 'AMRAP' }), { roundsCompleted: '9', additionalReps: '3' })))
      .toEqual({ result: '9 runde + 3', time_result: null, completion_state: null })
  })

  it('sequential finished: time + completed (sequentialPartial finished branch)', () => {
    for (const f of ['For Time', 'Chipper', 'Ladder', 'Once']) {
      const got = composeEventScoreFields(ev(f, { timeCapSec: 900 }), { time: '14:02' })
      expect(pick(got)).toEqual({ result: null, time_result: '14:02', completion_state: deriveDurationCompletionState(false) })
    }
  })

  it('sequential capped: composePartialText(repsEfectiveSecvential(...)) + capped (adapted to one total-reps row)', () => {
    const got = composeEventScoreFields(ev('Chipper', { timeCapSec: 900 }), { partialReps: ['143'] })
    const want = composePartialText(repsEfectiveSecvential(['143'], ['reps']), ['reps'])
    expect(pick(got)).toEqual({ result: want, time_result: null, completion_state: 'capped' })
    expect(want).toBe('143 reps')
  })

  it('Max Effort: result verbatim, no completion state; LOAD stores the member unit', () => {
    expect(pick(composeEventScoreFields(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'calories' }), { result: ' 120 ' }))).toEqual({ result: '120', time_result: null, completion_state: null })
    expect(() => composeEventScoreFields(ev('Max Effort'), { result: '120' })).toThrow('invalid_fields')
    expect(composeEventScoreFields(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'distance_km' }), { result: '5.2' })).toMatchObject({ result: '5.2', weight_unit: null })
    const load = composeEventScoreFields(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'load' }), { result: '225' }, 'lbs')
    expect(load).toMatchObject({ result: '225', weight_unit: 'lb', completion_state: null })
    expect(composeEventScoreFields(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'reps' }), { result: '87' }).weight_unit).toBeNull()
  })

  it('only sends keys forge_events_clean_score accepts', () => {
    const fields = composeEventScoreFields(ev('AMRAP'), { roundsCompleted: '5', additionalReps: '1', notes: ' felt good ' })
    expect(Object.keys(fields).sort()).toEqual(['completion_state', 'log_meta', 'notes', 'result', 'sets', 'time_result', 'weight_logged', 'weight_unit'])
    expect(fields.notes).toBe('felt good')
    // never gym/division/format/config - those are server-controlled
    for (const k of ['gym_id', 'division', 'format_snapshot', 'format_config_snapshot', 'member_id', 'event_id']) expect(fields).not.toHaveProperty(k)
  })
})

describe('the composed text ranks through the UNCHANGED sortSectionLogs', () => {
  const asLog = (id, fields, at = '2026-10-15T10:00:00Z') => ({ id, member_id: id, logged_at: at, ...fields })
  it('sequential capped total reps rank by reps, below every finisher', () => {
    const e = ev('For Time', { timeCapSec: 600 })
    const logs = [
      asLog('capped-120', composeEventScoreFields(e, { partialReps: ['120'] })),
      asLog('finished', composeEventScoreFields(e, { time: '9:59' })),
      asLog('capped-150', composeEventScoreFields(e, { partialReps: ['150'] })),
    ]
    expect(sortSectionLogs(logs, 'For Time', e.workout_format_config).map((l) => l.id)).toEqual(['finished', 'capped-150', 'capped-120'])
  })
  it('Sequence AMRAP total reps rank by reps', () => {
    const e = ev('AMRAP', { structure: 'Sequence' })
    const logs = [asLog('a', composeEventScoreFields(e, { result: '88' })), asLog('b', composeEventScoreFields(e, { result: '102' }))]
    expect(sortSectionLogs(logs, 'AMRAP', e.workout_format_config).map((l) => l.id)).toEqual(['b', 'a'])
  })
  it('AMRAP rounds then additional reps', () => {
    const e = ev('AMRAP')
    const logs = [
      asLog('7+12', composeEventScoreFields(e, { roundsCompleted: '7', additionalReps: '12' })),
      asLog('8+0', composeEventScoreFields(e, { roundsCompleted: '8', additionalReps: '' })),
      asLog('7+15', composeEventScoreFields(e, { roundsCompleted: '7', additionalReps: '15' })),
    ]
    expect(sortSectionLogs(logs, 'AMRAP', {}).map((l) => l.id)).toEqual(['8+0', '7+15', '7+12'])
  })
})

describe('eventScoreReady - an untouched draft is never a score', () => {
  it('RFT with configured rounds: empty draft is NOT ready (composeFortimeOrAmrapFields would invent "N runde complete")', () => {
    const e = ev('RFT', { rounds: 5, timeCapSec: 900 })
    expect(eventScoreReady(e, {})).toBe(false)
    expect(eventScoreReady(e, { time: ':00' })).toBe(false)
    expect(eventScoreReady(e, { time: '0:00' })).toBe(false)
    expect(eventScoreReady(e, { time: '12:00' })).toBe(true)
    expect(eventScoreReady(e, { roundsCompleted: '4' })).toBe(true)
  })
  it('per kind', () => {
    expect(eventScoreReady(ev('AMRAP'), { roundsCompleted: '' })).toBe(false)
    expect(eventScoreReady(ev('AMRAP'), { roundsCompleted: '0', additionalReps: '30' })).toBe(true)
    expect(eventScoreReady(ev('Chipper', { timeCapSec: 900 }), { partialReps: ['0'] })).toBe(false)
    expect(eventScoreReady(ev('Chipper', { timeCapSec: 900 }), { partialReps: ['55'] })).toBe(true)
    expect(eventScoreReady(ev('For Time'), { partialReps: ['55'] })).toBe(false) // no cap -> finish time only
    expect(eventScoreReady(ev('Max Effort'), { result: '100' })).toBe(false) // no score type -> never submittable
    expect(eventScoreReady(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'distance_m' }), { result: '400' })).toBe(true)
    expect(eventScoreReady(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'reps' }), { result: 'abc' })).toBe(false)
    expect(eventScoreReady(ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'load' }), { result: '0' })).toBe(false)
    expect(eventScoreReady(ev('EMOM'), { result: '5' })).toBe(false)
  })
  it('isPositiveTime / hasScore', () => {
    expect(isPositiveTime('0:30')).toBe(true)
    expect(isPositiveTime('')).toBe(false)
    expect(hasScore({ result: null, time_result: null })).toBe(false)
    expect(hasScore({ result: '5 runde complete' })).toBe(true)
  })
})

describe('edit round trip (attemptToEditorValue -> composeEventScoreFields)', () => {
  const roundTrip = (event, value, unit) => {
    const stored = composeEventScoreFields(event, value, unit)
    const back = composeEventScoreFields(event, attemptToEditorValue(event, stored), unit)
    return [stored, back]
  }
  it.each([
    [ev('AMRAP'), { roundsCompleted: '7', additionalReps: '12' }],
    [ev('RFT', { rounds: 5, timeCapSec: 900 }), { roundsCompleted: '4', additionalReps: '9' }],
    [ev('RFT', { rounds: 5, timeCapSec: 900 }), { time: '13:10' }],
    [ev('Ladder', { timeCapSec: 900 }), { partialReps: ['77'] }],
    [ev('Ladder', { timeCapSec: 900 }), { time: '8:01' }],
    [ev('AMRAP', { structure: 'Sequence' }), { result: '64' }],
    [ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'load' }), { result: '100' }],
  ])('%#', (event, value) => {
    const [stored, back] = roundTrip(event, value, 'kg')
    expect(back).toEqual(stored)
  })
})

describe('Max Effort score types (approved scoreUnit) - shared with the Admin editor', () => {
  it('the exact list, pinned identically in forge-admin-web (MAX_EFFORT_SCORE_UNITS)', async () => {
    const { MAX_EFFORT_UNITS } = await import('./eventScoring')
    expect(MAX_EFFORT_UNITS).toEqual(['load', 'reps', 'calories', 'distance_m', 'distance_km'])
  })
  it('ranking values: load -> kg (toKgForRanking), distance -> metres', async () => {
    const { maxEffortRankValue } = await import('./eventScoring')
    expect(maxEffortRankValue('load', '100', 'kg')).toBe(100)
    expect(maxEffortRankValue('load', '220', 'lb')).toBeCloseTo(99.79, 2)
    expect(maxEffortRankValue('distance_km', '5.2')).toBe(5200)
    expect(maxEffortRankValue('distance_m', '400')).toBe(400)
    expect(maxEffortRankValue('reps', 'x')).toBeNull()
  })
})

describe('Phase 3.2 - the PWA readiness rule matches the server trigger', () => {
  const me = (unit) => ev('Max Effort', { [MAX_EFFORT_UNIT_KEY]: unit })
  it('plain positive decimals only; whole numbers for reps / calories', () => {
    expect(eventScoreReady(me('reps'), { result: '12' })).toBe(true)
    expect(eventScoreReady(me('reps'), { result: '12.5' })).toBe(false)
    expect(eventScoreReady(me('calories'), { result: '30.1' })).toBe(false)
    expect(eventScoreReady(me('load'), { result: '102.5' })).toBe(true)
    expect(eventScoreReady(me('load'), { result: '1e3' })).toBe(false)
    expect(eventScoreReady(me('distance_km'), { result: '-5' })).toBe(false)
  })
})
