// INC-11 - Structure-Aware AMRAP Logging.
//
// AMRAP is a TIME ENVELOPE, not a progression structure. A base AMRAP with
// `format_config.structure === 'Sequence'` is a finite ordered pass (buy-in /
// chipper / buy-in + max-reps tail), scored as ordered station progress + Total
// Reps. Classic repeated-round AMRAP (absent / 'Repeated Rounds') is unchanged.
//
// The incident fixture is abstract on purpose: NO workout id, NO date, NO real
// movement names carry meaning - fixed/open station role is STRUCTURAL.

import { describe, it, expect } from 'vitest'
import {
  isSequentialFormat, isSequentialAmrap, getFormat, partialRepsOfLog, sortSectionLogs,
} from './workoutFormats'
import {
  resolveSequentialAmrapStations, sequentialAmrapMixedUnitConflict,
  autoCompleteSequentialProgress, sequentialAmrapTotalReps,
  composeSequentialAmrapResult, parseSequentialAmrapResult,
} from './sequentialAmrap'
import { scoreDefinitionFor } from './scoreDefinition'

// --- abstract fixtures -------------------------------------------------------
const SEQ = { durationSec: 600, structure: 'Sequence' }
const CLASSIC = { durationSec: 600 } // absent structure -> repeated rounds
const CLASSIC_EXPLICIT = { durationSec: 600, structure: 'Repeated Rounds' }

// buy-in + max-reps tail: fixed 50 / fixed 75 / open  (THE INCIDENT SHAPE)
const BUYIN_MAX_LINES = ['50 Task A', '75 Task B', 'Max Reps Task A']
// structured instances (decision #4 precedence 1): reps.value number = fixed, null = open
const BUYIN_MAX_INSTANCES = [
  { name: 'Task A', reps: { mode: 'universal', value: 50 } },
  { name: 'Task B', reps: { mode: 'universal', value: 75 } },
  { name: 'Task A', reps: null },
]

describe('INC-11 §21/§22/§59/§60/§61 - classifier does NOT infer structure', () => {
  it('classic AMRAP (absent structure) is NOT sequential', () => {
    expect(isSequentialAmrap('AMRAP', CLASSIC)).toBe(false)
    expect(isSequentialAmrap('AMRAP', null)).toBe(false)
    expect(isSequentialFormat('AMRAP', CLASSIC)).toBe(false)
  })
  it("explicit 'Repeated Rounds' is NOT sequential", () => {
    expect(isSequentialAmrap('AMRAP', CLASSIC_EXPLICIT)).toBe(false)
    expect(isSequentialFormat('AMRAP', CLASSIC_EXPLICIT)).toBe(false)
  })
  it("only an explicit 'Sequence' flag makes it sequential", () => {
    expect(isSequentialAmrap('AMRAP', SEQ)).toBe(true)
    expect(isSequentialFormat('AMRAP', SEQ)).toBe(true)
  })
  it("'Ascending AMRAP' never becomes sequential (inherently repeated rounds)", () => {
    expect(isSequentialAmrap('Ascending AMRAP', { structure: 'Sequence' })).toBe(false)
  })
  it('AMRAP catalog carries the structure discriminator (For Time vocabulary)', () => {
    expect(getFormat('AMRAP').config.structure.options).toEqual(['Sequence', 'Repeated Rounds'])
    expect(getFormat('AMRAP').config.structure.required).toBe(false)
    expect(getFormat('AMRAP').config.structure.default).toBe('Repeated Rounds')
  })
})

describe('INC-11 §8/§10/§62/§67 - structural resolver', () => {
  it('resolves fixed/open roles from STRUCTURED reps (not display text)', () => {
    const { supported, stations } = resolveSequentialAmrapStations({ instances: BUYIN_MAX_INSTANCES })
    expect(supported).toBe(true)
    expect(stations.map(s => s.role)).toEqual(['fixed', 'fixed', 'open'])
    expect(stations.map(s => s.target)).toEqual([50, 75, null])
    expect(stations.map(s => s.index)).toEqual([1, 2, 3])
  })
  it('legacy text fallback: leading rep count = fixed, none = open', () => {
    const { stations } = resolveSequentialAmrapStations({ lines: BUYIN_MAX_LINES })
    expect(stations.map(s => s.role)).toEqual(['fixed', 'fixed', 'open'])
    expect(stations.map(s => s.target)).toEqual([50, 75, null])
  })
  it('§36/§68 - a repeated movement name stays two distinct stations', () => {
    const { stations } = resolveSequentialAmrapStations({ instances: BUYIN_MAX_INSTANCES })
    expect(stations[0].name).toBe('Task A')
    expect(stations[2].name).toBe('Task A')
    expect(stations[0].index).not.toBe(stations[2].index)
  })
  it('empty movement list -> not supported', () => {
    expect(resolveSequentialAmrapStations({}).supported).toBe(false)
    expect(resolveSequentialAmrapStations({ lines: [] }).supported).toBe(false)
  })
})

describe('INC-11 §42/§44 - mixed-unit sequential is NOT supported (owner decision #2)', () => {
  it('flags a calorie / distance station and refuses to score it', () => {
    const mixed = [
      { name: 'Row', calories: { mode: 'universal', value: 20 }, reps: null },
      { name: 'Task B', reps: { mode: 'universal', value: 30 } },
      { name: 'Run', distance: { value: 400, unit: 'm' }, reps: null },
    ]
    const res = resolveSequentialAmrapStations({ instances: mixed })
    expect(res.supported).toBe(false)
    expect(res.reason).toBe('mixed-unit')
    expect(sequentialAmrapMixedUnitConflict({ instances: mixed })).toBe(true)
  })
  it('text heuristic catches an obvious mixed-unit body', () => {
    expect(sequentialAmrapMixedUnitConflict({ lines: ['20 Calorie Row', '30 Thruster', '400 m Run'] })).toBe(true)
  })
  it('does NOT invent metre + calorie + rep arithmetic - no total produced', () => {
    // a mixed body never reaches sequentialAmrapTotalReps because stations is empty
    const res = resolveSequentialAmrapStations({ lines: ['20 Calorie Row', '30 Thruster'] })
    expect(res.stations).toEqual([])
  })
  it('pure-rep body with numeric prefixes is supported', () => {
    expect(sequentialAmrapMixedUnitConflict({ lines: ['50 Task A', '75 Task B', 'Max Task A'] })).toBe(false)
  })
})

describe('INC-11 §13/§15/§41/§69-§73 - Total Reps computation', () => {
  const stations = resolveSequentialAmrapStations({ instances: BUYIN_MAX_INSTANCES }).stations

  it('§69 - stops in first station: 42 -> total 42, B & C not reached', () => {
    expect(sequentialAmrapTotalReps(stations, ['42', '', ''])).toBe(42)
  })
  it('§70 - stops in middle station: A done, B 63 -> total 113', () => {
    expect(sequentialAmrapTotalReps(stations, ['', '63', ''])).toBe(113) // 50 auto + 63
  })
  it('§71 - reaches open station: 50 + 75 + 12 -> 137', () => {
    expect(sequentialAmrapTotalReps(stations, ['', '', '12'])).toBe(137)
  })
  it('§72 - open station scores zero: 50 + 75 + 0 -> 125 (0 is not missing)', () => {
    expect(sequentialAmrapTotalReps(stations, ['', '', '0'])).toBe(125)
  })
  it('§73 - buy-in exactly at buzzer, open not reached -> 125', () => {
    expect(sequentialAmrapTotalReps(stations, ['50', '75', ''])).toBe(125)
  })
  it('§15 - recording station 3 auto-completes prior FIXED stations', () => {
    expect(autoCompleteSequentialProgress(stations, ['', '', '12'])).toEqual(['50', '75', '12'])
  })
  it('§15 - does NOT auto-complete stations at/after the stopping point', () => {
    expect(autoCompleteSequentialProgress(stations, ['', '30', ''])).toEqual(['50', '30', ''])
  })
  it('§16 - no auto-fill when nothing recorded', () => {
    expect(autoCompleteSequentialProgress(stations, ['', '', ''])).toEqual(['', '', ''])
  })
})

describe('INC-11 §34/§35 - frozen result string (reuses the sequential grammar)', () => {
  const stations = resolveSequentialAmrapStations({ lines: BUYIN_MAX_LINES }).stations

  it('§18/§72 vs §73 - "not reached" (omitted) vs "reached, 0" (present) are distinct in the text', () => {
    const notReached = composeSequentialAmrapResult(stations, ['50', '75', ''])
    const reachedZero = composeSequentialAmrapResult(stations, ['50', '75', '0'])
    expect(notReached).toBe('50/50 Task A, 75/75 Task B')
    expect(reachedZero).toBe('50/50 Task A, 75/75 Task B, 0 Max Reps Task A')
    expect(notReached).not.toBe(reachedZero)
  })
  it('incident case 50/50, 63/75, not reached -> 113', () => {
    const result = composeSequentialAmrapResult(stations, ['', '63', ''])
    expect(result).toBe('50/50 Task A, 63/75 Task B')
    expect(partialRepsOfLog({ result }, true)).toBe(113)
  })
  it('reached open station -> 137', () => {
    const result = composeSequentialAmrapResult(stations, ['', '', '12'])
    expect(partialRepsOfLog({ result }, true)).toBe(137)
  })
  it('round-trips through parseSequentialAmrapResult', () => {
    const result = composeSequentialAmrapResult(stations, ['', '63', ''])
    expect(parseSequentialAmrapResult(result, stations)).toEqual(['50', '63', ''])
  })
  it('round-trips the open-station-zero case distinctly', () => {
    const result = composeSequentialAmrapResult(stations, ['50', '75', '0'])
    expect(parseSequentialAmrapResult(result, stations)).toEqual(['50', '75', '0'])
  })
})

describe('INC-11 §20/§55 - leaderboard ranks by Total Reps, INC-09 selection untouched', () => {
  const stations = resolveSequentialAmrapStations({ lines: BUYIN_MAX_LINES }).stations
  const mkLog = (member, perf, loggedAt) => ({
    member_id: member, logged_at: loggedAt,
    result: composeSequentialAmrapResult(stations, perf), time_result: null, completion_state: null,
  })

  it('137 > 113 > 42', () => {
    const logs = [
      mkLog('a', ['', '', '12'], '2026-09-02T10:00:00Z'), // 137
      mkLog('b', ['', '63', ''], '2026-09-02T10:01:00Z'), // 113
      mkLog('c', ['42', '', ''], '2026-09-02T10:02:00Z'), // 42
    ]
    const ranked = sortSectionLogs(logs, 'AMRAP', SEQ)
    expect(ranked.map(l => l.member_id)).toEqual(['a', 'b', 'c'])
  })
  it('one row per member (dedup within the section comparator, unchanged by INC-11)', () => {
    const logs = [
      mkLog('a', ['', '', '99'], '2026-09-02T10:00:00Z'),
      mkLog('a', ['42', '', ''], '2026-09-02T11:00:00Z'),
      mkLog('b', ['', '63', ''], '2026-09-02T10:30:00Z'),
    ]
    const ranked = sortSectionLogs(logs, 'AMRAP', SEQ)
    expect(ranked.map(l => l.member_id).sort()).toEqual(['a', 'b'])
  })
})

describe('INC-11 §57/§58 - score definition (input shape)', () => {
  const stations = resolveSequentialAmrapStations({ instances: BUYIN_MAX_INSTANCES }).stations

  it('Sequence AMRAP + rep-only stations -> SEQUENTIAL_AMRAP', () => {
    const d = scoreDefinitionFor('AMRAP', SEQ, { sequentialAmrapStations: stations })
    expect(d.kind).toBe('SEQUENTIAL_AMRAP')
    expect(d.stations).toHaveLength(3)
  })
  it('Sequence AMRAP with NO resolvable stations (mixed-unit) -> classic ROUNDS_REPS fallback', () => {
    expect(scoreDefinitionFor('AMRAP', SEQ, {}).kind).toBe('ROUNDS_REPS')
    expect(scoreDefinitionFor('AMRAP', SEQ, { sequentialAmrapStations: [] }).kind).toBe('ROUNDS_REPS')
  })
  it('§74/§102 - classic AMRAP stays ROUNDS_REPS even if stations are passed', () => {
    expect(scoreDefinitionFor('AMRAP', CLASSIC, { sequentialAmrapStations: stations }).kind).toBe('ROUNDS_REPS')
    expect(scoreDefinitionFor('AMRAP', CLASSIC_EXPLICIT, {}).kind).toBe('ROUNDS_REPS')
  })
})

describe('INC-11 §23/§75 - single open-movement AMRAP', () => {
  it('AMRAP: Max reps of one movement -> one open station, Total Reps = performed', () => {
    const { supported, stations } = resolveSequentialAmrapStations({ lines: ['Max Reps Task A'] })
    expect(supported).toBe(true)
    expect(stations).toEqual([{ index: 1, name: 'Max Reps Task A', target: null, role: 'open', line: 'Max Reps Task A' }])
    expect(sequentialAmrapTotalReps(stations, ['57'])).toBe(57)
    const result = composeSequentialAmrapResult(stations, ['57'])
    expect(partialRepsOfLog({ result }, true)).toBe(57)
  })
})

describe('INC-11 §76 - finite sequential rep-only (chipper), one pass', () => {
  const stations = resolveSequentialAmrapStations({ lines: ['50 Task A', '75 Task B', '100 Task C'] }).stations
  it('stops in B at 60 -> 50 + 60 = 110', () => {
    expect(sequentialAmrapTotalReps(stations, ['', '60', ''])).toBe(110)
  })
  it('all three roles are fixed (no open tail)', () => {
    expect(stations.map(s => s.role)).toEqual(['fixed', 'fixed', 'fixed'])
  })
})
