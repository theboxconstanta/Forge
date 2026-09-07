// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Phase B
//
// Proves the Journal card wiring added to JurnalList (App.jsx) actually
// renders the canonical "Total Weight Lifted" secondary metric for a real
// SAVED Strength Sets log, reading from the log's OWN FROZEN
// prescription_snapshot.movements (never live prescription state) - see
// App.jsx's wVolumeEligible/wVolumeLoad (~line 6645) and its render block
// right after the wHasSets breakdown (~line 6798). Uses the real
// getT('en')/getT('ro') translation objects (not an ad-hoc stub `t`) so the
// full card (which reads many other t.* keys - jurnalResultLabel,
// jurnalEdit, jurnalNoDetails, etc.) renders exactly as it does in the app.
//
// JurnalList was exported (function -> export function, zero behavior
// change) specifically to make this test possible, mirroring the same
// established pattern used for MovementRowListPWA/EmomMinutePatternEditor.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { JurnalList } from './App.jsx'
import { getT } from './translations.js'

afterEach(cleanup)

const t = getT('en')

const row = (reps, weight) => ({ completed: false, distance: '', targetReps: null, reps, weight })

// Real-shaped RX instance (prescriptionMovements/prescription_snapshot.movements)
// - Snatch is load-capable (has a `.load` key), matching the production
// canonical-instance shape confirmed in strengthVolumeLoad.test.js.
const snatchInst = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }

const baseStrengthSetsLog = {
  id: 'wlog-1',
  logged_at: '2026-09-01T10:00:00Z',
  variant_level: 'rx',
  notes: '',
  sets: { Snatch: [row('5', '35'), row('5', '35'), row('3', '45')] },
  format_snapshot: 'Strength Sets',
  format_config_snapshot: { setsScheme: [5, 5, 3] },
  prescription_snapshot: { movements: [snatchInst] },
  workout_section_id: null,
  wods: null,
  wod_name_snapshot: null,
  movements_snapshot: null,
  performance_identity_id: null,
  wod_log_media: null,
}

const entriesFor = (w) => [{ key: w.id, wodLog: w, skillLogsArr: [] }]

describe('JurnalList - Total Weight Lifted (canonical volume load, Phase B)', () => {
  it('un log real de Strength Sets cu seturi reale afișează Total Weight Lifted (card expandat implicit)', () => {
    render(
      <JurnalList entries={entriesFor(baseStrengthSetsLog)} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    // 5*35 + 5*35 + 3*45 = 485
    expect(screen.getByText(/Total Weight Lifted: 485kg/)).toBeInTheDocument()
  })

  it('Build to Heavy/1RM rămâne exclus în Jurnal (RM-ul e rezultatul principal, nu volumul)', () => {
    const w = {
      ...baseStrengthSetsLog,
      id: 'wlog-2',
      sets: { Snatch: [row('3', '80')] },
      format_snapshot: 'Build to Heavy/1RM',
      format_config_snapshot: { targetLabel: '3RM' },
    }
    render(<JurnalList entries={entriesFor(w)} gender="male" weightUnit="kg" t={t} lang="en" />)
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('log legacy fără prescription_snapshot.movements -> nu ghicește capacitatea, nu afișează metrica', () => {
    const w = { ...baseStrengthSetsLog, id: 'wlog-3', prescription_snapshot: null }
    render(<JurnalList entries={entriesFor(w)} gender="male" weightUnit="kg" t={t} lang="en" />)
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('mișcare fără capacitate de încărcare (Air Squat) -> nu afișează metrica', () => {
    const airSquatInst = { instanceId: 'mi_as', name: 'Air Squat', canonicalMovementId: 'cm-as', reps: { mode: 'universal', value: null } }
    const w = {
      ...baseStrengthSetsLog,
      id: 'wlog-4',
      sets: { 'Air Squat': [row('10', '')] },
      prescription_snapshot: { movements: [airSquatInst] },
    }
    render(<JurnalList entries={entriesFor(w)} gender="male" weightUnit="kg" t={t} lang="en" />)
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('folosește unitatea CURENTĂ a membrului (weightUnit prop), fără conversie/reinterpretare', () => {
    render(
      <JurnalList entries={entriesFor(baseStrengthSetsLog)} gender="male" weightUnit="lbs" t={t} lang="en" />
    )
    expect(screen.getByText(/Total Weight Lifted: 485lbs/)).toBeInTheDocument()
  })

  it('respectă traducerea RO a etichetei', () => {
    const tRo = getT('ro')
    render(
      <JurnalList entries={entriesFor(baseStrengthSetsLog)} gender="male" weightUnit="kg" t={tRo} lang="ro" />
    )
    expect(screen.getByText(/Greutate totală ridicată: 485kg/)).toBeInTheDocument()
  })
})
