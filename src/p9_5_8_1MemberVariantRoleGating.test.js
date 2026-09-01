import { describe, it, expect } from 'vitest'
import {
  mapLegacyWodToWorkout,
  getProgrammedVariantLevels,
  isProgrammedVariant,
  resolveDefaultProgrammedVariantKey,
} from './workoutEngine'
import { VARIANTE_WEIGHT_BASE } from './workoutFormats'

// P9.5.8.1 - MEMBER VARIANT VISIBILITY / ROLE-GATING CORRECTION
//
// P9.5.8 shipped with an "admin/coach exempt everywhere" carve-out. Owner
// visual acceptance showed the Home WOD card (a CONSUMPTION surface) still
// rendering all four accordions + "Log - Intermediate" for an admin account on
// an RX-only workout.
//
// Final rule:
//   AUTHORING surface (WOD editor)      -> may expose all four variant slots.
//   CONSUMPTION surface (Home / logger) -> only programmed variants, EVERY role.
//   SAVE validation                     -> role-independent, fail closed.
//
// The resolver layer carries no role. These tests lock the resolver contract
// the App.jsx consumption surfaces now depend on (role-free + empty = reject),
// plus the deterministic re-resolution used to sanitize a stale selection.

const baseWod = {
  id: 'w', gym_id: 'g', date: '2026-09-01', name: 'T', type: 'For Time',
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
const metconOf = (w) => mapLegacyWodToWorkout(w).sections.find((s) => s.slotKey === 'metcon')

// Mirrors App.jsx `homeVariantSelectable` (role-free) exactly.
const selectable = (section, doc, levelOrKey) => isProgrammedVariant(section, doc, levelOrKey)

// Mirrors the App.jsx sanitize/soft-default effect resolution.
function resolveSelectionIndex(section, doc, { current, usualLevel }) {
  if (current != null) {
    const currentKey = VARIANTE_WEIGHT_BASE[current]?.key
    if (currentKey && getProgrammedVariantLevels(section, doc).includes(currentKey)) return current
  } else if (!usualLevel) {
    return null
  }
  const key = resolveDefaultProgrammedVariantKey(section, doc, usualLevel ?? null)
  const idx = key ? VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === key) : -1
  return idx !== -1 ? idx : null
}

describe('P9.5.8.1 · consumption availability is role-free', () => {
  const rxOnly = metconOf(baseWod)
  const rxInt = metconOf({ ...baseWod, movements_intermediate: ['DB Thrusters', 'Ring Rows'] })

  it('RX-only: only RX selectable — identical result whatever the caller (no role param exists)', () => {
    expect(getProgrammedVariantLevels(rxOnly, null)).toEqual(['rx'])
    expect(selectable(rxOnly, null, 'RX')).toBe(true)
    for (const k of ['Intermediate', 'Beginner', 'OnRamp']) {
      expect(selectable(rxOnly, null, k)).toBe(false)
    }
  })

  it('RX + Intermediate: exactly those two selectable', () => {
    expect(selectable(rxInt, null, 'RX')).toBe(true)
    expect(selectable(rxInt, null, 'Intermediate')).toBe(true)
    expect(selectable(rxInt, null, 'Beginner')).toBe(false)
    expect(selectable(rxInt, null, 'OnRamp')).toBe(false)
  })

  it('all four genuinely programmed: all four selectable (role removal does not hide real variants)', () => {
    const all = metconOf({ ...baseWod, movements_intermediate: ['a'], movements_beginner: ['b'], movements_onramp: ['c'] })
    for (const k of ['RX', 'Intermediate', 'Beginner', 'OnRamp']) {
      expect(selectable(all, null, k)).toBe(true)
    }
  })
})

describe('P9.5.8.1 · save guard is role-independent + fail closed', () => {
  it('RX-only workout + forced Intermediate selection → isProgrammedVariant false for every caller', () => {
    const sec = metconOf(baseWod)
    // saveWodLog no longer has an isAdmin/isCoach branch; this is the only check.
    expect(isProgrammedVariant(sec, null, 'Intermediate')).toBe(false)
  })

  it('incomplete workout (no programmed variant) → save guard rejects', () => {
    const sec = metconOf({ ...baseWod, movements_rx: [], notes_rx: null })
    expect(getProgrammedVariantLevels(sec, null)).toEqual([])
    expect(isProgrammedVariant(sec, null, 'RX')).toBe(false)
  })
})

describe('P9.5.8.1 · stale selection sanitization (deterministic re-resolution)', () => {
  it('Workout A (RX+Int) select Intermediate → Workout B (RX-only): selection re-resolves to RX', () => {
    const b = metconOf(baseWod) // RX only
    const intIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'intermediate')
    const rxIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'rx')
    expect(resolveSelectionIndex(b, null, { current: intIdx, usualLevel: null })).toBe(rxIdx)
  })

  it('stale selection + usual_level that IS programmed on the new workout → usual_level wins', () => {
    const b = metconOf({ ...baseWod, movements_beginner: ['x'] }) // RX + Beginner
    const onrIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'onramp')
    const begIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'beginner')
    expect(resolveSelectionIndex(b, null, { current: onrIdx, usualLevel: 'beginner' })).toBe(begIdx)
  })

  it('valid selection is kept (no churn)', () => {
    const b = metconOf({ ...baseWod, movements_intermediate: ['x'] })
    const intIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'intermediate')
    expect(resolveSelectionIndex(b, null, { current: intIdx, usualLevel: 'rx' })).toBe(intIdx)
  })

  it('stale selection on an incomplete workout → cleared to no selection', () => {
    const b = metconOf({ ...baseWod, movements_rx: [], notes_rx: null })
    expect(resolveSelectionIndex(b, null, { current: 0, usualLevel: 'intermediate' })).toBe(null)
  })

  it('no selection + no usual_level → left unmade (member picks from the accordion)', () => {
    const b = metconOf(baseWod)
    expect(resolveSelectionIndex(b, null, { current: null, usualLevel: null })).toBe(null)
  })

  it('no selection + usual_level intermediate on RX-only → RX (owner-screenshot class)', () => {
    const b = metconOf(baseWod)
    const rxIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'rx')
    expect(resolveSelectionIndex(b, null, { current: null, usualLevel: 'intermediate' })).toBe(rxIdx)
  })
})

describe('P9.5.8.1 · Intermediate-only workout (RX not fabricated for any role)', () => {
  it('member sees only Intermediate; RX is not selectable', () => {
    const sec = metconOf({ ...baseWod, movements_rx: [], type: 'Chained AMRAP', movements_intermediate: ['8 rounds:', '5 Burpees'] })
    expect(getProgrammedVariantLevels(sec, null)).toEqual(['intermediate'])
    expect(selectable(sec, null, 'RX')).toBe(false)
    expect(selectable(sec, null, 'Intermediate')).toBe(true)
    const intIdx = VARIANTE_WEIGHT_BASE.findIndex((v) => v.key === 'intermediate')
    expect(resolveSelectionIndex(sec, null, { current: null, usualLevel: 'rx' })).toBe(intIdx)
  })
})
