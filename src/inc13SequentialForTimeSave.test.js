// INC-13 - plain sequential For Time (NOT Sequence AMRAP) save-validation
// failure.
//
// TimeScoreBlock's Finished/Did-not-finish toggle clears wodTime to '' and,
// for a sequential format (isSequentialFormat - For Time-Sequence/Chipper/
// Ladder/Buy-In-Cash-Out non-AMRAP), renders PartialRepsRows writing every
// movement's completed reps into wodPartialReps - the SAME state slot Sequence
// AMRAP uses. composeWodLogFieldsInner's `useReps && isSequential` branch
// already derives the frozen "done/target" result string from exactly that
// state (repsEfectiveSecvential + composePartialText), and downstream
// classification (sequentialProgressionDeparted) and ranking (partialRepsOfLog)
// already read that frozen string correctly - none of that needed to change.
//
// The bug was ONLY in saveWodLog's "does this log have a result?" guard
// (areContiut / areContiutSectiune): INC-11.1 OR'd in a check for
// wodPartialReps, but gated it on isSequentialAmrap - the Sequence-AMRAP
// SUBTYPE only. A plain 'For Time' with structure absent (isSequentialAmrap
// false, isSequentialFormat true) fell through every existing term and a
// fully-logged capped result ("21/21, 21/21, 15/15, 15/15, 9/9, 1/9" -> 82)
// was rejected as "Fill in at least the result, time, or a movement!".
//
// Fix: the SAME shared helper (hasSequentialAmrapInput - explicit "0" counts,
// blank does not), OR'd in a second time, gated on isSequentialFormat AND Time
// being empty (mirrors composeWodLogFieldsInner's own useReps condition
// exactly - the guard is never a second source of truth for "which branch is
// this").

import { describe, it, expect } from 'vitest'
import { hasSequentialAmrapInput } from './sequentialAmrap'
import {
  isSequentialFormat, isSequentialAmrap, composePartialText, partialRepsOfLog,
  sequentialProgressionDeparted, resultCompositionModified, deriveDurationCompletionState,
} from './workoutFormats'

// The exact guard expression from App.jsx saveWodLog, reduced to the part
// INC-13 changes (mirrors inc11_1SequentialAmrapSave.test.js's guardAccepts).
const guardAccepts = ({ formatId, config, wodTime, partialReps, legacyEmpty = true }) => {
  const seqAmrap = isSequentialAmrap(formatId, config) && hasSequentialAmrapInput(partialReps)
  const seqPartial = isSequentialFormat(formatId, config) && !(wodTime || '').trim() && hasSequentialAmrapInput(partialReps)
  return !!(wodTime || '').trim() || seqAmrap || seqPartial || !legacyEmpty
}

const FORTIME_SEQ = { timeCapSec: 600 } // structure absent -> sequential (not 'Repeated Rounds')
const MOVES = ['21 Clean and jerks', '21 Cal Air Bike', '15 Clean & Jerk', '15 Cal Air Bike', '9 Clean & Jerk', '9 Cal Air Bike']

describe('INC-13 - the save guard recognizes plain sequential For Time partial progress', () => {
  it('CASE 3 (THE PRODUCTION INCIDENT): 21/21/15/15/9/1 -> saves, aggregate 82', () => {
    const partial = ['21', '21', '15', '15', '9', '1']
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: partial })).toBe(true)
    const result = composePartialText(partial, MOVES)
    expect(result).toBe('21/21 Clean and jerks, 21/21 Cal Air Bike, 15/15 Clean & Jerk, 15/15 Cal Air Bike, 9/9 Clean & Jerk, 1/9 Cal Air Bike')
    expect(partialRepsOfLog({ result }, true)).toBe(82)
    expect(deriveDurationCompletionState(true)).toBe('capped')
  })

  it('CASE 4: 21/21/15/15/9/0 (explicit final zero) -> saves, aggregate 81', () => {
    const partial = ['21', '21', '15', '15', '9', '0']
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: partial })).toBe(true)
    const result = composePartialText(partial, MOVES)
    expect(result).toMatch(/, 0\/9 Cal Air Bike$/)
    expect(partialRepsOfLog({ result }, true)).toBe(81)
  })

  it('CASE 5: all-zero explicit partials -> preserves INC-11.1 owner decision #3 (explicit 0 = a result), aggregate 0', () => {
    const partial = ['0', '0', '0', '0', '0', '0']
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: partial })).toBe(true)
    const result = composePartialText(partial, MOVES)
    expect(partialRepsOfLog({ result }, true)).toBe(0)
  })

  it('CASE 5b: a genuinely empty capped log (no partials at all) still does NOT save', () => {
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: [] })).toBe(false)
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: ['', '', '', '', '', ''] })).toBe(false)
  })

  it('CASE 6: only the first station touched, all later stations explicit 0 -> saves, aggregate 10', () => {
    const partial = ['10', '0', '0', '0', '0', '0']
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: partial })).toBe(true)
    const result = composePartialText(partial, MOVES)
    expect(partialRepsOfLog({ result }, true)).toBe(10)
  })

  it('CASE 1: Finished with a valid time -> saves (Time alone already satisfies the guard, unaffected by this fix)', () => {
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '8:42', partialReps: [] })).toBe(true)
  })

  it('CASE 2: Finished, no time, nothing else -> does NOT save', () => {
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '', partialReps: [] })).toBe(false)
  })

  it('once a real Time exists, stray leftover partials never bypass a genuinely-Finished save path (no double meaning)', () => {
    // Time present -> !wodTime.trim() is false -> seqPartial term never fires;
    // wodTime.trim() itself already satisfies the guard (unrelated OR branch).
    expect(guardAccepts({ formatId: 'For Time', config: FORTIME_SEQ, wodTime: '8:42', partialReps: ['5', '', '', '', '', ''] })).toBe(true)
  })
})

describe('INC-13 §7 - sequential progression integrity (INC-12) is untouched by this fix', () => {
  it('CASE 7: incomplete predecessor (10/21) + later positive work (1/9) IS a structural departure', () => {
    const result = composePartialText(['21', '10', '15', '15', '9', '1'], MOVES)
    expect(sequentialProgressionDeparted(result)).toBe(true)
  })
  it('the production incident itself (21/21/15/15/9/1) is NOT a structural departure (only the final reached station is partial)', () => {
    const result = composePartialText(['21', '21', '15', '15', '9', '1'], MOVES)
    expect(sequentialProgressionDeparted(result)).toBe(false)
  })
})

describe('INC-13 §11/§12 - completion never demotes prescription; performed modification is independent', () => {
  it('CASE 8: RX, capped, movements/weight untouched -> As Prescribed (not Modified), regardless of capping', () => {
    const result = composePartialText(['21', '21', '15', '15', '9', '1'], MOVES)
    const modified = resultCompositionModified(
      { weight_logged: null, performed_prescription: null, result },
      null, MOVES, MOVES, 'For Time', FORTIME_SEQ,
    )
    expect(modified).toBe(false)
  })
  it('CASE 9: RX, capped, WITH an independent performed-prescription departure -> Modified, capped score still derives from the frozen result alone', () => {
    const result = composePartialText(['21', '21', '15', '15', '9', '1'], MOVES)
    const modified = resultCompositionModified(
      { weight_logged: null, performed_prescription: { movements: [{ name: 'Row' }] }, result },
      null, MOVES, MOVES, 'For Time', FORTIME_SEQ,
    )
    expect(modified).toBe(true)
    // the capped fix never reads performed_prescription for the aggregate
    expect(partialRepsOfLog({ result }, true)).toBe(82)
  })
})

describe('INC-13 §14 - no regression to Sequence AMRAP or non-sequential formats', () => {
  it('a Sequence AMRAP still routes through its own (untouched) term', () => {
    expect(isSequentialAmrap('AMRAP', { structure: 'Sequence' })).toBe(true)
    expect(guardAccepts({ formatId: 'AMRAP', config: { structure: 'Sequence' }, wodTime: '', partialReps: ['50', '75', '14'] })).toBe(true)
  })
  it('a non-sequential For Time (structure: Repeated Rounds) never triggers the new term', () => {
    expect(isSequentialFormat('For Time', { structure: 'Repeated Rounds' })).toBe(false)
    expect(guardAccepts({ formatId: 'For Time', config: { structure: 'Repeated Rounds' }, wodTime: '', partialReps: ['5', '5', '5'] })).toBe(false)
  })
  it('a classic (non-sequential) AMRAP never triggers the new term', () => {
    expect(isSequentialFormat('AMRAP', { durationSec: 600 })).toBe(false)
    expect(guardAccepts({ formatId: 'AMRAP', config: { durationSec: 600 }, wodTime: '', partialReps: ['5', '5', '5'] })).toBe(false)
  })
})
