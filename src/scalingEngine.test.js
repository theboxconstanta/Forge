import { describe, it, expect } from 'vitest'
import { scaleMovementLine, generateVariantsFromRx, adjustFormatConfigForTier, buildScalingOverrides, TIER_RULES } from './scalingEngine'

describe('scaleMovementLine', () => {
  it('reduces a rep scheme by the tier volume percentage, preserving the dash-separated shape', () => {
    expect(scaleMovementLine('21-15-9 Deadlifts @ 102/70kg', 'intermediate')).toBe('19-14-8 Deadlifts @ 82/56kg')
    expect(scaleMovementLine('21-15-9 Deadlifts @ 102/70kg', 'beginner')).toBe('17-12-7 Deadlifts @ 61/42kg')
  })

  it('falls back to the tier default load ratio for a movement with no substitution entry', () => {
    expect(scaleMovementLine('10 Deadlifts @ 100kg', 'intermediate')).toBe('9 Deadlifts @ 80kg')
    expect(scaleMovementLine('10 Deadlifts @ 100kg', 'beginner')).toBe('8 Deadlifts @ 60kg')
  })

  it('applies a fixed-load substitution with an implement prefix (onramp Deadlift)', () => {
    expect(scaleMovementLine('21-15-9 Deadlifts @ 102/70kg', 'onramp')).toBe('14-10-6 Kettlebell Deadlifts @ 16/12kg')
  })

  it('applies a bodyweight substitution, dropping any RX weight entirely', () => {
    expect(scaleMovementLine('21-15-9 Pull-ups', 'intermediate')).toBe('19-14-8 Jumping Pull-ups')
    expect(scaleMovementLine('21-15-9 Pull-ups', 'beginner')).toBe('17-12-7 Ring Rows')
    expect(scaleMovementLine('21-15-9 Pull-ups', 'onramp')).toBe('14-10-6 Ring Rows')
  })

  it('shows a single weight value (no slash) when male and female scale to the same number', () => {
    expect(scaleMovementLine('10 Thrusters @ 43kg', 'intermediate')).toBe('9 Thrusters @ 34kg')
  })

  it('produces no weight suffix for a bodyweight RX line with no substitution entry (reps still scale)', () => {
    expect(scaleMovementLine('20 Burpees', 'intermediate')).toBe('18 Burpees')
  })

  it('never crashes on a line with no leading rep count', () => {
    expect(scaleMovementLine('- No rest between rounds', 'beginner')).toBe('- No rest between rounds')
    expect(scaleMovementLine('Rest 1:00', 'onramp')).toBe('Rest 1:00')
  })

  it('returns empty string for empty/whitespace-only input', () => {
    expect(scaleMovementLine('', 'intermediate')).toBe('')
    expect(scaleMovementLine('   ', 'intermediate')).toBe('')
  })

  it("lets a caller-supplied override take precedence over the static table", () => {
    const overrides = { Deadlift: { intermediate: { loadStrategy: 'fixed', fixedLoad: { male: 40, female: 30, unit: 'kg' } } } }
    expect(scaleMovementLine('10 Deadlifts @ 100kg', 'intermediate', overrides)).toBe('9 Deadlifts @ 40/30kg')
    expect(scaleMovementLine('10 Deadlifts @ 100kg', 'beginner', overrides)).toBe('8 Deadlifts @ 60kg')
  })

  it('matches plural movement names against a singular substitution-table key', () => {
    expect(scaleMovementLine('5 Muscle-ups', 'onramp')).toBe('3 Ring Rows')
  })
})

describe('adjustFormatConfigForTier', () => {
  it('increases a time-cap-bearing config value by the tier percentage', () => {
    expect(adjustFormatConfigForTier('For Time', { timeCapSec: 600 }, 'intermediate')).toEqual({ timeCapSec: 690 })
    expect(adjustFormatConfigForTier('For Time', { timeCapSec: 600 }, 'beginner')).toEqual({ timeCapSec: 780 })
    expect(adjustFormatConfigForTier('For Time', { timeCapSec: 600 }, 'onramp')).toEqual({ timeCapSec: 900 })
  })

  it('is a no-op for a format/config with no duration-like key', () => {
    expect(adjustFormatConfigForTier('Weightlifting', {}, 'beginner')).toEqual({})
    expect(adjustFormatConfigForTier('Complex', { rounds: 5 }, 'onramp')).toEqual({ rounds: 5 })
  })
})

describe('generateVariantsFromRx', () => {
  const rx = {
    movements: ['21-15-9 Deadlifts @ 102/70kg', '21-15-9 Pull-ups'],
    weight: { male: '', female: '' },
    note: 'RX note',
    format: 'For Time',
    formatConfig: { timeCapSec: 600 },
  }

  it('generates all three tiers matching the worked example exactly', () => {
    const result = generateVariantsFromRx(rx)
    expect(result.intermediate.movements).toEqual(['19-14-8 Deadlifts @ 82/56kg', '19-14-8 Jumping Pull-ups'])
    expect(result.beginner.movements).toEqual(['17-12-7 Deadlifts @ 61/42kg', '17-12-7 Ring Rows'])
    expect(result.onramp.movements).toEqual(['14-10-6 Kettlebell Deadlifts @ 16/12kg', '14-10-6 Ring Rows'])
    expect(result.intermediate.formatConfig).toEqual({ timeCapSec: 690 })
    expect(result.beginner.formatConfig).toEqual({ timeCapSec: 780 })
    expect(result.onramp.formatConfig).toEqual({ timeCapSec: 900 })
  })

  it('scales the top-level weight fields by the tier default load ratio', () => {
    const rxWithWeight = { ...rx, weight: { male: '100kg', female: '70kg' } }
    const result = generateVariantsFromRx(rxWithWeight)
    expect(result.intermediate.weight).toEqual({ male: '80kg', female: '56kg' })
    expect(result.beginner.weight).toEqual({ male: '60kg', female: '42kg' })
  })

  it('returns empty movements/weight for an RX section with nothing in it', () => {
    const empty = { movements: [], weight: { male: '', female: '' }, note: '', format: 'AMRAP', formatConfig: {} }
    const result = generateVariantsFromRx(empty)
    for (const tier of ['intermediate', 'beginner', 'onramp']) {
      expect(result[tier].movements).toEqual([])
      expect(result[tier].weight).toEqual({ male: '', female: '' })
    }
  })

  it('never mutates the input RX section', () => {
    const snapshot = JSON.parse(JSON.stringify(rx))
    generateVariantsFromRx(rx)
    expect(rx).toEqual(snapshot)
  })
})

describe('TIER_RULES', () => {
  it('is monotonically harder to easier: onramp reduces volume/load the most and extends time the most', () => {
    expect(TIER_RULES.onramp.volumeReductionPct).toBeGreaterThan(TIER_RULES.beginner.volumeReductionPct)
    expect(TIER_RULES.beginner.volumeReductionPct).toBeGreaterThan(TIER_RULES.intermediate.volumeReductionPct)
    expect(TIER_RULES.onramp.defaultLoadRatio).toBeLessThan(TIER_RULES.beginner.defaultLoadRatio)
    expect(TIER_RULES.beginner.defaultLoadRatio).toBeLessThan(TIER_RULES.intermediate.defaultLoadRatio)
  })
})

describe('buildScalingOverrides', () => {
  it('includes only movements with a default_substitutions entry', () => {
    const overrides = buildScalingOverrides([
      { name: 'Bulgarian Bag Swing', default_substitutions: { onramp: { loadStrategy: 'bodyweight' } } },
      { name: 'Sandbag Bear Hug Carry', default_substitutions: null },
    ])
    expect(Object.keys(overrides)).toEqual(['Bulgarian Bag Swing'])
  })

  it('returns an empty table for an empty or missing list', () => {
    expect(buildScalingOverrides([])).toEqual({})
    expect(buildScalingOverrides(undefined)).toEqual({})
  })

  it('a DB override for a movement already in SCALING_SUBSTITUTIONS takes precedence over the static entry', () => {
    const overrides = buildScalingOverrides([
      { name: 'Deadlift', default_substitutions: { onramp: { loadStrategy: 'bodyweight', substituteName: 'Good Mornings' } } },
    ])
    expect(scaleMovementLine('10 Deadlifts @ 100kg', 'onramp', overrides)).toBe('7 Good Mornings')
  })
})
