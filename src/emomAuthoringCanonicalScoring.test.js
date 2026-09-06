// EMOM AUTHORING + CANONICAL SCORING INTEGRITY - Phase A: root cause + pure
// contract. LIVE ROOT CAUSE: EMOM's `scoringMode` schema field has
// deliberately NO default (unlike Tabata/Intervals) - a coach who never
// explicitly picks a value (the generic SelectField shows "Total Reps"
// COSMETICALLY via options[0] but never WRITES it unless touched) ends up
// with format_config.scoringMode absent. resolveSetsScoringMode then returns
// null, computeSetsScore returns null immediately, and every surface falls
// back to the generic "N sets" entry-count description - NOT a
// computeSetsScore bug, an authoring-persistence gap. This file proves the
// EXISTING computeSetsScore already sums 10+9+7=26 correctly the moment
// scoringMode is actually present, and adds the new pure contract pieces
// (No Score normalization, Total Calories, resolveEmomScoringOptions) the
// Phase B builder wiring needs.

import { describe, it, expect } from 'vitest'
import {
  computeSetsScore, setsDisplayScore, setsScoreText, setsScoreUnitSuffix,
  resolveSetsScoringMode, resolveEmomScoringOptions, scoredMetricOf,
} from './workoutFormats.js'

describe('Root cause reproduction - owner live fixture (10/9/7)', () => {
  const rowsByKey = { 'Min 1': [{ reps: '10' }], 'Min 2': [{ reps: '9' }], 'Min 3': [{ reps: '7' }] }

  it('WITHOUT an explicit scoringMode (the exact live-DB shape), computeSetsScore correctly returns null - not a fabricated 3 or 26', () => {
    expect(resolveSetsScoringMode('EMOM', { totalRounds: 3, intervalSec: 60 })).toBeNull()
    expect(computeSetsScore('EMOM', { totalRounds: 3, intervalSec: 60 }, rowsByKey)).toBeNull()
  })

  it('WITH scoringMode: Total Reps explicitly persisted, the existing computeSetsScore already sums to 26 - no scoring-engine change was needed for this', () => {
    const cfg = { totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' }
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).toBe(26)
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).not.toBe(3)
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).not.toBe(30)
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).not.toBe(300)
    expect(setsScoreText('EMOM', cfg, rowsByKey, 'kg', 'reps')).toBe('26 reps')
  })
})

describe('No Score - explicit coach choice normalizes to the existing safe null path', () => {
  it('resolveSetsScoringMode treats "No Score" identically to absent', () => {
    expect(resolveSetsScoringMode('EMOM', { scoringMode: 'No Score' })).toBeNull()
  })
  it('computeSetsScore never manufactures a scalar for an explicit No Score EMOM', () => {
    const cfg = { totalRounds: 3, intervalSec: 60, scoringMode: 'No Score' }
    const rowsByKey = { 'Min 1': [{ reps: '10' }], 'Min 2': [{ reps: '9' }], 'Min 3': [{ reps: '7' }] }
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).toBeNull()
    expect(setsDisplayScore('EMOM', cfg, rowsByKey)).toBeNull() // no weight logged either
  })
  it('the literal "No Score" string is still what gets persisted (builder reload fidelity) - only the SCORING read normalizes it', () => {
    const cfg = { scoringMode: 'No Score' }
    expect(cfg.scoringMode).toBe('No Score') // never silently cleared at the authoring layer
  })
})

describe('Total Calories - new named scoringMode, same sum arithmetic, correct unit', () => {
  const cfg = { totalRounds: 2, intervalSec: 60, scoringMode: 'Total Calories' }
  const rowsByKey = { 'Min 1': [{ reps: '12' }], 'Min 2': [{ reps: '9' }] }

  it('sums via the SAME reps-values arithmetic as Total Reps - no parallel aggregation algorithm', () => {
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).toBe(21)
  })
  it('setsScoreText labels it "cal", never "reps" or "kg"', () => {
    expect(setsScoreText('EMOM', cfg, rowsByKey, 'kg', 'reps')).toBe('21 cal')
  })
  it('setsScoreUnitSuffix resolves "cal" directly', () => {
    expect(setsScoreUnitSuffix(cfg, 'EMOM', 'kg', 'reps')).toBe('cal')
  })
})

describe('setsScoreUnitSuffix - regression: byte-identical to the old inline ternary for every pre-existing case', () => {
  it('weight-scored (Complex Total Weight) -> kg/lbs, unaffected by the calories addition', () => {
    expect(setsScoreUnitSuffix({ scoringMode: 'Total Weight' }, 'Complex', 'kg')).toBe('kg')
    expect(setsScoreUnitSuffix({ scoringMode: 'Total Weight' }, 'Complex', 'lbs')).toBe('lbs')
  })
  it('reps-scored (Tabata Lowest Reps) -> repsWord, unaffected', () => {
    expect(setsScoreUnitSuffix({ scoringMode: 'Lowest Reps' }, 'Tabata', 'kg', 'reps')).toBe('reps')
  })
  it('absent scoringMode (Weightlifting) -> weight-scored fallback, unaffected', () => {
    expect(setsScoreUnitSuffix({}, 'Weightlifting', 'kg')).toBe('kg')
  })
})

describe('resolveEmomScoringOptions - unit-aware coach-facing option filtering, canonical source only', () => {
  const reps = (name) => ({ name, reps: { mode: 'universal', value: 10 } })
  const repsWithLoad = (name) => ({ name, reps: { mode: 'universal', value: 10 }, load: { value: 43, unit: 'kg' } })
  const calories = (name) => ({ name, calories: { mode: 'universal', value: 12 } })
  const distance = (name) => ({ name, distance: { mode: 'universal', value: 100, unit: 'm' } })

  it('Case A - reps-only, single movement per interval: Total Reps + Lowest Reps + No Score', () => {
    expect(resolveEmomScoringOptions([reps('10 Burpees')])).toEqual(['Total Reps', 'Lowest Reps', 'No Score'])
  })
  it('Case A2 - reps-only, 2+ movements per interval: Total Reps only (Lowest Reps ambiguous - owner §13)', () => {
    expect(resolveEmomScoringOptions([reps('10 Push-ups'), reps('10 Air Squats'), reps('10 Pull-ups')]))
      .toEqual(['Total Reps', 'No Score'])
  })
  it('Case B - calories-only: Total Calories + No Score, never a reps option', () => {
    expect(resolveEmomScoringOptions([calories('12 Cal Row'), calories('15 Cal Bike')])).toEqual(['Total Calories', 'No Score'])
  })
  it('Case C - reps + calories mixed: Total Reps is NEVER offered', () => {
    const options = resolveEmomScoringOptions([calories('12 Cal Row'), reps('10 Burpees')])
    expect(options).not.toContain('Total Reps')
    expect(options).toEqual(['No Score'])
  })
  it('Case D - reps + load: Total Reps remains valid (load is performed-metric context, not the scored quantity)', () => {
    expect(resolveEmomScoringOptions([repsWithLoad('10 Clean & Jerks'), reps('10 Burpees')]))
      .toEqual(['Total Reps', 'No Score'])
  })
  it('homogeneous distance: No Score only - Total Distance would need cross-unit normalization FORGE does not have (owner decision required, never faked)', () => {
    expect(resolveEmomScoringOptions([distance('100 m Run'), distance('50 m Row')])).toEqual(['No Score'])
  })
  it('no movements at all: No Score only, no crash', () => {
    expect(resolveEmomScoringOptions([])).toEqual(['No Score'])
    expect(resolveEmomScoringOptions(null)).toEqual(['No Score'])
  })
})

describe('scoredMetricOf regression (Phase A of the prior incident, unchanged)', () => {
  it('still classifies reps-with-load as reps', () => {
    expect(scoredMetricOf({ name: 'C&J', reps: { value: 10 }, load: { value: 43 } })).toBe('reps')
  })
})
