import { describe, it, expect } from 'vitest'
import {
  resolveAthleteGenderKey,
  parseWeightStandardFromText,
  resolveSectionStandardKg,
  isMultiMovementStandard,
  classifyRxStatus,
  resolveMovementDisplayText,
} from './rxEngine'

describe('resolveAthleteGenderKey', () => {
  it('maps live Romanian values correctly', () => {
    expect(resolveAthleteGenderKey('masculin')).toBe('male')
    expect(resolveAthleteGenderKey('feminin')).toBe('female')
  })
  it('never silently defaults an unknown/unset gender to male', () => {
    expect(resolveAthleteGenderKey(null)).toBe(null)
    expect(resolveAthleteGenderKey(undefined)).toBe(null)
    expect(resolveAthleteGenderKey('')).toBe(null)
    expect(resolveAthleteGenderKey('other')).toBe(null)
  })
})

describe('parseWeightStandardFromText - slash notation', () => {
  it('parses plain slash kg as female/male default order', () => {
    expect(parseWeightStandardFromText('7 Shoulder-to-Overhead @ 38/61kg')).toEqual({ femaleKg: 38, maleKg: 61 })
  })
  it('parses slash lb, converting to kg (convertWeight rounds to the nearest 0.5kg, its own existing convention)', () => {
    const r = parseWeightStandardFromText('Deadlift @ 35/50lb')
    expect(r.femaleKg).toBe(16)
    expect(r.maleKg).toBe(22.5)
  })
  it('parses slash lbs (with s) the same as lb', () => {
    const r = parseWeightStandardFromText('Deadlift @ 35/50lbs')
    expect(r.femaleKg).toBe(16)
  })
  it('parses spaced slash "20/30 kg"', () => {
    expect(parseWeightStandardFromText('Front Squat 20/30 kg')).toEqual({ femaleKg: 20, maleKg: 30 })
  })
  it('applies the same default order regardless of which number is larger ("reverse" 61/38kg)', () => {
    expect(parseWeightStandardFromText('Snatch @ 61/38kg')).toEqual({ femaleKg: 61, maleKg: 38 })
  })
})

describe('parseWeightStandardFromText - labeled notation', () => {
  it('parses "61kg (M) / 38kg (F)"', () => {
    expect(parseWeightStandardFromText('61kg (M) / 38kg (F)')).toEqual({ maleKg: 61, femaleKg: 38 })
  })
  it('parses "38kg (F), 61kg (M)" (order reversed)', () => {
    expect(parseWeightStandardFromText('38kg (F), 61kg (M)')).toEqual({ maleKg: 61, femaleKg: 38 })
  })
  it('parses "Men 61kg, Women 38kg"', () => {
    expect(parseWeightStandardFromText('Men 61kg, Women 38kg')).toEqual({ maleKg: 61, femaleKg: 38 })
  })
  it('parses "Male 61kg, Female 38kg"', () => {
    expect(parseWeightStandardFromText('Male 61kg, Female 38kg')).toEqual({ maleKg: 61, femaleKg: 38 })
  })
})

describe('parseWeightStandardFromText - symbol notation', () => {
  it('parses "♂61 / ♀38" defaulting to kg with no unit token', () => {
    expect(parseWeightStandardFromText('♂61 / ♀38')).toEqual({ maleKg: 61, femaleKg: 38 })
  })
  it('parses "♀38 / ♂61" (order reversed)', () => {
    expect(parseWeightStandardFromText('♀38 / ♂61')).toEqual({ maleKg: 61, femaleKg: 38 })
  })
})

describe('parseWeightStandardFromText - false-positive guards', () => {
  it('does not treat box-jump height (cm) as a weight', () => {
    expect(parseWeightStandardFromText('3 burpee box jump-overs (51/61 cm)')).toBe(null)
  })
  it('does not treat a calorie target as a weight', () => {
    expect(parseWeightStandardFromText('25/30-cal row')).toBe(null)
    expect(parseWeightStandardFromText('25 calories (men) / 30 calories (women)')).toBe(null)
  })
  it('returns null for movement text with no weight at all', () => {
    expect(parseWeightStandardFromText('25 Pull-ups')).toBe(null)
  })
  it('returns null for non-string/empty input', () => {
    expect(parseWeightStandardFromText(null)).toBe(null)
    expect(parseWeightStandardFromText('')).toBe(null)
  })
})

describe('resolveSectionStandardKg', () => {
  it('resolves from a single weighted movement (male)', () => {
    const kg = resolveSectionStandardKg({
      movements: ['10 Pull-ups', '7 Shoulder-to-Overhead @ 38/61kg'],
      legacyWeightText: null,
      genderKey: 'male',
    })
    expect(kg).toBe(61)
  })
  it('resolves from a single weighted movement (female)', () => {
    const kg = resolveSectionStandardKg({
      movements: ['10 Pull-ups', '7 Shoulder-to-Overhead @ 38/61kg'],
      legacyWeightText: null,
      genderKey: 'female',
    })
    expect(kg).toBe(38)
  })
  it('falls back to the legacy tier-level text when no movement carries a parseable weight', () => {
    const kg = resolveSectionStandardKg({
      movements: ['21-15-9', 'Thrusters', 'Pull-ups'],
      legacyWeightText: '61kg',
      genderKey: 'male',
    })
    expect(kg).toBe(61)
  })
  it('returns null when no standard exists anywhere (never forces Not Rx)', () => {
    const kg = resolveSectionStandardKg({
      movements: ['Build to a heavy snatch'],
      legacyWeightText: null,
      genderKey: 'male',
    })
    expect(kg).toBe(null)
  })
  it('returns null when gender is unknown, even if a standard is parseable', () => {
    const kg = resolveSectionStandardKg({
      movements: ['Thruster @ 38/61kg'],
      legacyWeightText: null,
      genderKey: null,
    })
    expect(kg).toBe(null)
  })
  it('flags multiple distinct weighted movements as unresolvable to a single standard', () => {
    const kg = resolveSectionStandardKg({
      movements: ['Thruster @ 43/61kg', 'Deadlift @ 70/100kg'],
      legacyWeightText: null,
      genderKey: 'male',
    })
    expect(isMultiMovementStandard(kg)).toBe(true)
  })
  it('does NOT flag multiple movements as multi when they resolve to the same standard', () => {
    const kg = resolveSectionStandardKg({
      movements: ['Thruster @ 38/61kg', 'Push Press @ 38/61kg'],
      legacyWeightText: null,
      genderKey: 'male',
    })
    expect(kg).toBe(61)
  })
})

describe('classifyRxStatus', () => {
  it('matches the exact male worked example from the mission (standard 61kg)', () => {
    expect(classifyRxStatus({ enteredWeightText: '61', standardKg: 61, athleteUnit: 'kg' })).toBe('rx')
    expect(classifyRxStatus({ enteredWeightText: '62', standardKg: 61, athleteUnit: 'kg' })).toBe('rx')
    expect(classifyRxStatus({ enteredWeightText: '70', standardKg: 61, athleteUnit: 'kg' })).toBe('rx')
    expect(classifyRxStatus({ enteredWeightText: '60', standardKg: 61, athleteUnit: 'kg' })).toBe('not_rx')
    expect(classifyRxStatus({ enteredWeightText: '50', standardKg: 61, athleteUnit: 'kg' })).toBe('not_rx')
    expect(classifyRxStatus({ enteredWeightText: '38', standardKg: 61, athleteUnit: 'kg' })).toBe('not_rx')
  })
  it('matches the exact female worked example from the mission (standard 38kg)', () => {
    expect(classifyRxStatus({ enteredWeightText: '38', standardKg: 38, athleteUnit: 'kg' })).toBe('rx')
    expect(classifyRxStatus({ enteredWeightText: '40', standardKg: 38, athleteUnit: 'kg' })).toBe('rx')
    expect(classifyRxStatus({ enteredWeightText: '50', standardKg: 38, athleteUnit: 'kg' })).toBe('rx')
    expect(classifyRxStatus({ enteredWeightText: '37', standardKg: 38, athleteUnit: 'kg' })).toBe('not_rx')
    expect(classifyRxStatus({ enteredWeightText: '30', standardKg: 38, athleteUnit: 'kg' })).toBe('not_rx')
  })
  it('going heavier than RX still counts as RX (the actual reported bug this replaces)', () => {
    // Old behavior (weightMatches, exact string/numeric equality) would have
    // flagged this "Not RX'd" because 70 !== 61. The new >= rule fixes it.
    expect(classifyRxStatus({ enteredWeightText: '70kg', standardKg: 61, athleteUnit: 'kg' })).toBe('rx')
  })
  it('converts entered lb to kg before comparing against a kg standard', () => {
    // 61kg standard; 140lb ≈ 63.5kg, above standard -> RX.
    expect(classifyRxStatus({ enteredWeightText: '140', standardKg: 61, athleteUnit: 'lbs' })).toBe('rx')
    // 100lb ≈ 45.4kg, below 61kg standard -> Not RX.
    expect(classifyRxStatus({ enteredWeightText: '100', standardKg: 61, athleteUnit: 'lbs' })).toBe('not_rx')
  })
  it('returns null (no classification) when nothing is entered yet', () => {
    expect(classifyRxStatus({ enteredWeightText: '', standardKg: 61, athleteUnit: 'kg' })).toBe(null)
    expect(classifyRxStatus({ enteredWeightText: null, standardKg: 61, athleteUnit: 'kg' })).toBe(null)
  })
  it('returns null (never forces Not Rx) when there is no standard to compare against', () => {
    expect(classifyRxStatus({ enteredWeightText: '61', standardKg: null, athleteUnit: 'kg' })).toBe(null)
  })
  it('returns null for a multi-movement standard signal', () => {
    const multi = resolveSectionStandardKg({
      movements: ['Thruster @ 43/61kg', 'Deadlift @ 70/100kg'],
      legacyWeightText: null,
      genderKey: 'male',
    })
    expect(classifyRxStatus({ enteredWeightText: '61', standardKg: multi, athleteUnit: 'kg' })).toBe(null)
  })
})

describe('resolveMovementDisplayText', () => {
  it('shows only the male athlete\'s own weight', () => {
    expect(resolveMovementDisplayText('7 Shoulder-to-Overhead @ 38/61kg', 'male')).toBe('7 Shoulder-to-Overhead @ 61kg')
  })
  it('shows only the female athlete\'s own weight', () => {
    expect(resolveMovementDisplayText('7 Shoulder-to-Overhead @ 38/61kg', 'female')).toBe('7 Shoulder-to-Overhead @ 38kg')
  })
  it('leaves text unchanged when gender is unknown (graceful degrade to dual display)', () => {
    expect(resolveMovementDisplayText('7 Shoulder-to-Overhead @ 38/61kg', null)).toBe('7 Shoulder-to-Overhead @ 38/61kg')
  })
  it('leaves text unchanged when nothing parseable exists', () => {
    expect(resolveMovementDisplayText('25 Pull-ups', 'male')).toBe('25 Pull-ups')
  })
})
