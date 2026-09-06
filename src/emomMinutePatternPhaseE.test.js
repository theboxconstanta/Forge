// EMOM MINUTE-PATTERN AUTHORING - Phase E: canonical results, one shared
// resolver across every surface. No EMOM arithmetic exists anywhere except
// computeSetsScore/setsDisplayScore/setsScoreText - Leaderboard
// (sortSectionLogs), Journal, Photo, Share all read the identical value.

import { describe, it, expect } from 'vitest'
import { legacyPayloadFromSections, createSection } from './wodSections.js'
import { sortSectionLogs, setsScoreText, resolveStationUnitsByKey, emomStationKey } from './workoutFormats.js'

function makeCoachEmomSection(instances, totalRounds = 3) {
  const s = createSection('metcon', true)
  s.format = 'EMOM'
  s.formatConfig = { totalRounds, intervalSec: 60, scoringMode: 'Total Reps' }
  s.variants = { rx: { instances, movements: [], weight: { male: '', female: '' }, note: '' } }
  return s
}

describe('Owner live fixture end to end - coach builder save -> member log -> canonical score everywhere', () => {
  const instances = [
    { name: '10 Push-ups', instanceId: 'a', patternMinute: 0, reps: { value: 10 } },
    { name: '10 Air Squats', instanceId: 'b', patternMinute: 1, reps: { value: 10 } },
    { name: '10 Pull-ups', instanceId: 'c', patternMinute: 2, reps: { value: 10 } },
  ]

  it('the coach-authored payload correctly persists stationMode:minute-pattern', () => {
    const payload = legacyPayloadFromSections([makeCoachEmomSection(instances)])
    expect(payload.format_config.stationMode).toBe('minute-pattern')
  })

  it('Leaderboard and Journal/Share/Photo (setsScoreText) agree on 26, never 3/30/300', () => {
    const payload = legacyPayloadFromSections([makeCoachEmomSection(instances)])
    const formatConfig = payload.format_config
    const memberSets = {
      [emomStationKey(1, 1, '10 Push-ups')]: [{ reps: '10' }],
      [emomStationKey(2, 1, '10 Air Squats')]: [{ reps: '9' }],
      [emomStationKey(3, 1, '10 Pull-ups')]: [{ reps: '7' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', formatConfig, instances)
    const [ranked] = sortSectionLogs([{ id: 'l1', sets: memberSets, logged_at: '2026-09-06T10:00:00Z', prescription_snapshot: { movements: instances } }], 'EMOM', formatConfig)
    expect(ranked._setsScore).toBe(26)
    const text = setsScoreText('EMOM', formatConfig, memberSets, 'kg', 'reps', unitsByKey)
    expect(text).toBe('26 reps')
    expect(text).not.toBe('3 sets')
  })

  it('multi-movement minute contribution (MIN 1 Push=10, Squat=7 -> 17) propagates identically', () => {
    const multiInstances = [
      { name: '10 Push-ups', instanceId: 'a', patternMinute: 0, reps: { value: 10 } },
      { name: '10 Air Squats', instanceId: 'b', patternMinute: 0, reps: { value: 10 } },
    ]
    const payload = legacyPayloadFromSections([makeCoachEmomSection(multiInstances, 1)])
    const formatConfig = payload.format_config
    const memberSets = {
      [emomStationKey(1, 1, '10 Push-ups')]: [{ reps: '10' }],
      [emomStationKey(1, 2, '10 Air Squats')]: [{ reps: '7' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', formatConfig, multiInstances)
    const [ranked] = sortSectionLogs([{ id: 'l1', sets: memberSets, logged_at: '2026-09-06T10:00:00Z', prescription_snapshot: { movements: multiInstances } }], 'EMOM', formatConfig)
    expect(ranked._setsScore).toBe(17)
    expect(setsScoreText('EMOM', formatConfig, memberSets, 'kg', 'reps', unitsByKey)).toBe('17 reps')
  })

  it('mixed-unit minute pattern (12 Cal Row + 10 Burpees) refuses the unsafe aggregate on every surface', () => {
    const mixedInstances = [
      { name: '12 Cal Row', instanceId: 'a', patternMinute: 0, calories: { value: 12 } },
      { name: '10 Burpees', instanceId: 'b', patternMinute: 1, reps: { value: 10 } },
    ]
    const payload = legacyPayloadFromSections([makeCoachEmomSection(mixedInstances, 2)])
    const formatConfig = payload.format_config
    const memberSets = {
      [emomStationKey(1, 1, '12 Cal Row')]: [{ reps: '12' }],
      [emomStationKey(2, 1, '10 Burpees')]: [{ reps: '10' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', formatConfig, mixedInstances)
    const [ranked] = sortSectionLogs([{ id: 'l1', sets: memberSets, logged_at: '2026-09-06T10:00:00Z', prescription_snapshot: { movements: mixedInstances } }], 'EMOM', formatConfig)
    expect(ranked._setsScore).toBeNull()
    expect(ranked._setsScore).not.toBe(22)
    expect(setsScoreText('EMOM', formatConfig, memberSets, 'kg', 'reps', unitsByKey)).toBeNull()
  })
})

describe('REGRESSION - historical snapshots and other formats remain untouched', () => {
  it('the real historical flat log (73) is untouched by the minute-pattern addition', () => {
    const legacySets = {
      'Min 1': [{ reps: '12' }], 'Min 2': [{ reps: '12' }], 'Min 3': [{ reps: '10' }], 'Min 4': [{ reps: '12' }],
      'Min 5': [{ reps: '12' }], 'Min 6': [{ reps: '9' }], 'Min 7': [{ reps: '2' }], 'Min 8': [{ reps: '1' }],
      'Min 9': [{ reps: '2' }], 'Min 10': [{ reps: '1' }],
    }
    expect(setsScoreText('EMOM', { totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }, legacySets, 'kg', 'reps')).toBe('73 reps')
  })

  it('an EXISTING shared-interval EMOM log (prior incident) is untouched', () => {
    const cfg = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Reps' }
    const sets = {
      [emomStationKey(1, 1, 'Push-ups')]: [{ reps: '10' }], [emomStationKey(1, 2, 'Air Squats')]: [{ reps: '10' }],
      [emomStationKey(2, 1, 'Push-ups')]: [{ reps: '10' }], [emomStationKey(2, 2, 'Air Squats')]: [{ reps: '10' }],
    }
    expect(setsScoreText('EMOM', cfg, sets, 'kg', 'reps')).toBe('40 reps')
  })

  it('Intervals/Tabata scoring completely unaffected', () => {
    expect(setsScoreText('Tabata', {}, { 'Rundă 1': [{ reps: '8' }], 'Rundă 2': [{ reps: '6' }] }, 'kg', 'reps')).toBe('6 reps')
  })
})
