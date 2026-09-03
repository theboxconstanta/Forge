// INC-12 - SEQUENTIAL PROGRESSION / LEADERBOARD CLASSIFICATION INTEGRITY.
//
// For a workout whose FROZEN structure explicitly requires ordered completion
// (everything `isSequentialFormat` covers), leaving a finite/fixed predecessor
// station below its target while a LATER station carries POSITIVE performed reps
// is a departure from the programmed sequential structure. Such a result is
// Modified -> Mixed (its programmed variant and its score are untouched).
//
// Case A (time expired mid-block, no later positive work) stays As Prescribed.
// An explicit later "0" is NOT positive work. Over-log (>= target) is complete.
//
// The signal is derived ONLY from the frozen `result` string ("done/target"
// grammar); no mutable workout, no prescription_snapshot, no performed_prescription.

import { describe, it, expect } from 'vitest'
import {
  sequentialProgressionDeparted,
  resultCompositionModified,
  isMixedCategory,
} from './workoutFormats.js'

const SEQ_AMRAP = { structure: 'Sequence' }              // isSequentialAmrap -> true
const FT_SEQ = { structure: 'Sequence' }                 // For Time / Ladder / Chipper strict
const CLASSIC_AMRAP = { structure: 'Repeated Rounds' }
const RFT_ROUNDS = { rounds: 5 }

// ---------------------------------------------------------------------------
// A. VALID / NOT DEPARTED  (pure helper)
// ---------------------------------------------------------------------------
describe('INC-12 A — sequentialProgressionDeparted: valid progressions', () => {
  it('1. 50/50, 60/75 then STOP (Case A - partial at final reached station)', () => {
    expect(sequentialProgressionDeparted('50/50 A, 60/75 B')).toBe(false)
  })
  it('2. 35/50 only (single incomplete station, no later work)', () => {
    expect(sequentialProgressionDeparted('35/50 A')).toBe(false)
  })
  it('3. 35/50, blank B (blank later station is omitted from the string)', () => {
    // composePartialText omits a blank station entirely -> "35/50 A"
    expect(sequentialProgressionDeparted('35/50 A')).toBe(false)
  })
  it('4. 35/50, 0 B (explicit later zero is NOT positive work - INC-12 §4)', () => {
    expect(sequentialProgressionDeparted('35/50 A, 0 B')).toBe(false)
  })
  it('5. 50/50, 75/75, 5 open C (full valid progression + open station)', () => {
    expect(sequentialProgressionDeparted('50/50 A, 75/75 B, 5 C')).toBe(false)
  })
  it('6. 50/50, 75/75, 0 open C (open reached, performed zero)', () => {
    expect(sequentialProgressionDeparted('50/50 A, 75/75 B, 0 C')).toBe(false)
  })
  it('7. 51/50, 10 B (over-log predecessor counts as complete - INC-12 §7)', () => {
    expect(sequentialProgressionDeparted('51/50 A, 10 B')).toBe(false)
  })
  it('7b. 38/35, 35/50 B (Intermediate over-log then stop)', () => {
    expect(sequentialProgressionDeparted('38/35 A, 35/50 B')).toBe(false)
  })
  it('empty / single-segment strings', () => {
    expect(sequentialProgressionDeparted('')).toBe(false)
    expect(sequentialProgressionDeparted(null)).toBe(false)
    expect(sequentialProgressionDeparted('12:34')).toBe(false)
    expect(sequentialProgressionDeparted('37 C')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// B. DEPARTED  (pure helper)
// ---------------------------------------------------------------------------
describe('INC-12 B — sequentialProgressionDeparted: departures', () => {
  it('8. 35/50, 1 B (minimal positive later work)', () => {
    expect(sequentialProgressionDeparted('35/50 A, 1 B')).toBe(true)
  })
  it('9. 35/50, 50/75 B (second production case - no open station reached, total 85)', () => {
    expect(sequentialProgressionDeparted('35/50 burpee pull-up, 50/75 Russian Kettlebell Swing')).toBe(true)
  })
  it('10. 35/50, 75/75, 5 open C (the observed incident - total 115)', () => {
    expect(sequentialProgressionDeparted('35/50 burpee pull-up, 75/75 Russian Kettlebell Swing, 5 Max. Reps burpee pull-ups')).toBe(true)
  })
  it('11. 50/50, 60/75, 1 C (short middle predecessor, positive open work)', () => {
    expect(sequentialProgressionDeparted('50/50 A, 60/75 B, 1 C')).toBe(true)
  })
  it('12. 10/10, 7/20, 12 C (strict For Time / Chipper equivalent)', () => {
    expect(sequentialProgressionDeparted('10/10 A, 7/20 B, 12 C')).toBe(true)
  })
  it('departure at the FIRST predecessor even with a complete later block', () => {
    expect(sequentialProgressionDeparted('5/10 A, 20/20 B')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C. STRUCTURAL GATE via resultCompositionModified
// ---------------------------------------------------------------------------
describe('INC-12 C — resultCompositionModified only evaluates the term for strict-sequential frozen formats', () => {
  const departedResult = '35/50 A, 75/75 B, 5 C'
  const clean = { result: departedResult, weight_logged: null, performed_prescription: null }

  it('Sequence AMRAP -> Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(true)
  })
  it('For Time (Sequence) -> Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'For Time', FT_SEQ)).toBe(true)
  })
  it('Chipper -> Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'Chipper', {})).toBe(true)
  })
  it('Ladder -> Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'Ladder', {})).toBe(true)
  })
  it('Buy-In/Cash-Out (non-AMRAP main) -> Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'Buy-In/Cash-Out', { mainFormat: 'For Time' })).toBe(true)
  })
  it('15/16. classic repeated-round AMRAP -> NOT Modified (structure absent / Repeated Rounds)', () => {
    expect(resultCompositionModified(clean, null, null, null, 'AMRAP', CLASSIC_AMRAP)).toBe(false)
    expect(resultCompositionModified(clean, null, null, null, 'AMRAP', {})).toBe(false)
  })
  it('16. RFT / Repeated Rounds -> NOT Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'RFT', RFT_ROUNDS)).toBe(false)
    expect(resultCompositionModified(clean, null, null, null, 'For Time', { structure: 'Repeated Rounds' })).toBe(false)
  })
  it('17. structured interval (EMOM) -> NOT Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'EMOM', {})).toBe(false)
  })
  it('18. sets / strength family -> NOT Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, 'Weightlifting', {})).toBe(false)
    expect(resultCompositionModified(clean, null, null, null, 'Strength Sets', {})).toBe(false)
  })
  it('21. legacy log with NO frozen format (formatId null) -> term skipped, NOT Modified', () => {
    expect(resultCompositionModified(clean, null, null, null, null, null)).toBe(false)
    expect(resultCompositionModified(clean, null, null, null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D. HISTORICAL SAFETY
// ---------------------------------------------------------------------------
describe('INC-12 D — historical safety', () => {
  it('20. frozen Sequence structure + frozen targets in the result string -> deterministic', () => {
    const historical = {
      result: '35/50 burpee pull-up, 75/75 Russian Kettlebell Swing, 5 Max. Reps burpee pull-ups',
      weight_logged: null, performed_prescription: null,
    }
    expect(resultCompositionModified(historical, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(true)
  })
  it('21. a Sequence result string but NO frozen format -> not newly classified', () => {
    const historical = { result: '35/50 A, 75/75 B, 5 C', weight_logged: null, performed_prescription: null }
    expect(resultCompositionModified(historical, null, null, null, undefined, undefined)).toBe(false)
  })
  it('valid historical Sequence progression stays clean', () => {
    const ok = { result: '50/50 burpee pull-up, 75/75 Russian Kettlebell Swing, 4 Max. Reps burpee pull-ups', weight_logged: null, performed_prescription: null }
    expect(resultCompositionModified(ok, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E. CLASSIFICATION INTEGRATION - existing reasons + parity
// ---------------------------------------------------------------------------
describe('INC-12 E — integration with the existing composition authority', () => {
  it('22. RX + clean sequential progress -> not Modified', () => {
    const log = { result: '50/50 A, 60/75 B', weight_logged: null, performed_prescription: null }
    expect(resultCompositionModified(log, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(false)
  })
  it('23/24. any tier + sequential departure -> Modified (tier provenance not read)', () => {
    const log = { result: '35/50 A, 75/75 B, 5 C', weight_logged: null, performed_prescription: null }
    expect(resultCompositionModified(log, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(true)
  })
  it('25. existing reasons still fire independently (sub-standard load)', () => {
    const log = { result: '50/50 A, 75/75 B, 4 C', weight_logged: '40', performed_prescription: null }
    expect(resultCompositionModified(log, '61', null, null, 'AMRAP', SEQ_AMRAP)).toBe(true)
  })
  it('25b. existing reasons still fire (movement list changed)', () => {
    const log = { result: '50/50 A, 75/75 B, 4 C', weight_logged: null, performed_prescription: null }
    expect(resultCompositionModified(log, null, ['Ring Row'], ['Pull-up'], 'AMRAP', SEQ_AMRAP)).toBe(true)
  })
  it('25c. existing reasons still fire (performed_prescription != null)', () => {
    const log = { result: '50/50 A, 75/75 B, 4 C', weight_logged: null, performed_prescription: { v: 1 } }
    expect(resultCompositionModified(log, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(true)
  })
  it('26. capped/incomplete-only RX (Case A) remains not Modified', () => {
    const log = { result: '35/50 A', weight_logged: null, performed_prescription: null }
    expect(resultCompositionModified(log, null, null, null, 'AMRAP', SEQ_AMRAP)).toBe(false)
  })
  it('27. isMixedCategory (leaderboard bucket) === resultCompositionModified (badge) for a departure', () => {
    const departed = '35/50 A, 75/75 B, 5 C'
    const bucket = isMixedCategory(null, null, null, null, null, { result: departed, formatId: 'AMRAP', formatConfig: SEQ_AMRAP })
    const badge = resultCompositionModified({ result: departed, weight_logged: null, performed_prescription: null }, null, null, null, 'AMRAP', SEQ_AMRAP)
    expect(bucket).toBe(true)
    expect(badge).toBe(true)
    expect(bucket).toBe(badge)
  })
  it('27b. isMixedCategory pre-INC-12 call shape (no opts) is unchanged', () => {
    expect(isMixedCategory(null, null, null, null)).toBe(false)
    expect(isMixedCategory('40', '61', null, null)).toBe(true) // sub-standard still works
  })
})

// ---------------------------------------------------------------------------
// F. SCORE UNCHANGED  (arithmetic is not this ticket's concern - documented here)
// ---------------------------------------------------------------------------
describe('INC-12 F — the frozen result string (and therefore the score) is never rewritten', () => {
  it('28. 35/50 + 75/75 + 5 -> classification changes, string is read-only', () => {
    const result = '35/50 burpee pull-up, 75/75 Russian Kettlebell Swing, 5 Max. Reps burpee pull-ups'
    const before = result
    sequentialProgressionDeparted(result)
    resultCompositionModified({ result, weight_logged: null, performed_prescription: null }, null, null, null, 'AMRAP', SEQ_AMRAP)
    expect(result).toBe(before) // 35 + 75 + 5 = 115 stays 115
  })
  it('29. 35/50 + 50/75 -> string read-only (35 + 50 = 85 stays 85)', () => {
    const result = '35/50 burpee pull-up, 50/75 Russian Kettlebell Swing'
    const before = result
    resultCompositionModified({ result, weight_logged: null, performed_prescription: null }, null, null, null, 'AMRAP', SEQ_AMRAP)
    expect(result).toBe(before)
  })
})
