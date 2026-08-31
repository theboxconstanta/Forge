import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isMixedCategory, resultCompositionModified } from './workoutFormats.js'

// P9.5.4 / P9.5.6 — GLOBAL LEADERBOARD RESULT CLASSIFICATION
//
// P9.5.4 owner finding: a modified result showed the badge but stayed in the RX
// bucket. Fix: centralise the COMPOSITION rule in resultCompositionModified().
// P9.5.6 owner finding: an RX athlete who followed RX but did NOT finish (2/3
// rounds) showed "Not RX'd". Fix: the badge is now EXACTLY
// resultCompositionModified — the former isNotRxd helper's "did not finish in
// the time cap" term (a COMPLETION signal) was removed. Badge === bucket for
// every case; completion never sets either.
//
// `perf` = a non-null performed_prescription overlay (P9.5.2 only ever persists
// it when the athlete's performed version MATERIALLY differs from programmed).
const PERF = { version: 1, variantKey: 'rx', movements: [{ instanceId: 'mi_x', name: 'Power Clean', load: { mode: 'universal', value: 50, unit: 'kg' } }] }

// A row: [label, log, prescribedWeight, formatId, config, loggedMovements, prescribedMovements, expectMixed]
// `expectMixed` = the leaderboard BUCKET verdict (true => Mixed Categories, false => pure RX/Intermediate/… bucket).
const M = ['21 Thrusters', '15 Pull-ups']            // programmed movement list
const M_SUB = ['21 Thrusters', '15 Ring Rows']       // one movement substituted

const MATRIX = [
  // --- A/B  TIME (For Time, no cap) ---
  ['A  TIME true RX',            { weight_logged: '61kg', time_result: '9:41' },                        '61kg', 'For Time', {}, M, M, false],
  ['B  TIME modified load',      { weight_logged: '40kg', time_result: '9:41' },                        '61kg', 'For Time', {}, M, M, true],
  ['B2 TIME substitution',       { weight_logged: '61kg', time_result: '9:41' },                        '61kg', 'For Time', {}, M_SUB, M, true],
  ['B3 TIME performed overlay',  { weight_logged: '61kg', time_result: '9:41', performed_prescription: PERF }, '61kg', 'For Time', {}, M, M, true],

  // --- C-F  TIME_CAPPED (RFT + cap) ---
  ['C  CAPPED completed RX',     { weight_logged: '61kg', time_result: '17:42', completion_state: 'completed' }, '61kg', 'RFT', { rounds: 3, timeCapSec: 1200 }, M, M, false],
  ['D  CAPPED completed mod',    { weight_logged: '50kg', time_result: '17:42', completion_state: 'completed' }, '61kg', 'RFT', { rounds: 3, timeCapSec: 1200 }, M, M, true],
  ['E  CAPPED capped RX',        { weight_logged: '61kg', time_result: null, result: '2 runde + 43', completion_state: 'capped' }, '61kg', 'RFT', { rounds: 3, timeCapSec: 1200 }, M, M, false],
  ['F  CAPPED capped modified',  { weight_logged: '61kg', time_result: null, result: '2 runde + 43', completion_state: 'capped', performed_prescription: PERF }, '61kg', 'RFT', { rounds: 3, timeCapSec: 1200 }, M, M, true],

  // --- G/H  AMRAP (ROUNDS_REPS) ---
  ['G  AMRAP true RX',           { weight_logged: '43kg', result: '7 + 12' },                           '43kg', 'AMRAP', { durationSec: 720 }, M, M, false],
  ['H  AMRAP modified',          { weight_logged: '30kg', result: '7 + 12' },                           '43kg', 'AMRAP', { durationSec: 720 }, M, M, true],
  ['H2 AMRAP performed overlay', { weight_logged: '43kg', result: '7 + 12', performed_prescription: PERF }, '43kg', 'AMRAP', { durationSec: 720 }, M, M, true],

  // --- I/J  REPS (Max Reps) — score magnitude must NOT imply modified ---
  ['I  REPS true RX (big #)',    { weight_logged: '', result: '142' },                                  null, 'AMRAP', {}, M, M, false],
  ['J  REPS modified movements', { weight_logged: '', result: '142' },                                  null, 'AMRAP', {}, M_SUB, M, true],

  // --- K/L  LOAD (Max Load) — CRITICAL: 120 kg score does NOT mean Modified ---
  ['K  LOAD true RX (120 kg)',   { weight_logged: '', result: '120' },                                  null, 'Weightlifting', {}, ['Back Squat'], ['Back Squat'], false],
  ['L  LOAD modified prescription', { weight_logged: '', result: '120', performed_prescription: PERF }, null, 'Weightlifting', {}, ['Back Squat'], ['Back Squat'], true],

  // --- M/N  DISTANCE / CALORIES ---
  ['M  DISTANCE true RX',        { weight_logged: '', result: '5200 m' },                               null, 'AMRAP', {}, ['Row'], ['Row'], false],
  ['M2 DISTANCE modified',       { weight_logged: '', result: '5200 m', performed_prescription: PERF }, null, 'AMRAP', {}, ['Row'], ['Row'], true],
  ['N  CALORIES true RX',        { weight_logged: '', result: '88' },                                   null, 'AMRAP', {}, ['Echo Bike'], ['Echo Bike'], false],
  ['N2 CALORIES modified',       { weight_logged: '', result: '88' },                                   null, 'AMRAP', {}, ['Assault Bike'], ['Echo Bike'], true],

  // --- P  historical RX row that already carries the canonical signal ---
  ['P  historical RX + weight below', { weight_logged: '20kg', time_result: '12:00' },                  '43kg', 'For Time', {}, M, M, true],

  // --- Q  legacy: no prescribed data at all -> cannot be classified Modified ---
  ['Q  legacy no prescription', { weight_logged: '20kg', time_result: '12:00' },                        null, 'For Time', {}, M, null, false],
]

describe('P9.5.4 — global bucket classification matrix (all score families)', () => {
  for (const [label, log, pw, , , lm, pm, expectMixed] of MATRIX) {
    it(`${label} -> bucket ${expectMixed ? 'Mixed' : 'RX'}`, () => {
      const bucketMixed = isMixedCategory(log.weight_logged, pw, lm, pm, log.performed_prescription)
      expect(bucketMixed).toBe(expectMixed)
    })
  }
})

describe('P9.5.6 §40/§72 — badge and bucket are ONE rule (resultCompositionModified)', () => {
  for (const [label, log, pw, , , lm, pm, expectMixed] of MATRIX) {
    it(`${label}: badge === bucket === ${expectMixed ? 'Modified' : 'As Prescribed'}`, () => {
      const badge = resultCompositionModified(log, pw, lm, pm)
      const bucket = isMixedCategory(log.weight_logged, pw, lm, pm, log.performed_prescription)
      expect(badge).toBe(expectMixed)
      expect(bucket).toBe(expectMixed)
      expect(badge).toBe(bucket)
    })
  }
})

describe('P9.5.6 §3/§28 — completion is orthogonal to BOTH bucket and badge', () => {
  it('Adrian: 3 RFT, RX, followed RX, 2/3 rounds capped -> NOT modified, RX bucket, no badge', () => {
    const log = { weight_logged: '9', time_result: null, result: '2 runde complete', completion_state: 'capped' }
    expect(resultCompositionModified(log, '9', ['15 Wallballs'], ['15 Wallballs'])).toBe(false) // badge: NO
    expect(isMixedCategory(log.weight_logged, '9', ['15 Wallballs'], ['15 Wallballs'], null)).toBe(false) // bucket: RX
  })
  it('capped RFT, composition exactly RX -> badge NO, bucket RX (was badge YES pre-P9.5.6)', () => {
    const log = { weight_logged: '61kg', time_result: null, result: '2 runde + 43', completion_state: 'capped' }
    expect(resultCompositionModified(log, '61kg', M, M)).toBe(false)
    expect(isMixedCategory(log.weight_logged, '61kg', M, M, log.performed_prescription)).toBe(false)
  })
  it('For Time (no cap) unfinished, composition exactly RX -> badge NO', () => {
    expect(resultCompositionModified({ weight_logged: '61kg', time_result: null }, '61kg', M, M)).toBe(false)
  })
  it('Partner WOD (For Time base) unfinished, composition RX -> badge NO', () => {
    expect(resultCompositionModified({ weight_logged: '61kg', time_result: null }, '61kg', M, M)).toBe(false)
  })
  it('AMRAP partial round, composition RX -> badge NO', () => {
    expect(resultCompositionModified({ weight_logged: '43kg', result: '7 + 12', time_result: null }, '43kg', M, M)).toBe(false)
  })
})

describe('P9.5.4 §25 — score magnitude never determines RX', () => {
  it('LOAD 200 kg with no prescription modification -> RX (not Mixed)', () => {
    const log = { weight_logged: '', result: '200' }
    expect(isMixedCategory('', null, ['Back Squat'], ['Back Squat'], null)).toBe(false)
    expect(resultCompositionModified(log, null, ['Back Squat'], ['Back Squat'])).toBe(false)
  })
  it('REPS 999 with no prescription modification -> RX', () => {
    expect(isMixedCategory('', null, ['Burpee'], ['Burpee'], null)).toBe(false)
  })
})

describe('P9.5.4 §30 — no overcorrection: true RX stays RX', () => {
  it('performed_prescription null + everything matching -> RX (badge + bucket) across families', () => {
    for (const _fmt of ['For Time', 'RFT', 'AMRAP', 'Weightlifting']) {
      expect(isMixedCategory('61kg', '61kg', M, M, null)).toBe(false)
      expect(resultCompositionModified({ weight_logged: '61kg', time_result: '9:00', performed_prescription: null }, '61kg', M, M)).toBe(false)
    }
  })
})

describe('P9.5.4 §5/§33 — the single leaderboard bucket call site feeds the performed signal', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')

  it('there is exactly ONE isMixedCategory call site (the primary-section RX/Mixed split)', () => {
    const calls = app.match(/\bisMixedCategory\(/g) || []
    expect(calls.length).toBe(1)
  })

  it('that call passes log.performed_prescription so bucket + badge use the same signal', () => {
    const line = app.split('\n').find((l) => l.includes('isMixedCategory('))
    expect(line).toMatch(/isMixedCategory\(\s*log\.weight_logged\s*,\s*prescribedWeight\s*,\s*miscariAfisate\s*,\s*prescribedMovements\s*,\s*log\.performed_prescription\s*\)/)
  })

  it('the gender filter (getSectionLogsForTier) runs BEFORE splitRxSiMixed — dimensions stay orthogonal', () => {
    const iGender = app.indexOf('getSectionLogsForTier')
    const iSplit = app.indexOf('splitRxSiMixed')
    const iApplyGender = app.indexOf("l.profile?.gender === 'masculin'")
    expect(iGender).toBeGreaterThan(0)
    expect(iSplit).toBeGreaterThan(0)
    expect(iApplyGender).toBeGreaterThan(0)
    // gender filtering is inside getSectionLogsForTier, whose result is the
    // INPUT to splitRxSiMixed(nivelId, getSectionLogsForTier(nivelId))
    expect(app).toMatch(/splitRxSiMixed\(nivel\.id,\s*getSectionLogsForTier\(nivel\.id\)\)/)
  })
})
