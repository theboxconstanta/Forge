import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resultCompositionModified, isMixedCategory, effectiveScoreMode } from './workoutFormats.js'

// P9.5.6 — GLOBAL RESULT CLASSIFICATION CONTRACT
//
// THREE INDEPENDENT AXES:
//   A  PROGRAMMED VARIANT       = log.variant_level  (identity - never changes)
//   B  PRESCRIPTION STATUS      = resultCompositionModified(log, prescribedWeight,
//                                 loggedMovements, prescribedMovements)
//                                 = weight below the SELECTED variant's standard
//                                 OR movement substitution OR performed_prescription
//   C  COMPLETION / PERFORMANCE = completion_state / time_result / result / score
//
// Axis B reads NOTHING from Axis C. The badge and the leaderboard bucket are the
// SAME rule (resultCompositionModified). "Not RX'd" wording is DISPLAY only and
// applies to the RX variant; a modified non-RX result reads "Modified".
//
// `mods` produces an Axis-B modification WITHOUT touching Axis A or C:
const MOD_PERF = { version: 1, variantKey: 'x', movements: [{ instanceId: 'mi_x', name: 'Row', load: { mode: 'universal', value: 40, unit: 'kg' } }] }
const PROG = ['21 Thrusters', '15 Pull-ups']
const SUB = ['21 Thrusters', '15 Ring Rows']

// Build a log for a given variant + completion, optionally modified.
function log({ variant, completion, modified = false, prescribedWeight = '43', extra = {} }) {
  const base = { variant_level: variant, weight_logged: '43', ...extra }
  if (completion === 'finished') Object.assign(base, { time_result: '11:20', completion_state: 'completed' })
  else if (completion === 'capped') Object.assign(base, { time_result: null, result: '2 runde + 12', completion_state: 'capped' })
  else if (completion === 'incomplete') Object.assign(base, { time_result: null, result: '2 runde complete', completion_state: 'capped' })
  else if (completion === 'partial') Object.assign(base, { time_result: null, result: '7 + 12' }) // AMRAP partial round
  if (modified) base.performed_prescription = MOD_PERF
  return { log: base, prescribedWeight, logged: PROG, prescribed: PROG }
}

const classify = (x) => resultCompositionModified(x.log, x.prescribedWeight, x.logged, x.prescribed)

// ─────────────────────────────── §35 truth table ────────────────────────────

const VARIANTS = ['RX', 'Intermediate', 'Beginner', 'OnRamp', 'CUSTOM_TEST']
const COMPLETIONS = ['finished', 'capped', 'incomplete']

describe('P9.5.6 §35 — full VARIANT × MODIFIED × COMPLETION truth table', () => {
  for (const variant of VARIANTS) {
    for (const completion of COMPLETIONS) {
      it(`${variant} · UNMODIFIED · ${completion} -> ${variant} / As Prescribed / ${completion}`, () => {
        const x = log({ variant, completion, modified: false })
        expect(x.log.variant_level).toBe(variant)            // AXIS A preserved
        expect(classify(x)).toBe(false)                       // AXIS B = As Prescribed
        expect(isMixedCategory(x.log.weight_logged, x.prescribedWeight, x.logged, x.prescribed, x.log.performed_prescription)).toBe(false)
      })
      it(`${variant} · MODIFIED · ${completion} -> ${variant} / Modified / ${completion}`, () => {
        const x = log({ variant, completion, modified: true })
        expect(x.log.variant_level).toBe(variant)            // AXIS A preserved
        expect(classify(x)).toBe(true)                        // AXIS B = Modified
        expect(isMixedCategory(x.log.weight_logged, x.prescribedWeight, x.logged, x.prescribed, x.log.performed_prescription)).toBe(true)
      })
    }
  }
})

// ─────────────────────────── §70 / §71 properties ───────────────────────────

describe('P9.5.6 §70 — COMPLETION-INDEPENDENCE: changing only completion never changes Axis B', () => {
  for (const variant of VARIANTS) {
    for (const modified of [false, true]) {
      it(`${variant} / modified=${modified}: identical across finished | capped | incomplete | partial | zero`, () => {
        const verdicts = ['finished', 'capped', 'incomplete', 'partial'].map((c) => classify(log({ variant, completion: c, modified })))
        // also: a zero / DNF result
        verdicts.push(classify(log({ variant, completion: 'incomplete', modified, extra: { result: '0 runde complete', time_result: null } })))
        expect(new Set(verdicts).size).toBe(1)
        expect(verdicts[0]).toBe(modified)
      })
    }
  }
  it('score magnitude (fast/slow time, high/low reps, rounds count) never changes Axis B', () => {
    const mk = (over) => resultCompositionModified({ weight_logged: '43', ...over }, '43', PROG, PROG)
    expect(mk({ time_result: '4:00' })).toBe(false)
    expect(mk({ time_result: '59:00' })).toBe(false)
    expect(mk({ result: '999' })).toBe(false)
    expect(mk({ result: '1' })).toBe(false)
    expect(mk({ result: '0' })).toBe(false)
    expect(mk({ result: '2 runde + 43', completion_state: 'capped', time_result: null })).toBe(false)
  })
})

describe('P9.5.6 §71 — VARIANT-INDEPENDENCE: the algorithm never reads the variant name', () => {
  it('identical structure -> identical verdict for RX / Intermediate / Beginner / OnRamp / custom', () => {
    for (const modified of [false, true]) {
      const verdicts = VARIANTS.map((v) => classify(log({ variant: v, completion: 'capped', modified })))
      expect(new Set(verdicts).size).toBe(1)
      expect(verdicts[0]).toBe(modified)
    }
  })
  it('resultCompositionModified takes NO variant argument', () => {
    expect(resultCompositionModified.length).toBe(4) // (log, prescribedWeight, loggedMovements, prescribedMovements)
  })
})

// ─────────────────────── §13/§14/§15 relative to SELECTED variant ─────────────

describe('P9.5.6 §13/§14 — modification is relative to the SELECTED variant, not RX', () => {
  it('Intermediate selected, performs the Intermediate load (6 kg) -> As Prescribed (NOT compared to RX 9 kg)', () => {
    // the caller passes the SELECTED variant standard (6), not RX (9)
    expect(resultCompositionModified({ variant_level: 'Intermediate', weight_logged: '6' }, '6', ['Wall Ball'], ['Wall Ball'])).toBe(false)
  })
  it('Intermediate selected, performs BELOW the Intermediate load (4 kg vs 6 kg) -> Modified', () => {
    expect(resultCompositionModified({ variant_level: 'Intermediate', weight_logged: '4' }, '6', ['Wall Ball'], ['Wall Ball'])).toBe(true)
  })
  it('§15 Beginner selected, substitutes a movement -> Modified (via performed overlay)', () => {
    expect(resultCompositionModified({ variant_level: 'Beginner', weight_logged: '', performed_prescription: MOD_PERF }, null, SUB, PROG)).toBe(true)
  })
})

// ─────────────────────────── §56-63 cross-format ────────────────────────────

describe('P9.5.6 §56-63 — every score family: Axis B tracks ONLY prescription, never the score', () => {
  const FAMILIES = [
    // [label, formatId, config, an UNMODIFIED result, a MODIFIED result]
    ['§56 FOR TIME finished', 'For Time', {}, { weight_logged: '43', time_result: '9:04' }, { weight_logged: '30', time_result: '9:04' }],
    ['§56 FOR TIME capped',   'For Time', {}, { weight_logged: '43', time_result: null, completion_state: 'capped', result: '2 runde + 5' }, { weight_logged: '43', time_result: null, completion_state: 'capped', result: '2 runde + 5', performed_prescription: MOD_PERF }],
    ['§57 RFT all rounds',    'RFT', { rounds: 3 }, { weight_logged: '43', time_result: '17:00' }, { weight_logged: '43', time_result: '17:00', performed_prescription: MOD_PERF }],
    ['§57 RFT partial',       'RFT', { rounds: 3 }, { weight_logged: '43', time_result: null, result: '2 runde complete', completion_state: 'capped' }, { weight_logged: '43', time_result: null, result: '2 runde complete', completion_state: 'capped', performed_prescription: MOD_PERF }],
    ['§58 AMRAP partial',     'AMRAP', { durationSec: 600 }, { weight_logged: '43', result: '4 + 7' }, { weight_logged: '30', result: '4 + 7' }],
    ['§59 REPS low/high',     'AMRAP', {}, { weight_logged: '', result: '12' }, { weight_logged: '', result: '12', performed_prescription: MOD_PERF }],
    ['§60 LOAD achieved',     'Weightlifting', {}, { weight_logged: '', result: '80' }, { weight_logged: '', result: '80', performed_prescription: MOD_PERF }],
    ['§61 DISTANCE achieved', 'AMRAP', {}, { weight_logged: '', result: '5200 m' }, { weight_logged: '', result: '5200 m', performed_prescription: MOD_PERF }],
    ['§62 CALORIES achieved', 'AMRAP', {}, { weight_logged: '', result: '88' }, { weight_logged: '', result: '88', performed_prescription: MOD_PERF }],
    ['§63 INTERVALS low reps','Intervals', { rounds: 15, workSec: 40, restSec: 20 }, { weight_logged: '', sets: { 'Rundă 1': [{ reps: '1' }] } }, { weight_logged: '', sets: { 'Rundă 1': [{ reps: '1' }] }, performed_prescription: MOD_PERF }],
  ]
  for (const [label, , , unmodified, modified] of FAMILIES) {
    it(`${label}: unmodified -> As Prescribed`, () => {
      expect(resultCompositionModified({ variant_level: 'RX', ...unmodified }, unmodified.weight_logged ? '43' : null, ['Move'], ['Move'])).toBe(false)
    })
    it(`${label}: modified -> Modified`, () => {
      expect(resultCompositionModified({ variant_level: 'RX', ...modified }, modified.weight_logged ? '43' : null, ['Move'], ['Move'])).toBe(true)
    })
  }
  it('§31 LOAD: the achieved-load SCORE is never compared to a movement load (no prescribedWeight passed)', () => {
    for (const score of ['40', '80', '200']) {
      expect(resultCompositionModified({ variant_level: 'RX', weight_logged: '', result: score }, null, ['Back Squat'], ['Back Squat'])).toBe(false)
    }
  })
  it('§34 INTERVALS: zero reps in one work interval is not a modification', () => {
    expect(resultCompositionModified({ variant_level: 'RX', weight_logged: '', sets: { 'Rundă 1': [{ reps: '0' }], 'Rundă 2': [{ reps: '5' }] } }, null, ['HSPU'], ['HSPU'])).toBe(false)
  })
})

// ─────────────────────── §64-69 named owner regression fixtures ──────────────

describe('P9.5.6 §64-69 — owner regression fixtures', () => {
  it('§64 Adrian: 3 RFT, RX, followed RX, 2/3 rounds -> RX / As Prescribed / incomplete, NO badge', () => {
    // production row wod_logs.9dffb7ce
    const adrian = { variant_level: 'RX', weight_logged: '9', time_result: null, result: '2 runde complete', completion_state: 'capped' }
    expect(adrian.variant_level).toBe('RX')
    expect(resultCompositionModified(adrian, '9', ['15 Wallballs', '15 Sumo deadlift high-pull', '15 Box jumps', '15 Push Press'], ['15 Wallballs', '15 Sumo deadlift high-pull', '15 Box jumps', '15 Push Press'])).toBe(false)
  })
  it('§65 Intermediate, exact Intermediate prescription, 2/3 rounds -> Intermediate / As Prescribed / incomplete', () => {
    const x = { variant_level: 'Intermediate', weight_logged: '', time_result: null, result: '2 runde complete', completion_state: 'capped' }
    expect(resultCompositionModified(x, null, ['Wall Ball'], ['Wall Ball'])).toBe(false)
  })
  it('§66 Beginner, unchanged, partial -> Beginner / As Prescribed / incomplete', () => {
    expect(resultCompositionModified({ variant_level: 'Beginner', weight_logged: '', result: '3 + 5' }, null, ['Ring Row'], ['Ring Row'])).toBe(false)
  })
  it('§67 OnRamp, unchanged, partial -> OnRamp / As Prescribed / incomplete', () => {
    expect(resultCompositionModified({ variant_level: 'OnRamp', weight_logged: '', result: '1 runde complete', completion_state: 'capped' }, null, ['Air Squat'], ['Air Squat'])).toBe(false)
  })
  it('§68 Intermediate, MATERIALLY modified Intermediate prescription, 2/3 -> Intermediate / Modified / incomplete (no overcorrection)', () => {
    const x = { variant_level: 'Intermediate', weight_logged: '', time_result: null, result: '2 runde complete', completion_state: 'capped', performed_prescription: MOD_PERF }
    expect(resultCompositionModified(x, null, ['Wall Ball'], ['Wall Ball'])).toBe(true)
  })
  it('§69 CUSTOM_TEST variant: unchanged+incomplete -> As Prescribed ; modified+incomplete -> Modified', () => {
    const un = { variant_level: 'CUSTOM_TEST', weight_logged: '43', time_result: null, result: '2 runde complete', completion_state: 'capped' }
    const mo = { ...un, performed_prescription: MOD_PERF }
    expect(resultCompositionModified(un, '43', PROG, PROG)).toBe(false)
    expect(resultCompositionModified(mo, '43', PROG, PROG)).toBe(true)
  })
})

// ──────────────────────── source wiring / no special-case ───────────────────

describe('P9.5.6 — wiring: ONE rule for badge + bucket, no completion signal, no variant switch', () => {
  const wf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'workoutFormats.js'), 'utf8')
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')

  it('the former isNotRxd helper (composition OR did-not-finish) is gone', () => {
    expect(wf).not.toMatch(/export function isNotRxd/)
    expect(wf).not.toMatch(/const neterminatInTimp/)
  })
  it('resultCompositionModified is only composition signals — no completion term (INC-12: sequential departure is composition)', () => {
    const body = wf.slice(wf.indexOf('export function resultCompositionModified'))
    const fn = body.slice(0, body.indexOf('\n}') + 2)
    expect(fn).toMatch(/greutateEsteSubStandard/)
    expect(fn).toMatch(/movementsChanged/)
    expect(fn).toMatch(/performed_prescription != null/)
    expect(fn).toMatch(/sequentialProgressionDeparted/) // INC-12 4th term
    // still no completion axis: elapsed time, capped/DNF, or rounds-completed
    expect(fn).not.toMatch(/time_result|completion_state|effectiveScoreMode|neterminat|rounds/)
  })
  it('all 3 result-badge call sites use resultCompositionModified (same rule as isMixedCategory)', () => {
    // INC-12 appends the frozen formatId/formatConfig for the sequential term; the
    // leading args (the shared bucket/badge signal) are unchanged.
    expect(app).toMatch(/const resultModifiedLog = log\._supportsRx\s*\n\s*\? resultCompositionModified\(log, log\._prescribedWeight, log\._loggedMovements, log\._prescribedMovements[,)]/) // leaderboard
    expect(app).toMatch(/const resultModifiedLog = resultCompositionModified\(w, prescribedWeightLog, miscariAfisate, prescribedMovementsLog[,)]/) // Jurnal
    expect(app).toMatch(/resultModified: resultCompositionModified\(\{ \.\.\.logFields, performed_prescription: performedToSave \}/) // share
  })
  it('the badge label is variant-aware (RX -> "Not RX\'d", else -> "Modified"), data-driven', () => {
    expect(app).toMatch(/const isRxVariant = String\(variant \?\? 'rx'\)\.toLowerCase\(\)\.replace\(\/\[_\\s-\]\/g, ''\) === 'rx'/)
    expect(app).toMatch(/isRxVariant \? t\.notRxdBadge : t\.modifiedBadge/)
    expect(app).not.toMatch(/variant === ['"]RX['"] \|\| variant === ['"]Intermediate['"]/) // no exhaustive switch
  })
  it('no athlete / workout / date / RX-only special case in the classification path', () => {
    const region = wf + '\n' + app.slice(app.indexOf('function NotRxdBadge'), app.indexOf('function NotRxdBadge') + 900)
    expect(region).not.toMatch(/Adrian|Ionascu|9dffb7ce|=== ['"]2026-/)
  })
  it('the leaderboard bucket + badge draw from the same rule (isMixedCategory === resultCompositionModified wrapper)', () => {
    // isMixedCategory is a thin wrapper over resultCompositionModified — proven behaviourally above;
    // here: still exactly ONE isMixedCategory call site.
    expect((app.match(/\bisMixedCategory\(/g) || []).length).toBe(1)
  })
})

// ─────────────────────────── score-family sanity (no regression) ─────────────

describe('P9.5.6 §55 — score interpretation / ranking inputs untouched', () => {
  it('effectiveScoreMode still resolves the same families (used by scoring, not classification)', () => {
    expect(effectiveScoreMode('RFT', { rounds: 3 })).toBe('fortime_or_amrap')
    expect(effectiveScoreMode('AMRAP', {})).toBe('amrap')
    expect(effectiveScoreMode('For Time', {})).toBe('fortime_or_amrap')
  })
})
