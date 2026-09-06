// EMOM MINUTE-PATTERN AUTHORING - Phase C: Coach Builder save-path stamping.
// The Coach Builder's minute-grouped editor (EmomMinutePatternEditor,
// App.jsx) tags every RX instance it creates with `patternMinute`. Its
// presence on ANY RX instance is the explicit, unambiguous authoring
// signal (never inferred from movement count/order) that stamps
// stationMode:'minute-pattern' at save time - checked BEFORE the older
// 2+-movements shared-interval rule, which stays intact for any EMOM never
// touched by the new editor.

import { describe, it, expect } from 'vitest'
import { legacyPayloadFromSections, createSection } from './wodSections.js'

const makeEmomSection = (formatConfig, instances) => {
  const s = createSection('metcon', true)
  s.format = 'EMOM'
  s.formatConfig = formatConfig
  s.variants = { rx: { instances, movements: [], weight: { male: '', female: '' }, note: '' } }
  return s
}

describe('Save-path stamping - minute-pattern takes priority when patternMinute is present', () => {
  it('single movement per minute, cycling (owner worked example)', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 3, intervalSec: 60 }, [
      { name: '10 Push-ups', instanceId: 'a', patternMinute: 0, reps: { value: 10 } },
      { name: '10 Air Squats', instanceId: 'b', patternMinute: 1, reps: { value: 10 } },
      { name: '10 Pull-ups', instanceId: 'c', patternMinute: 2, reps: { value: 10 } },
    ])])
    expect(payload.type).toBe('EMOM')
    expect(payload.format_config.stationMode).toBe('minute-pattern')
  })

  it('multi-movement minute (MIN 1: Push+Squat, MIN 2: Pull) also stamps minute-pattern', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 4, intervalSec: 60 }, [
      { name: '10 Push-ups', instanceId: 'a', patternMinute: 0, reps: { value: 10 } },
      { name: '10 Air Squats', instanceId: 'b', patternMinute: 0, reps: { value: 10 } },
      { name: '8 Pull-ups', instanceId: 'c', patternMinute: 1, reps: { value: 8 } },
    ])])
    expect(payload.format_config.stationMode).toBe('minute-pattern')
  })

  it('a single instance at patternMinute 0 (legacy-defaulted, coach never moved anything) still stamps minute-pattern, not shared-interval', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 3, intervalSec: 60 }, [
      { name: '10 Push-ups', instanceId: 'a', patternMinute: 0, reps: { value: 10 } },
      { name: '10 Air Squats', instanceId: 'b', patternMinute: 0, reps: { value: 10 } },
      { name: '10 Pull-ups', instanceId: 'c', patternMinute: 0, reps: { value: 10 } },
    ])])
    expect(payload.format_config.stationMode).toBe('minute-pattern')
  })
})

describe('REGRESSION - an EMOM never touched by the new editor keeps the old shared-interval rule', () => {
  it('2+ RX movements, none carrying patternMinute -> still stamps shared-interval (older clients / AI regenerate)', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 10, intervalSec: 60 }, [
      { name: '10 PUSH-UPS', instanceId: 'a', reps: { value: 10 } },
      { name: '10 AIR SQUATS', instanceId: 'b', reps: { value: 10 } },
      { name: '10 PULL-UPS', instanceId: 'c', reps: { value: 10 } },
    ])])
    expect(payload.format_config.stationMode).toBe('shared-interval')
  })

  it('a single movement, no patternMinute -> stays legacy flat (untouched)', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 10, intervalSec: 60 }, [
      { name: '5 Burpees', instanceId: 'a', reps: { value: 5 } },
    ])])
    expect(payload.format_config.stationMode).toBeUndefined()
  })

  it('Intervals stamping is completely unaffected', () => {
    const s = createSection('metcon', true)
    s.format = 'Intervals'
    s.formatConfig = { roundCount: 5, workSec: 40, restSec: 20 }
    s.variants = { rx: { instances: ['Row', 'Wall Balls'].map((name) => ({ name, instanceId: name })), movements: [], weight: { male: '', female: '' }, note: '' } }
    const payload = legacyPayloadFromSections([s])
    expect(payload.format_config.stationMode).toBe('per-interval')
  })
})
