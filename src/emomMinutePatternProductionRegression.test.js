// EMOM MINUTE-PATTERN PRODUCTION LOGGER REGRESSION.
//
// FORENSIC CONCLUSION: every boundary in the current codebase - coach
// authoring -> legacyPayloadFromSections serialization -> DB persistence
// shape -> resolveEmomTimeline -> FormatLogger's SetsFields branch order -
// was traced against the EXACT real production WOD
// (dbc92568-2e4d-4ef0-a56b-b10f2f44541d, read-only query) and found
// correct: format_config.stationMode = 'minute-pattern', Push-ups carries
// NO patternMinute field at all (a legacy instance predating the
// minute-pattern editor, carried over through several saves), Air Squat
// patternMinute:1, Pull-up patternMinute:2. Fed through the CURRENT
// resolveEmomTimeline, this exact data resolves to the correct 6-minute
// cycle (Push-ups/Air Squat/Pull-up x2), never 18 stations. No code defect
// was found in this trace for the reported symptom - see the final report
// for the stale-client-cache hypothesis.
//
// This suite hardens the regression coverage the previous incident's
// browser test was missing: that test hand-built a `saved` config/instance
// array directly in the preview harness (never round-tripped through
// legacyPayloadFromSections' real serialization, and never exercised an
// instance MISSING patternMinute like the real Push-ups). Every test below
// uses the REAL exported functions - createSection, legacyPayloadFromSections,
// resolveEmomTimeline, defaultRowsForFormat, computeSetsScore,
// sortSectionLogs, setsScoreText - simulating the DB round-trip by reading
// straight back the object legacyPayloadFromSections would have written.

import { describe, it, expect } from 'vitest'
import { createSection, legacyPayloadFromSections } from './wodSections.js'
import {
  resolveEmomTimeline, defaultRowsForFormat, emomStationKey,
  computeSetsScore, setsScoreText, resolveStationUnitsByKey, sortSectionLogs,
} from './workoutFormats.js'

// Simulates a member logging session hydrating from a persisted WOD row -
// mirrors App.jsx's own read: activePrescriptionDoc = wods.movement_prescriptions,
// frozenProgrammedInstances = activePrescriptionDoc.variants.rx.movements,
// activeLogFormatConfig = wods.format_config.
function hydrateRxInstances(payload) {
  return payload.movement_prescriptions?.variants?.rx?.movements
    ?? payload.prescriptions?.variants?.rx?.movements // tolerate either field name the payload may use
    ?? []
}

const mkEmomSection = (instances, totalRounds = 6) => {
  const s = createSection('metcon', true)
  s.format = 'EMOM'
  s.formatConfig = { intervalSec: 60, totalRounds, scoringMode: 'Total Reps' }
  s.variants.rx.instances = instances
  return s
}

describe('OWNER PRODUCTION FIXTURE - exact real DB data (wod dbc92568-...), fed through the real resolver', () => {
  // Verbatim from the live, read-only DB query - Push-ups carries NO
  // patternMinute field at all (legacy-carried instance).
  const prodConfig = { intervalSec: 60, scoringMode: 'Total Reps', stationMode: 'minute-pattern', totalRounds: 6 }
  const prodInstances = [
    { canonicalMovementId: '0b294896-0514-4231-b5fc-a26cf7ce6c13', instanceId: 'mi_bGmXCFnytIWe-6Vda6u7C', name: 'Push-ups' },
    { canonicalMovementId: 'a8b27a2b-440b-4f96-b9ef-13e63aba6cdc', instanceId: 'mi_4UkwMu0OhxYoUvPAieWCw', name: 'Air Squat', patternMinute: 1, reps: { mode: 'universal', value: null } },
    { canonicalMovementId: '3de03537-d9fe-4e2a-9950-deee207e1040', instanceId: 'mi_7gpxvXAahDH_f8MfowLo-', name: 'Pull-up', patternMinute: 2, reps: { mode: 'universal', value: null } },
  ]

  it('resolveEmomTimeline resolves exactly 6 effective minutes, cycling Push-ups/Air Squat/Pull-up ONCE EACH per cycle', () => {
    const timeline = resolveEmomTimeline('EMOM', prodConfig, prodInstances)
    expect(timeline.structured).toBe(true)
    expect(timeline.patternLength).toBe(3)
    expect(timeline.effectiveMinutes.map((m) => m.movements.map((mv) => mv.name))).toEqual([
      ['Push-ups'], ['Air Squat'], ['Pull-up'], ['Push-ups'], ['Air Squat'], ['Pull-up'],
    ])
  })

  it('defaultRowsForFormat (the logger\'s row seed) produces exactly 6 rows, never 18', () => {
    const rows = defaultRowsForFormat('EMOM', prodConfig, prodInstances)
    expect(Object.keys(rows)).toHaveLength(6)
  })

  it('Total Reps 10/9/7/10/9/7 -> canonical 52, never a manufactured 300/9-station total', () => {
    const rowsByKey = {}
    const timeline = resolveEmomTimeline('EMOM', prodConfig, prodInstances)
    const values = [10, 9, 7, 10, 9, 7]
    timeline.effectiveMinutes.forEach(({ minute, movements }, i) => {
      rowsByKey[emomStationKey(minute, 1, movements[0].name)] = [{ reps: String(values[i]) }]
    })
    const unitsByKey = resolveStationUnitsByKey('EMOM', prodConfig, prodInstances)
    expect(computeSetsScore('EMOM', prodConfig, rowsByKey, unitsByKey)).toBe(52)
  })

  it('blank minutes never manufacture reps: 10/9/blank/10/9/blank -> 38', () => {
    const rowsByKey = {}
    const timeline = resolveEmomTimeline('EMOM', prodConfig, prodInstances)
    const values = ['10', '9', '', '10', '9', '']
    timeline.effectiveMinutes.forEach(({ minute, movements }, i) => {
      rowsByKey[emomStationKey(minute, 1, movements[0].name)] = [{ reps: values[i] }]
    })
    expect(computeSetsScore('EMOM', prodConfig, rowsByKey)).toBe(38)
  })

  it('cross-surface: Leaderboard and Journal/Share/Photo (setsScoreText) agree on 52', () => {
    const rowsByKey = {}
    const timeline = resolveEmomTimeline('EMOM', prodConfig, prodInstances)
    const values = [10, 9, 7, 10, 9, 7]
    timeline.effectiveMinutes.forEach(({ minute, movements }, i) => {
      rowsByKey[emomStationKey(minute, 1, movements[0].name)] = [{ reps: String(values[i]) }]
    })
    const [ranked] = sortSectionLogs([{ id: 'l1', sets: rowsByKey, logged_at: '2026-09-06T10:00:00Z', prescription_snapshot: { movements: prodInstances } }], 'EMOM', prodConfig)
    expect(ranked._setsScore).toBe(52)
    const unitsByKey = resolveStationUnitsByKey('EMOM', prodConfig, prodInstances)
    expect(setsScoreText('EMOM', prodConfig, rowsByKey, 'kg', 'reps', unitsByKey)).toBe('52 reps')
  })
})

describe('REAL SAVE -> HYDRATE round trip (the exact boundary the previous browser test skipped)', () => {
  it('patternMinute survives legacyPayloadFromSections -> re-read, including a movement with NO explicit field', () => {
    // Coach authors: Push-ups added first (no patternMinute written unless
    // the editor explicitly touches it - mirrors the real production shape),
    // Air Squat and Pull-up added via "+ Add movement" in MIN 2/MIN 3 (which
    // DOES explicitly set patternMinute).
    const instances = [
      { instanceId: 'a', name: 'Push-ups', reps: { mode: 'universal', value: 10 } }, // no patternMinute, as in production
      { instanceId: 'b', name: 'Air Squat', patternMinute: 1, reps: { mode: 'universal', value: 10 } },
      { instanceId: 'c', name: 'Pull-up', patternMinute: 2, reps: { mode: 'universal', value: 10 } },
    ]
    const payload = legacyPayloadFromSections([mkEmomSection(instances)])
    expect(payload.format_config.stationMode).toBe('minute-pattern')

    const hydrated = hydrateRxInstances(payload)
    expect(hydrated).toHaveLength(3)
    const byName = Object.fromEntries(hydrated.map((m) => [m.name, m]))
    // owner §9 mandatory assertion - hardened: patternMinute is now
    // explicitly stamped at save time even for the legacy-carried Push-ups
    // (defensive persistence hardening - resolveEmomTimeline already
    // defaulted this correctly at read time either way).
    expect(byName['Push-ups'].patternMinute).toBe(0)
    expect(byName['Air Squat'].patternMinute).toBe(1)
    expect(byName['Pull-up'].patternMinute).toBe(2)

    // Reload Coach Builder / Open Member Logger - the REHYDRATED instances
    // (not a manually constructed fixture) resolve the correct cycle.
    const timeline = resolveEmomTimeline('EMOM', payload.format_config, hydrated)
    expect(timeline.effectiveMinutes.map((m) => m.movements[0].name)).toEqual([
      'Push-ups', 'Air Squat', 'Pull-up', 'Push-ups', 'Air Squat', 'Pull-up',
    ])
  })
})

describe('MULTI-MOVEMENT MINUTE - real round trip, 4 rounds, MIN 1 = Push-ups+Air Squats, MIN 2 = Pull-ups', () => {
  it('renders 6 total stations, never 12', () => {
    const instances = [
      { instanceId: 'a', name: 'Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      { instanceId: 'b', name: 'Air Squats', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      { instanceId: 'c', name: 'Pull-ups', patternMinute: 1, reps: { mode: 'universal', value: 8 } },
    ]
    const payload = legacyPayloadFromSections([mkEmomSection(instances, 4)])
    const hydrated = hydrateRxInstances(payload)
    const timeline = resolveEmomTimeline('EMOM', payload.format_config, hydrated)
    expect(timeline.effectiveMinutes.map((m) => m.movements.map((mv) => mv.name))).toEqual([
      ['Push-ups', 'Air Squats'], ['Pull-ups'], ['Push-ups', 'Air Squats'], ['Pull-ups'],
    ])
    const rows = defaultRowsForFormat('EMOM', payload.format_config, hydrated)
    expect(Object.keys(rows)).toHaveLength(6)
  })
})

describe('REGRESSION BOUNDARY - legacy flat, legacy cycling, and existing shared-interval EMOM keep their historical semantics', () => {
  it('legacy flat EMOM (the one real historical log, sum=73) is untouched', () => {
    const cfg = { totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }
    const legacySets = {
      'Min 1': [{ reps: '12' }], 'Min 2': [{ reps: '12' }], 'Min 3': [{ reps: '10' }], 'Min 4': [{ reps: '12' }],
      'Min 5': [{ reps: '12' }], 'Min 6': [{ reps: '9' }], 'Min 7': [{ reps: '2' }], 'Min 8': [{ reps: '1' }],
      'Min 9': [{ reps: '2' }], 'Min 10': [{ reps: '1' }],
    }
    expect(setsScoreText('EMOM', cfg, legacySets, 'kg', 'reps')).toBe('73 reps')
  })

  it('legacy cycling EMOM (config.intervals) row generation is untouched', () => {
    const rows = defaultRowsForFormat('EMOM', { totalRounds: 4, intervals: ['Burpees', 'Air Squats'] }, [])
    expect(Object.keys(rows)).toEqual(['Min 1 · Burpees', 'Min 2 · Air Squats', 'Min 3 · Burpees', 'Min 4 · Air Squats'])
  })

  it('an EXISTING stationMode:"shared-interval" EMOM (prior incident) still shows every movement every round', () => {
    const cfg = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [{ name: 'Push-ups' }, { name: 'Air Squats' }, { name: 'Pull-ups' }]
    const rows = defaultRowsForFormat('EMOM', cfg, movements)
    expect(Object.keys(rows)).toHaveLength(6) // 2 rounds x 3 stations, unchanged
  })

  it('Intervals structured scoring (INC-07) is unaffected', () => {
    const s = createSection('metcon', true)
    s.format = 'Intervals'
    s.formatConfig = { roundCount: 5, workSec: 40, restSec: 20 }
    s.variants = { rx: { instances: ['Row', 'Wall Balls'].map((name) => ({ name, instanceId: name })), movements: [], weight: { male: '', female: '' }, note: '' } }
    const payload = legacyPayloadFromSections([s])
    expect(payload.format_config.stationMode).toBe('per-interval')
    expect(payload.format_config.rounds).toBe(10)
  })

  it('Tabata scoring is unaffected', () => {
    expect(setsScoreText('Tabata', {}, { 'Rundă 1': [{ reps: '8' }], 'Rundă 2': [{ reps: '6' }] }, 'kg', 'reps')).toBe('6 reps')
  })
})
