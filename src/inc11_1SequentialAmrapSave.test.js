// INC-11.1 - Sequential AMRAP save-validation failure.
//
// INC-11 shipped: structure resolution, logger UI and the live Total were all
// correct, but `saveWodLog`'s "does this log have a result?" guard
// (`areContiut` / `areContiutSectiune`) checked only pre-INC-11 fields
// (wodResult / wodRoundsCompleted / wodTime / wodMiscari / wodSets / wodCompleted
// / chained) - it never looked at `wodPartialReps`, where SequentialAmrapFields
// stores every station value. So a fully-logged sequential result
// (50/50, 75/75, 14 -> TOTAL 139) was rejected as "Fill in at least the result,
// time, or a movement!".
//
// Fix: `hasSequentialAmrapInput(wodPartialReps)` - the SAME helper the logger's
// Total is derived from - is OR'd into both guards, gated by
// `isSequentialAmrap(activeLogFormatId, activeLogFormatConfig)`. Explicit "0"
// counts; a blank station does not; NEVER numeric truthiness.

import { describe, it, expect } from 'vitest'
import {
  hasSequentialAmrapInput, resolveSequentialAmrapStations,
  composeSequentialAmrapResult, autoCompleteSequentialProgress,
} from './sequentialAmrap'
import { partialRepsOfLog, isSequentialAmrap } from './workoutFormats'

// The exact guard expression from App.jsx saveWodLog, reduced to the part
// INC-11.1 changes. `legacyEmpty` = every pre-INC-11 signal is empty.
const guardAccepts = ({ formatId, config, partialReps, legacyEmpty = true }) => {
  const seqAmrap = isSequentialAmrap(formatId, config) && hasSequentialAmrapInput(partialReps)
  return seqAmrap || !legacyEmpty
}

const BUYIN_MAX = resolveSequentialAmrapStations({
  lines: ['50 Burpee Pull-up', '75 Russian Kettlebell Swing', 'Max Reps Burpee Pull-ups'],
}).stations
const SEQ = { durationSec: 600, structure: 'Sequence' }

describe('INC-11.1 §7 - hasSequentialAmrapInput (result presence, never truthiness)', () => {
  it('an explicit "0" on any station = a result (owner decision #3)', () => {
    expect(hasSequentialAmrapInput(['0'])).toBe(true)
    expect(hasSequentialAmrapInput(['', '', '0'])).toBe(true)
    expect(hasSequentialAmrapInput(['0', '', ''])).toBe(true)
  })
  it('a blank / untouched logger = no result', () => {
    expect(hasSequentialAmrapInput([])).toBe(false)
    expect(hasSequentialAmrapInput(['', '', ''])).toBe(false)
    expect(hasSequentialAmrapInput([undefined, null, ''])).toBe(false)
    expect(hasSequentialAmrapInput(['   '])).toBe(false)
  })
  it('any explicit value = a result', () => {
    expect(hasSequentialAmrapInput(['42', '', ''])).toBe(true)
    expect(hasSequentialAmrapInput(['', '63', ''])).toBe(true)
    expect(hasSequentialAmrapInput(['50', '75', '14'])).toBe(true)
  })
})

describe('INC-11.1 §5 - the save guard accepts every meaningful sequential state', () => {
  const total = (perf) => partialRepsOfLog({ result: composeSequentialAmrapResult(BUYIN_MAX, perf) }, true)

  it('A. 42 / — / —  -> saves, canonical 42', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['42', '', ''] })).toBe(true)
    expect(total(['42', '', ''])).toBe(42)
  })
  it('B. 50 / 63 / —  -> saves, canonical 113', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['50', '63', ''] })).toBe(true)
    expect(total(['50', '63', ''])).toBe(113)
  })
  it('C. 50 / 75 / 14  -> saves, canonical 139 (THE PRODUCTION INCIDENT)', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['50', '75', '14'] })).toBe(true)
    expect(total(['50', '75', '14'])).toBe(139)
    expect(composeSequentialAmrapResult(BUYIN_MAX, ['50', '75', '14']))
      .toBe('50/50 Burpee Pull-up, 75/75 Russian Kettlebell Swing, 14 Max Reps Burpee Pull-ups')
  })
  it('D. 50 / 75 / 0  -> saves, canonical 125, explicit zero preserved in the text', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['50', '75', '0'] })).toBe(true)
    expect(total(['50', '75', '0'])).toBe(125)
    expect(composeSequentialAmrapResult(BUYIN_MAX, ['50', '75', '0'])).toMatch(/, 0 /)
  })
  it('E. 50 / 75 / open untouched  -> saves, canonical 125, open omitted (not reached)', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['50', '75', ''] })).toBe(true)
    expect(total(['50', '75', ''])).toBe(125)
    expect(composeSequentialAmrapResult(BUYIN_MAX, ['50', '75', ''])).toBe('50/50 Burpee Pull-up, 75/75 Russian Kettlebell Swing')
  })
  it('F. all stations untouched  -> does NOT save (empty-result rejection preserved)', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['', '', ''] })).toBe(false)
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: [] })).toBe(false)
  })
  it('§8 - only the open station recorded still saves (prior fixed auto-completed)', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['', '', '14'] })).toBe(true)
    expect(autoCompleteSequentialProgress(BUYIN_MAX, ['', '', '14'])).toEqual(['50', '75', '14'])
    expect(total(['', '', '14'])).toBe(139)
  })
})

describe('INC-11.1 §6 - single open-movement sequential AMRAP', () => {
  const st = resolveSequentialAmrapStations({ lines: ['Max Burpees'] }).stations
  it('37 -> saves, canonical 37', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['37'] })).toBe(true)
    expect(partialRepsOfLog({ result: composeSequentialAmrapResult(st, ['37']) }, true)).toBe(37)
  })
  it('explicit 0 -> saves, canonical 0', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: ['0'] })).toBe(true)
    expect(composeSequentialAmrapResult(st, ['0'])).toBe('0 Max Burpees')
    expect(partialRepsOfLog({ result: composeSequentialAmrapResult(st, ['0']) }, true)).toBe(0)
  })
  it('blank -> does NOT save', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: [''] })).toBe(false)
  })
})

describe('INC-11.1 §14/§15 - no regression to other formats', () => {
  it('classic repeated-round AMRAP is NOT routed through the sequential guard', () => {
    // classic AMRAP: structure absent -> isSequentialAmrap false -> the OR term
    // is false; a classic log with only partialReps and no rounds still relies
    // on wodRoundsCompleted (unchanged legacy behaviour).
    expect(isSequentialAmrap('AMRAP', { durationSec: 600 })).toBe(false)
    expect(guardAccepts({ formatId: 'AMRAP', config: { durationSec: 600 }, partialReps: ['5', '5', '5'] })).toBe(false)
  })
  it('a Sequence AMRAP with legacy fields set still saves (OR, not replace)', () => {
    expect(guardAccepts({ formatId: 'AMRAP', config: SEQ, partialReps: [], legacyEmpty: false })).toBe(true)
  })
  it('non-AMRAP formats never trigger the sequential term', () => {
    expect(isSequentialAmrap('For Time', { structure: 'Sequence' })).toBe(false)
    expect(isSequentialAmrap('Intervals', {})).toBe(false)
    expect(isSequentialAmrap('Chained AMRAP', {})).toBe(false)
  })
})
