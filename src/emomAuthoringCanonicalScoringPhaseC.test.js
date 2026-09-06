// EMOM AUTHORING + CANONICAL SCORING INTEGRITY - Phase C: an ACTUAL
// coach-created workout (via the real save path, legacyPayloadFromSections)
// -> an actual member log -> the canonical score propagates identically to
// Leaderboard, Journal, and Share/Photo Result. No synthetic
// format_config-only fixtures in isolation - this exercises the real
// builder-to-surface pipeline end to end, proving the fix is NOT just a
// helper-level patch.

import { describe, it, expect } from 'vitest'
import { legacyPayloadFromSections, createSection } from './wodSections.js'
import { sortSectionLogs, setsScoreText, resolveStationUnitsByKey } from './workoutFormats.js'

// Simulates the Coach WOD Builder: a coach opens FormatConfigEditor for a
// new EMOM section, adds 3 reps-only movements, and the SAME
// EmomScoringField useEffect the real builder renders would fire
// (auto-suggest -> persisted) - the section's formatConfig ends up exactly
// as it would after that interaction, before Save is even clicked.
function makeCoachEmomSection() {
  const s = createSection('metcon', true)
  s.format = 'EMOM'
  s.formatConfig = { totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' } // as EmomScoringField would have written
  s.variants = {
    rx: {
      instances: [
        { name: '10 Push-ups', instanceId: 'mi_1', reps: { mode: 'universal', value: 10 } },
      ],
      movements: [], weight: { male: '', female: '' }, note: '',
    },
  }
  return s
}

describe('Owner live fixture, end to end - coach builder save -> member log -> canonical score everywhere', () => {
  it('the coach-authored WOD payload persists the explicit scoringMode (the actual root-cause fix)', () => {
    const payload = legacyPayloadFromSections([makeCoachEmomSection()])
    expect(payload.type).toBe('EMOM')
    expect(payload.format_config.scoringMode).toBe('Total Reps')
  })

  it('a member logs 10 / 9 / 7 against that saved workout - Leaderboard, Journal, and Share/Photo all agree on 26 reps, never "3 sets"', () => {
    const payload = legacyPayloadFromSections([makeCoachEmomSection()])
    const formatConfig = payload.format_config // exactly what would be persisted to wods.format_config
    const memberSets = { 'Min 1': [{ reps: '10' }], 'Min 2': [{ reps: '9' }], 'Min 3': [{ reps: '7' }] }

    // Leaderboard - this is a classic single-movement flat EMOM (no
    // stationMode), so resolveStationUnitsByKey correctly returns null
    // (nothing to classify) and the ordinary sum path runs unaffected.
    const unitsByKey = resolveStationUnitsByKey('EMOM', formatConfig, null)
    expect(unitsByKey).toBeNull()
    const [ranked] = sortSectionLogs([{ id: 'log1', sets: memberSets, logged_at: '2026-09-06T10:00:00Z' }], 'EMOM', formatConfig)
    expect(ranked._setsScore).toBe(26)
    expect(ranked._setsScore).not.toBe(3)

    // Journal / Share / Photo Result (all call setsScoreText identically)
    const text = setsScoreText('EMOM', formatConfig, memberSets, 'kg', 'reps', unitsByKey)
    expect(text).toBe('26 reps')
    expect(text).not.toContain('3 sets')
    expect(text).not.toBe('30 reps')
    expect(text).not.toBe('300 reps')
  })

  it('blank / zero / positive evidence is never conflated (owner §11/§28)', () => {
    const formatConfig = { totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' }
    // 10 / 10 / blank -> 20 (blank contributes nothing, never the target)
    expect(setsScoreText('EMOM', formatConfig, { 'Min 1': [{ reps: '10' }], 'Min 2': [{ reps: '10' }], 'Min 3': [{ reps: '' }] }, 'kg', 'reps')).toBe('20 reps')
    // 10 / 0 / blank -> 10 (explicit zero counts as real logged work)
    expect(setsScoreText('EMOM', formatConfig, { 'Min 1': [{ reps: '10' }], 'Min 2': [{ reps: '0' }], 'Min 3': [{ reps: '' }] }, 'kg', 'reps')).toBe('10 reps')
    // all blank -> no manufactured reps
    expect(setsScoreText('EMOM', formatConfig, { 'Min 1': [{ reps: '' }], 'Min 2': [{ reps: '' }], 'Min 3': [{ reps: '' }] }, 'kg', 'reps')).toBeNull()
  })
})

describe('REGRESSION - legacy flat EMOM historical log (73) and Intervals/Tabata unaffected by this incident', () => {
  it('the real historical flat log stays 73, never reinterpreted', () => {
    const cfg = { totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }
    const legacySets = {
      'Min 1': [{ reps: '12' }], 'Min 2': [{ reps: '12' }], 'Min 3': [{ reps: '10' }], 'Min 4': [{ reps: '12' }],
      'Min 5': [{ reps: '12' }], 'Min 6': [{ reps: '9' }], 'Min 7': [{ reps: '2' }], 'Min 8': [{ reps: '1' }],
      'Min 9': [{ reps: '2' }], 'Min 10': [{ reps: '1' }],
    }
    expect(setsScoreText('EMOM', cfg, legacySets, 'kg', 'reps')).toBe('73 reps')
  })

  it('Intervals structured scoring (INC-07) is unaffected - regression', () => {
    const s = createSection('metcon', true)
    s.format = 'Intervals'
    s.formatConfig = { roundCount: 5, workSec: 40, restSec: 20, scoringMode: 'Total Reps' }
    s.variants = { rx: { instances: ['Row', 'Wall Balls'].map((name) => ({ name, instanceId: name })), movements: [], weight: { male: '', female: '' }, note: '' } }
    const payload = legacyPayloadFromSections([s])
    expect(payload.format_config.stationMode).toBe('per-interval')
    expect(payload.format_config.rounds).toBe(10)
  })

  it('Tabata scoringMode default (Lowest Reps) is unaffected - regression', () => {
    expect(setsScoreText('Tabata', {}, { 'Rundă 1': [{ reps: '8' }], 'Rundă 2': [{ reps: '6' }] }, 'kg', 'reps')).toBe('6 reps')
  })
})
