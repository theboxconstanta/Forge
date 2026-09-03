import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveResultProvenance } from './resultProvenance.js'
import { snapshotLoadStandard, MULTI_LOAD_STANDARD } from './prescriptionContract.js'
import { resultCompositionModified, isMixedCategory } from './workoutFormats.js'

// P10 — HISTORICAL RESULT TRUTH / SNAPSHOT-FIRST READ MODEL
//
// A historical athlete result must represent the truth that existed when it was
// saved. A coach editing a workout AFTER an athlete logs it must not change that
// past result's RX/Mixed bucket, Not-RX'd status, score interpretation,
// capped-vs-finished interpretation, leaderboard ranking, Journal interpretation
// or reopen context — wherever result-owned frozen provenance exists.
//
// resolveResultProvenance(log) is the one shared pure resolver. It reads ONLY
// the log's own persisted columns (format_snapshot / format_config_snapshot /
// movements_snapshot / prescription_snapshot / notes header / profile gender),
// never the live `wods` row except as the last-resort fallback for a
// pre-Scoring-Phase-0 legacy log that froze no snapshot at all.

// A structured P9.1 prescription_snapshot (flat shape).
const snap = (gender, loads) => ({
  version: 1, variant: 'rx', gender, source: 'structured', resolvedAt: '2026-07-01T00:00:00Z',
  movements: loads.map((l, i) => ({
    instanceId: `mi_${i}${'x'.repeat(20)}`,
    name: `Move ${i}`,
    canonicalMovementId: null,
    displayLine: `Move ${i}`,
    reps: { value: 10 },
    load: l,
  })),
})

// A leaderboard/journal log as fetched: frozen snapshot columns + a *current*
// `wods` join that a coach may have since edited.
const makeLog = (over = {}) => ({
  id: 'log_1',
  member_id: 'm_1',
  variant_level: 'rx',
  weight_logged: null,
  time_result: null,
  result: null,
  logged_at: '2026-07-10T10:00:00Z',
  notes: 'AMRAP 20:00\n20 Wall Ball\n15 Pull-up\n---\nfelt good',
  wod_id: 'wod_D',
  format_snapshot: null,
  format_config_snapshot: null,
  movements_snapshot: null,
  prescription_snapshot: null,
  performed_prescription: null,
  profile: { gender: 'masculin' },
  wods: null,
  ...over,
})

describe('P10 · snapshotLoadStandard (frozen-load reader)', () => {
  it('reads a single resolved numeric load', () => {
    expect(snapshotLoadStandard(snap('male', [{ value: 43, unit: 'kg' }]))).toBe(43)
  })
  it('falls back to bothValues by frozen gender', () => {
    const s = snap('female', [{ bothValues: [43, 30], unit: 'kg' }])
    expect(snapshotLoadStandard(s)).toBe(30)
  })
  it('returns MULTI when loads disagree', () => {
    const s = snap('male', [{ value: 43, unit: 'kg' }, { value: 61, unit: 'kg' }])
    expect(snapshotLoadStandard(s)).toBe(MULTI_LOAD_STANDARD)
  })
  it('returns null when no movement carries a load', () => {
    expect(snapshotLoadStandard(snap('male', [{}, {}]))).toBe(null)
    expect(snapshotLoadStandard(null)).toBe(null)
    expect(snapshotLoadStandard({})).toBe(null)
  })
  it('never reads a live wods row (no such argument exists)', () => {
    expect(snapshotLoadStandard.length).toBe(1)
  })
})

describe('P10 · §12 anti-regression — mutating the current WOD never changes resolved provenance', () => {
  it('rx weight / movements / format / format_config edits leave resolveResultProvenance byte-identical', () => {
    const frozen = {
      format_snapshot: 'AMRAP',
      format_config_snapshot: { rounds: 3 },
      movements_snapshot: ['20 Wall Ball', '15 Pull-up'],
      prescription_snapshot: snap('male', [{ value: 35, unit: 'kg' }]),
    }
    const before = makeLog({
      ...frozen,
      wods: { type: 'AMRAP', format_config: { rounds: 3 }, movements_rx: ['20 Wall Ball', '15 Pull-up'], rx_weight_male: '35', rx_weight_female: '25' },
    })
    const after = makeLog({
      ...frozen,
      // coach edits EVERYTHING on today's workout
      wods: { type: 'For Time', format_config: { rounds: 10 }, movements_rx: ['30 Thruster', '30 Ring Muscle-up'], rx_weight_male: '61', rx_weight_female: '43' },
    })
    expect(resolveResultProvenance(after)).toEqual(resolveResultProvenance(before))
    expect(resolveResultProvenance(after)).toEqual({
      formatId: 'AMRAP',
      formatConfig: { rounds: 3 },
      prescribedMovements: ['20 Wall Ball', '15 Pull-up'],
      prescribedWeight: '35',
      gender: 'male',
      source: 'snapshot',
    })
  })
})

describe('P10 · A — coach raises the RX load 35 → 45 after the athlete logged RX@35', () => {
  const base = makeLog({
    weight_logged: '35',
    prescription_snapshot: snap('male', [{ value: 35, unit: 'kg' }]),
    format_snapshot: 'AMRAP', format_config_snapshot: {},
    movements_snapshot: ['20 Wall Ball', '15 Pull-up'],
  })
  it('the frozen prescribed load stays 35', () => {
    const heavier = { ...base, wods: { type: 'AMRAP', rx_weight_male: '45' } }
    expect(resolveResultProvenance(heavier).prescribedWeight).toBe('35')
  })
  it('classification / badge / bucket are unchanged (still RX, not modified)', () => {
    const prov = resolveResultProvenance({ ...base, wods: { rx_weight_male: '45' } })
    const logged = ['20 Wall Ball', '15 Pull-up']
    expect(resultCompositionModified(base, prov.prescribedWeight, logged, prov.prescribedMovements)).toBe(false)
    expect(isMixedCategory(base.weight_logged, prov.prescribedWeight, logged, prov.prescribedMovements, base.performed_prescription)).toBe(false)
  })
})

describe('P10 · B — coach swaps a movement after the athlete logged the original', () => {
  const base = makeLog({
    variant_level: 'rx',
    movements_snapshot: ['20 Wall Ball', '15 Pull-up'],
    format_snapshot: 'AMRAP', format_config_snapshot: {},
    notes: 'AMRAP 20:00\n20 Wall Ball\n15 Pull-up\n---\n',
  })
  it('prescribedMovements stays the frozen list even when wods.movements_rx changes', () => {
    const edited = { ...base, wods: { type: 'AMRAP', movements_rx: ['20 Wall Ball', '15 Ring Muscle-up'] } }
    expect(resolveResultProvenance(edited).prescribedMovements).toEqual(['20 Wall Ball', '15 Pull-up'])
  })
  it('a result that matched the ORIGINAL movements is still not modified', () => {
    const prov = resolveResultProvenance({ ...base, wods: { movements_rx: ['20 Wall Ball', '15 Ring Muscle-up'] } })
    const logged = ['20 Wall Ball', '15 Pull-up']
    expect(resultCompositionModified(base, prov.prescribedWeight, logged, prov.prescribedMovements)).toBe(false)
  })
})

describe('P10 · C — coach changes the format after the athlete logged', () => {
  const base = makeLog({
    format_snapshot: 'AMRAP', format_config_snapshot: {},
    result: '5 rounds',
    time_result: null,
    notes: 'AMRAP 20:00\n20 Wall Ball\n15 Pull-up\n---\n',
  })
  it('frozen format wins for score INTERPRETATION (P9.5.6: completion never affects the badge anyway)', () => {
    const flipped = { ...base, wods: { type: 'For Time' } }
    const prov = resolveResultProvenance(flipped)
    expect(prov.formatId).toBe('AMRAP')
    // P9.5.6 - the badge is composition-only; no time_result is COMPLETION, never modification.
    expect(resultCompositionModified(base, prov.prescribedWeight, ['20 Wall Ball', '15 Pull-up'], prov.prescribedMovements)).toBe(false)
  })
})

describe('P10 · D — coach changes the athlete profile gender after the log', () => {
  // female RX standard 30, male 43. Athlete logged 30 as a woman → RX.
  const base = makeLog({
    weight_logged: '30',
    prescription_snapshot: snap('female', [{ bothValues: [43, 30], unit: 'kg' }]),
    profile: { gender: 'feminin' },
  })
  it('frozen gender keeps the prescribed standard at 30 even if profile flips to male', () => {
    const flipped = { ...base, profile: { gender: 'masculin' } }
    expect(resolveResultProvenance(flipped).prescribedWeight).toBe('30')
    expect(resolveResultProvenance(flipped).gender).toBe('female')
  })
  it('classification stays RX (30 is not below the frozen 30 standard)', () => {
    const prov = resolveResultProvenance({ ...base, profile: { gender: 'masculin' } })
    expect(resultCompositionModified(base, prov.prescribedWeight, [], prov.prescribedMovements)).toBe(false)
  })
})

describe('P10 · E — a performed_prescription result stays Mixed / Not-RX (P9.5.4 unchanged)', () => {
  const performed = { version: 1, variantKey: 'rx', source: 'performed', movements: [{ instanceId: 'mi_0'.padEnd(24, 'x'), name: 'Thruster', load: { mode: 'universal', value: 25, unit: 'kg' } }] }
  const base = makeLog({
    weight_logged: '25',
    performed_prescription: performed,
    prescription_snapshot: snap('male', [{ value: 43, unit: 'kg' }]),
    format_snapshot: 'AMRAP', format_config_snapshot: {},
  })
  it('performed != null forces modified regardless of the resolver', () => {
    const prov = resolveResultProvenance(base)
    expect(resultCompositionModified(base, prov.prescribedWeight, [], prov.prescribedMovements)).toBe(true)
    expect(isMixedCategory(base.weight_logged, prov.prescribedWeight, [], prov.prescribedMovements, base.performed_prescription)).toBe(true)
  })
})

describe('P10 · G — legacy log with NO frozen prescribed load (Option A)', () => {
  const base = makeLog({
    variant_level: 'rx',
    weight_logged: '20',
    prescription_snapshot: null,
    format_snapshot: null, format_config_snapshot: null,
    movements_snapshot: null,
    wods: { type: 'For Time', rx_weight_male: '60', rx_weight_female: '43', movements_rx: ['20 Wall Ball', '15 Pull-up'] },
  })
  it('prescribedWeight is null — the weight-below-standard term is skipped', () => {
    expect(resolveResultProvenance(base).prescribedWeight).toBe(null)
    expect(resolveResultProvenance(base).source).toBe('legacy-none')
  })
  it('changing today\'s wods RX weight does NOT retro-classify the result as modified', () => {
    const before = resolveResultProvenance(base)
    const after = resolveResultProvenance({ ...base, wods: { ...base.wods, rx_weight_male: '100' } })
    expect(after.prescribedWeight).toBe(before.prescribedWeight) // null → null
    expect(resultCompositionModified(base, after.prescribedWeight, ['x'], after.prescribedMovements)).toBe(false)
  })
  it('does NOT overcorrect — a legacy result is not force-classified RX; other signals still apply', () => {
    // same legacy log but the athlete DID substitute a movement, recorded via
    // a frozen performed overlay → still modified.
    const withPerf = { ...base, performed_prescription: { version: 1, variantKey: 'rx', source: 'performed', movements: [{ instanceId: 'mi_0'.padEnd(24, 'x'), name: 'Row', substitutedFrom: 'Run' }] } }
    const prov = resolveResultProvenance(withPerf)
    expect(resultCompositionModified(withPerf, prov.prescribedWeight, [], prov.prescribedMovements)).toBe(true)
  })
})

describe('P10 · H — legacy-format-only log with frozen movements but no prescription_snapshot', () => {
  const base = makeLog({
    variant_level: 'rx',
    prescription_snapshot: null,
    format_snapshot: 'AMRAP', format_config_snapshot: { rounds: 3 },
    movements_snapshot: ['20 Wall Ball', '15 Pull-up'],
    wods: { type: 'For Time', movements_rx: ['20 Wall Ball', '15 Ring Dip'], rx_weight_male: '61' },
  })
  it('source is legacy-format-only and movements come from the frozen list', () => {
    const prov = resolveResultProvenance(base)
    expect(prov.source).toBe('legacy-format-only')
    expect(prov.formatId).toBe('AMRAP')
    expect(prov.prescribedMovements).toEqual(['20 Wall Ball', '15 Pull-up'])
    expect(prov.prescribedWeight).toBe(null)
  })
  it('a genuine movement change is still detected against the frozen list, not today\'s wods', () => {
    const prov = resolveResultProvenance(base)
    expect(resultCompositionModified(base, prov.prescribedWeight, ['20 Wall Ball', '15 Toes-to-bar'], prov.prescribedMovements)).toBe(true)
    expect(resultCompositionModified(base, prov.prescribedWeight, ['20 Wall Ball', '15 Pull-up'], prov.prescribedMovements)).toBe(false)
  })
})

describe('P10 · I — no score-family regression across formats', () => {
  const families = [
    ['AMRAP', {}, { result: '5 rounds' }],
    ['RFT', { rounds: 3 }, { time_result: '12:30' }],
    ['For Time', {}, { time_result: '9:04' }],
    ['EMOM', {}, { result: 'done' }],
  ]
  for (const [fmt, cfg, res] of families) {
    it(`${fmt}: an exactly-RX result reads as RX under frozen provenance`, () => {
      const log = makeLog({
        variant_level: 'rx',
        weight_logged: '43',
        prescription_snapshot: snap('male', [{ value: 43, unit: 'kg' }]),
        format_snapshot: fmt, format_config_snapshot: cfg,
        movements_snapshot: ['20 Wall Ball'],
        wods: { type: 'Chipper', rx_weight_male: '80', movements_rx: ['999 Burpee'] },
        ...res,
      })
      const prov = resolveResultProvenance(log)
      expect(prov.formatId).toBe(fmt)
      expect(resultCompositionModified(log, prov.prescribedWeight, ['20 Wall Ball'], prov.prescribedMovements)).toBe(false)
    })
  }
  it('P9.5.6 - RFT with no time_result, composition exactly RX -> NOT modified (completion is a separate axis)', () => {
    const log = makeLog({
      variant_level: 'rx', weight_logged: '43',
      prescription_snapshot: snap('male', [{ value: 43, unit: 'kg' }]),
      format_snapshot: 'RFT', format_config_snapshot: { rounds: 3 },
      movements_snapshot: ['20 Wall Ball'], time_result: null,
    })
    const prov = resolveResultProvenance(log)
    expect(resultCompositionModified(log, prov.prescribedWeight, ['20 Wall Ball'], prov.prescribedMovements)).toBe(false)
  })
})

describe('P10 · J — the resolver has no D+n / date / wod_id logic', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'resultProvenance.js'), 'utf8')
  it('resolveResultProvenance never reads wod_id, workout_id, date or logged_at', () => {
    expect(app).not.toMatch(/wod_id|workout_id|\blogged_at\b|\.date\b/)
  })
  it('the returned shape carries only prescribed-side provenance', () => {
    expect(Object.keys(resolveResultProvenance(makeLog())).sort())
      .toEqual(['formatConfig', 'formatId', 'gender', 'prescribedMovements', 'prescribedWeight', 'source'])
  })
})

describe('P10 · call-site wiring in App.jsx', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')

  it('imports the shared resolver from its own module', () => {
    expect(app).toMatch(/import \{ resolveResultProvenance \} from '\.\/resultProvenance'/)
  })
  it('the leaderboard split classifies against per-log frozen provenance, not wodZiData', () => {
    expect(app).toMatch(/const prov = resolveResultProvenance\(log\)\s*\n\s*const prescribedWeight = prov\.prescribedWeight/)
    // wodZiData is no longer the classification source in splitRxSiMixed
    expect(app).not.toMatch(/const prescribedWeightFor = \(nivelId, log\) => wodZiData/)
  })
  it('leaderboard cards resolve format identity from the log, not the render group, for the primary part', () => {
    expect(app).toMatch(/const logProv = log\._prov \|\| null/)
    // INC-12 appends the frozen formatId/formatConfig (log._prov) for the
    // sequential-progression term; the frozen-prescription args are unchanged.
    expect(app).toMatch(/resultCompositionModified\(log, log\._prescribedWeight, log\._loggedMovements, log\._prescribedMovements[,)]/)
  })
  it('the Journal card classifies against resolveResultProvenance(w)', () => {
    expect(app).toMatch(/const wProv = resolveResultProvenance\(w\)/)
    expect(app).toMatch(/formatConfigResolvat = esteSectiuneLegata \? w\.format_config_snapshot : wProv\.formatConfig/)
  })
  it('onEditWod reopens with the frozen prescribed context (editProv), for any log', () => {
    expect(app).toMatch(/const editProv = resolveResultProvenance\(log\)/)
    expect(app).toMatch(/setEditLogPrescribedWeight\(editProv\.prescribedWeight \|\| ''\)/)
    // the old workout_section_id-gated snapshot read is gone
    expect(app).not.toMatch(/log\.workout_section_id \? log\.format_snapshot : null/)
  })
  it('wodZiData is still used for the leaderboard header', () => {
    expect(app).toMatch(/wodZiData\.type\} \{formatWodDurata\(wodZiData\.duration\)\}/)
  })
})
