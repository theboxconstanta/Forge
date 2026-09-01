import { describe, it, expect } from 'vitest'
import {
  mapLegacyWodToWorkout,
  getProgrammedVariantLevels,
  isProgrammedVariant,
  resolveDefaultProgrammedVariantKey,
} from './workoutEngine'

// P9.5.8 - PROGRAMMED VARIANT AVAILABILITY CONTRACT
// Invariant: the variant levels a member may select == the variant levels the
// coach EXPLICITLY programmed. Never fill gaps; never assume RX exists; an
// empty placeholder variant does not count; a load/distance-only variant does.

const baseWod = {
  id: 'w1', gym_id: 'g1', date: '2026-09-01', name: 'TEST', type: 'For Time',
  format_config: {}, warmup: null, skill: null, skill2: null,
  movements_rx: ['21-15-9', 'Thrusters', 'Pull-ups'],
  movements_intermediate: [], movements_beginner: [], movements_onramp: [],
  notes_rx: null, notes_intermediate: null, notes_beginner: null, notes_onramp: null,
  rx_weight_male: null, rx_weight_female: null,
  intermediate_weight_male: null, intermediate_weight_female: null,
  beginner_weight_male: null, beginner_weight_female: null,
  onramp_weight_male: null, onramp_weight_female: null,
  movement_prescriptions: null,
}

const metconOf = (wod) => mapLegacyWodToWorkout(wod).sections.find((s) => s.slotKey === 'metcon')

describe('P9.5.8 · getProgrammedVariantLevels — legacy wods', () => {
  it('RX-only workout → only RX is selectable', () => {
    const sec = metconOf(baseWod)
    expect(getProgrammedVariantLevels(sec, baseWod.movement_prescriptions)).toEqual(['rx'])
  })

  it('RX + Intermediate movements → exactly those two, in canonical order', () => {
    const wod = { ...baseWod, movements_intermediate: ['21-15-9', 'Dumbbell Thrusters', 'Ring Rows'] }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx', 'intermediate'])
  })

  it('does NOT fill the gap: RX + OnRamp programmed leaves Intermediate/Beginner out', () => {
    const wod = { ...baseWod, movements_onramp: ['15-12-9', 'Air Squats', 'Push-ups'] }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx', 'onramp'])
  })

  it('all four programmed → all four', () => {
    const wod = {
      ...baseWod,
      movements_intermediate: ['a'], movements_beginner: ['b'], movements_onramp: ['c'],
    }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx', 'intermediate', 'beginner', 'onramp'])
  })

  it('RX not assumed: metcon whose only content is an Intermediate variant → ["intermediate"]', () => {
    const wod = {
      ...baseWod,
      movements_rx: [], notes_rx: null, type: 'Chained AMRAP',
      movements_intermediate: ['8 rounds:', '5 Burpees', '6 Strict Pull-ups'],
    }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['intermediate'])
  })

  it('empty placeholder variant (no movements, no notes, no weight) does NOT count', () => {
    const wod = {
      ...baseWod,
      movements_intermediate: [], notes_intermediate: '   ',
      intermediate_weight_male: null, intermediate_weight_female: null,
    }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx'])
  })

  it('a note-only scaled variant counts (coach wrote real guidance)', () => {
    const wod = { ...baseWod, notes_intermediate: 'Scale the pull-ups to banded.' }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx', 'intermediate'])
  })

  it('a load-differentiated variant that shares RX movements counts (§6)', () => {
    const wod = { ...baseWod, beginner_weight_male: '30', beginner_weight_female: '20' }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx', 'beginner'])
  })

  it('RX weight alone still marks RX programmed even with no movements', () => {
    const wod = { ...baseWod, movements_rx: [], rx_weight_male: '60' }
    expect(getProgrammedVariantLevels(metconOf(wod), null)).toEqual(['rx'])
  })
})

describe('P9.5.8 · getProgrammedVariantLevels — structured movement_prescriptions', () => {
  it('structured rx-only doc → only RX', () => {
    const wod = {
      ...baseWod, movements_rx: [],
      movement_prescriptions: { version: 1, variants: { rx: { movements: [{ instanceId: 'a', name: 'Thruster' }] } } },
    }
    expect(getProgrammedVariantLevels(metconOf(wod), wod.movement_prescriptions)).toEqual(['rx'])
  })

  it('structured intermediate entry with movements → intermediate programmed', () => {
    const wod = {
      ...baseWod,
      movement_prescriptions: {
        version: 1,
        variants: {
          rx: { movements: [{ instanceId: 'a', name: 'Thruster' }] },
          intermediate: { movements: [{ instanceId: 'b', name: 'DB Thruster' }] },
        },
      },
    }
    expect(getProgrammedVariantLevels(metconOf(wod), wod.movement_prescriptions)).toEqual(['rx', 'intermediate'])
  })

  it('structured intermediate entry with EMPTY movements array does NOT count', () => {
    const wod = {
      ...baseWod,
      movement_prescriptions: {
        version: 1,
        variants: {
          rx: { movements: [{ instanceId: 'a', name: 'Thruster' }] },
          intermediate: { movements: [] },
        },
      },
    }
    expect(getProgrammedVariantLevels(metconOf(wod), wod.movement_prescriptions)).toEqual(['rx'])
  })
})

describe('P9.5.8 · isProgrammedVariant', () => {
  const wod = { ...baseWod, movements_intermediate: ['x'] }
  const sec = metconOf(wod)

  it('accepts any display-side spelling', () => {
    expect(isProgrammedVariant(sec, null, 'RX')).toBe(true)
    expect(isProgrammedVariant(sec, null, 'Intermediate')).toBe(true)
    expect(isProgrammedVariant(sec, null, 'intermediate')).toBe(true)
  })

  it('rejects a non-programmed variant — NO coercion to RX', () => {
    expect(isProgrammedVariant(sec, null, 'Beginner')).toBe(false)
    expect(isProgrammedVariant(sec, null, 'OnRamp')).toBe(false)
  })

  it('on_ramp / OnRamp / onramp all normalise to the same key', () => {
    const w = { ...baseWod, movements_onramp: ['y'] }
    const s = metconOf(w)
    expect(isProgrammedVariant(s, null, 'on_ramp')).toBe(true)
    expect(isProgrammedVariant(s, null, 'OnRamp')).toBe(true)
    expect(isProgrammedVariant(s, null, 'onramp')).toBe(true)
  })

  it('unclassifiable workout (no programming signal) → every key allowed (fallback)', () => {
    const w = { ...baseWod, movements_rx: [], notes_rx: null }
    const s = metconOf(w)
    expect(getProgrammedVariantLevels(s, null)).toEqual([])
    for (const k of ['RX', 'Intermediate', 'Beginner', 'OnRamp']) {
      expect(isProgrammedVariant(s, null, k)).toBe(true)
    }
  })

  it('null section → allowed (unclassifiable, same conservative fallback as an empty set)', () => {
    // The guard restricts ONLY when it can positively identify the programmed
    // set. A missing section (some unrelated load quirk) must not block a
    // legitimate save.
    expect(isProgrammedVariant(null, null, 'RX')).toBe(true)
  })

  it('unknown level string → false', () => {
    expect(isProgrammedVariant(sec, null, 'nonsense')).toBe(false)
  })
})

describe('P9.5.8 · resolveDefaultProgrammedVariantKey (soft default, never a bypass)', () => {
  it('honours usual_level when it is programmed', () => {
    const wod = { ...baseWod, movements_intermediate: ['x'] }
    expect(resolveDefaultProgrammedVariantKey(metconOf(wod), null, 'intermediate')).toBe('intermediate')
  })

  it('falls back to RX when usual_level is NOT programmed', () => {
    const sec = metconOf(baseWod) // RX only
    expect(resolveDefaultProgrammedVariantKey(sec, null, 'intermediate')).toBe('rx')
    expect(resolveDefaultProgrammedVariantKey(sec, null, 'onramp')).toBe('rx')
  })

  it('falls back to first programmed level when neither usual_level nor RX is programmed', () => {
    const wod = { ...baseWod, movements_rx: [], movements_beginner: ['b'], movements_onramp: ['c'] }
    expect(resolveDefaultProgrammedVariantKey(metconOf(wod), null, 'intermediate')).toBe('beginner')
  })

  it('returns null when nothing is programmed (caller leaves the choice unmade)', () => {
    const wod = { ...baseWod, movements_rx: [], notes_rx: null }
    expect(resolveDefaultProgrammedVariantKey(metconOf(wod), null, 'rx')).toBe(null)
  })

  it('normalises usual_level spelling (onramp vs on_ramp)', () => {
    const wod = { ...baseWod, movements_onramp: ['c'] }
    expect(resolveDefaultProgrammedVariantKey(metconOf(wod), null, 'onramp')).toBe('onramp')
  })
})

describe('P9.5.8 · historical safety', () => {
  it('resolver is read-only over the section — never mutates it', () => {
    const wod = { ...baseWod, movements_intermediate: ['x'] }
    const sec = metconOf(wod)
    const before = JSON.stringify(sec)
    getProgrammedVariantLevels(sec, null)
    isProgrammedVariant(sec, null, 'RX')
    resolveDefaultProgrammedVariantKey(sec, null, 'rx')
    expect(JSON.stringify(sec)).toBe(before)
  })
})
