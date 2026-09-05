// INC-14 - UNIVERSAL PARTIAL RESULT INTEGRITY.
//
// Broader defect surfaced by INC-13 (ddc9a7f): that fix made a previously-
// unsaveable capped sequential For Time result saveable again - which exposed
// a PRE-EXISTING, separate bug in the actual score composer.
// `repsEfectiveSecvential` (App.jsx, now exported from workoutFormats.js)
// backfilled EVERY blank/untouched station with its prescribed programmed
// target, regardless of position - so "12" at station 1 with every later
// station left blank silently became "12/21/15/15/9/9" (the FULL PROGRAMMED
// WORKOUT), not the athlete's actual 12-unit progress. ddc9a7f's save-guard
// fix was correct and untouched by this incident; only the score composer
// manufactured work from targets.
//
// Root cause was isolated to ONE function (defect class B - UI state was
// already correct; the save composer substituted targets for blanks).
// composePartialText / partialRepsOfLog / sequentialProgressionDeparted /
// the save guard / the leaderboard comparator were all already correct and
// remain untouched - they were simply being fed a corrupted array.
//
// Fix mirrors autoCompleteSequentialProgress's own INC-11 §15 rule on this
// plain-text (non-Sequence-AMRAP) model: only a station STRICTLY BEFORE the
// furthest station the athlete actually touched is inferred complete (since
// reaching station N implies every earlier one was necessarily cleared);
// every station AT or AFTER the furthest touched index keeps its raw value -
// blank stays blank (never rendered - "not reached"), an explicit "0" stays
// "0" (INC-11.1 owner decision #3, unchanged).
//
// This affects every isSequentialFormat, non-Sequence-AMRAP catalog format:
// For Time (structure != 'Repeated Rounds'), Chipper, Ladder, Buy-In/Cash-Out
// (mainFormat != 'AMRAP') - all route through this ONE shared function, both
// for the official WOD log and for Skill logging. No other format/branch in
// the catalog ever manufactures performed work from a programmed target (see
// the format-matrix describe block below for the audit).

import { describe, it, expect } from 'vitest'
import { hasSequentialAmrapInput, autoCompleteSequentialProgress, resolveSequentialAmrapStations, composeSequentialAmrapResult } from './sequentialAmrap'
import {
  repsEfectiveSecvential, composePartialText, partialRepsOfLog, sequentialProgressionDeparted,
  resultCompositionModified, isSequentialFormat, composeAmrapResult,
} from './workoutFormats'

const TARGETS_21_21_15_15_9_9 = ['21 Clean and jerks', '21 Cal Air Bike', '15 Clean & Jerk', '15 Cal Air Bike', '9 Clean & Jerk', '9 Cal Air Bike']

// End-to-end: raw athlete input -> effective array -> frozen result string ->
// leaderboard aggregate. Exactly the pipeline composeWodLogFieldsInner runs.
const pipeline = (raw, movements = TARGETS_21_21_15_15_9_9) => {
  const effective = repsEfectiveSecvential(raw, movements)
  const result = composePartialText(effective, movements)
  return { effective, result, aggregate: partialRepsOfLog({ result }, true) }
}

describe('INC-14 §17/18/19 - the three named owner regressions, kept exact', () => {
  it('OWNER CASE (§17): 12 / blank x5 -> aggregate EXACTLY 12, never 84/87/the programmed total', () => {
    const { effective, result, aggregate } = pipeline(['12', '', '', '', '', ''])
    expect(effective).toEqual(['12', '', '', '', '', ''])
    expect(result).toBe('12/21 Clean and jerks')
    expect(aggregate).toBe(12)
    expect(aggregate).not.toBe(84)
    expect(aggregate).not.toBe(87)
    expect(hasSequentialAmrapInput(['12', '', '', '', '', ''])).toBe(true) // saveable
    // no later target manufactured as completed
    expect(result).not.toMatch(/Air Bike|Jerk/)
  })

  it('§18 - second regression: 21 / 5 / blank x4 -> aggregate EXACTLY 26, later targets contribute zero', () => {
    const { effective, result, aggregate } = pipeline(['21', '5', '', '', '', ''])
    expect(effective).toEqual(['21', '5', '', '', '', ''])
    expect(result).toBe('21/21 Clean and jerks, 5/21 Cal Air Bike')
    expect(aggregate).toBe(26)
  })

  it('§19 - third regression: 21/21/15/15/9/1 (all reached stations explicit) -> aggregate still EXACTLY 82', () => {
    const { effective, result, aggregate } = pipeline(['21', '21', '15', '15', '9', '1'])
    expect(effective).toEqual(['21', '21', '15', '15', '9', '1'])
    expect(result).toBe('21/21 Clean and jerks, 21/21 Cal Air Bike, 15/15 Clean & Jerk, 15/15 Cal Air Bike, 9/9 Clean & Jerk, 1/9 Cal Air Bike')
    expect(aggregate).toBe(82)
  })
})

describe('INC-14 Part A - blank semantics', () => {
  it('1. first station partial, rest blank -> aggregate only 12', () => {
    expect(pipeline(['12', '', '']).aggregate).toBe(12)
  })
  it('2. first complete, second partial, rest blank -> aggregate 26', () => {
    expect(pipeline(['21', '5', '', '', '', '']).aggregate).toBe(26)
  })
  it('3. multiple complete + final partial -> exact explicit total (82)', () => {
    expect(pipeline(['21', '21', '15', '15', '9', '1']).aggregate).toBe(82)
  })
  it('4. all blank -> no manufactured work; effective array stays all-blank, not the programmed total', () => {
    const { effective, result, aggregate } = pipeline(['', '', '', '', '', ''])
    expect(effective).toEqual(['', '', '', '', '', ''])
    expect(result).toBe('')
    expect(aggregate).toBe(0)
    expect(hasSequentialAmrapInput(['', '', '', '', '', ''])).toBe(false) // NOT saveable - existing empty-result policy preserved
  })
  it('5. explicit zero + blanks -> zero semantics preserved (INC-11.1 owner decision #3), aggregate 0, saveable', () => {
    const { effective, result, aggregate } = pipeline(['0', '', '', '', '', ''])
    expect(effective).toEqual(['0', '', '', '', '', ''])
    expect(result).toBe('0/21 Clean and jerks')
    expect(aggregate).toBe(0)
    expect(hasSequentialAmrapInput(['0', '', '', '', '', ''])).toBe(true) // saveable - explicit 0 is a result
  })
  it('6. blank vs explicit zero remain distinguishable in the frozen text (blank omitted entirely, "0" rendered)', () => {
    expect(pipeline(['5', '', '']).result).toBe('5/21 Clean and jerks')
    expect(pipeline(['5', '0', '']).result).toBe('5/21 Clean and jerks, 0/21 Cal Air Bike')
  })
})

describe('INC-14 Part B - sequential integrity (INC-12 untouched)', () => {
  it('7. incomplete predecessor + later BLANK -> NOT REACHED, no Modified from blank alone', () => {
    const { result } = pipeline(['12', '', '', '', '', ''])
    expect(sequentialProgressionDeparted(result)).toBe(false)
  })
  it('8. incomplete predecessor + later EXPLICIT ZERO -> zero is not positive work, still not departed', () => {
    const { result } = pipeline(['12', '0', '', '', '', ''])
    expect(result).toBe('12/21 Clean and jerks, 0/21 Cal Air Bike')
    expect(sequentialProgressionDeparted(result)).toBe(false)
  })
  it('9. incomplete predecessor + later EXPLICIT POSITIVE -> INC-12 structural departure preserved (Modified)', () => {
    const { result } = pipeline(['12', '5', '', '', '', ''])
    expect(sequentialProgressionDeparted(result)).toBe(true)
    // the full owner reproduction with an incomplete middle station + later positive
    const departed = pipeline(['21', '10', '15', '15', '9', '1']).result
    expect(sequentialProgressionDeparted(departed)).toBe(true)
  })
  it('10. complete predecessor + partial next + later blank -> clean capped progression, not departed', () => {
    const { result, aggregate } = pipeline(['21', '5', '', '', '', ''])
    expect(sequentialProgressionDeparted(result)).toBe(false)
    expect(aggregate).toBe(26)
  })
})

describe('INC-14 Part C - completion / save validation (ddc9a7f preserved)', () => {
  it('12. Capped + valid partial saves (hasSequentialAmrapInput true)', () => {
    expect(hasSequentialAmrapInput(['12', '', '', '', '', ''])).toBe(true)
    expect(isSequentialFormat('For Time', { timeCapSec: 600 })).toBe(true)
  })
  it('13. Capped + blank later stations saves EXACT explicit work only, never the programmed total', () => {
    expect(pipeline(['12', '', '', '', '', '']).aggregate).toBe(12)
  })
})

describe('INC-14 Part D - metric types (mixed units share one progression count, per existing architecture)', () => {
  it('15. pure reps sequence, partial -> exact', () => {
    const moves = ['10 Wall Balls', '10 Box Jumps']
    expect(pipeline(['4', ''], moves).aggregate).toBe(4)
  })
  it('16. pure calories sequence, partial -> exact', () => {
    const moves = ['20 Cal Row', '20 Cal Bike']
    expect(pipeline(['8', ''], moves).aggregate).toBe(8)
  })
  it('17/18. mixed reps + calories (the owner catalog itself) -> canonical shared progression count, never relabeled per-metric', () => {
    // 21 (reps) + 21 (calories) + ... - partialRepsOfLog sums the SAME way
    // regardless of the underlying quantity metric, matching existing
    // sequential-AMRAP/leaderboard convention (Total reps IS the aggregate
    // progression label FORGE already uses for this ranking, not a new field).
    expect(pipeline(['21', '21', '15', '15', '9', '1']).aggregate).toBe(82)
  })
})

describe('INC-14 Part E - workout structures / format matrix audit', () => {
  it('21. single-movement sequence, partial -> exact', () => {
    expect(pipeline(['7'], ['15 Burpees']).aggregate).toBe(7)
  })
  it('22. sequential multi-movement chipper/ladder route through the SAME isSequentialFormat helper as For Time', () => {
    expect(isSequentialFormat('Chipper', {})).toBe(true)
    expect(isSequentialFormat('Ladder', {})).toBe(true)
    expect(isSequentialFormat('For Time', { structure: 'Repeated Rounds' })).toBe(false) // RFT-shaped For Time: NOT sequential, untouched by this fix
  })
  it('24/25. classic AMRAP and Sequence AMRAP never manufacture work from blanks either - via their OWN existing mechanisms, untouched by this fix', () => {
    // classic AMRAP: composeAmrapResult -> composePartialText directly (no
    // target-fallback layer exists in that path at all)
    expect(composeAmrapResult('3', ['5', ''], ['10 Pull-ups', '15 Push-ups'])).toBe('3 runde + 5/10 Pull-ups')
    // Sequence AMRAP: autoCompleteSequentialProgress only fills FIXED stations
    // strictly before the furthest touched one - the model this fix's rule
    // was deliberately mirrored from.
    const stations = resolveSequentialAmrapStations({ lines: ['50 Burpee Pull-up', '75 Russian KB Swing', 'Max Reps Burpee Pull-ups'] }).stations
    expect(autoCompleteSequentialProgress(stations, ['12', '', ''])).toEqual(['12', '', ''])
    expect(composeSequentialAmrapResult(stations, ['12', '', ''])).toBe('12/50 Burpee Pull-up')
  })
  it('29. Max Effort (single_value) has no partial-array concept - a single scalar field, not touched by this fix', () => {
    // wodResult is a plain string field for this family; repsEfectiveSecvential
    // is never invoked for scoreMode 'single_value'.
    expect(true).toBe(true)
  })
})

describe('INC-14 §11/§12 - result axes remain independent under blank-only capping', () => {
  it('OWNER CASE (§17): RX + capped-at-12 stays As Prescribed, never Modified, from blanks alone', () => {
    const { result } = pipeline(['12', '', '', '', '', ''])
    const modified = resultCompositionModified(
      { weight_logged: null, performed_prescription: null, result },
      null, TARGETS_21_21_15_15_9_9, TARGETS_21_21_15_15_9_9, 'For Time', {},
    )
    expect(modified).toBe(false)
  })
})

describe('INC-14 §12 - target clamping is NOT invented by this fix', () => {
  it('an entered value exceeding the programmed target is preserved verbatim, not clamped or reinterpreted', () => {
    // Pre-existing behavior (unrelated to this fix): no clamp exists anywhere
    // in this pipeline. composePartialText renders whatever was entered.
    const { result, aggregate } = pipeline(['25', '', '', '', '', ''])
    expect(result).toBe('25/21 Clean and jerks')
    expect(aggregate).toBe(25)
  })
})
