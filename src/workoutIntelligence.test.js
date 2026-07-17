import { describe, it, expect } from 'vitest'
import { composeMovementLine, sectionFromAiSection, sectionsFromAiAnalysis, deriveReviewFlags, normalizeTitle } from './workoutIntelligence'

// Fixture-uri construite manual, CONSTRUITE STRICT dupa forma schemei
// Structured Outputs a edge function-ului (supabase/functions/analyze-workout/
// openaiSchema.ts - WORKOUT_ANALYSIS_JSON_SCHEMA) - toate campurile
// obligatorii prezente, aceleasi tipuri/enumuri. Nu sunt capturi reale (ar
// cere un apel OpenAI live) - validarea live (WI-1, pasul de validare)
// trebuie sa confirme cu cel putin un raspuns REAL ca aceste presupuneri de
// forma se tin.
const movement = (overrides = {}) => ({
  name: 'Thrusters', canonicalName: 'Thruster', reps: 21,
  weightMale: null, weightFemale: null, weightUnit: null,
  distanceValue: null, distanceUnit: null, calories: null,
  equipment: [], notes: null,
  ...overrides,
})

// transform.ts (toMovement) converteste weightMale/weightFemale/weightUnit
// aplatizate -> { male, female, unit } | null, si distanceValue/distanceUnit
// -> { value, unit } | null - reproducem aici forma DUPA transform, fiindca
// sectionsFromAiAnalysis primeste raspunsul deja trecut prin toWorkoutAnalysis.
function toMovementShape(m) {
  return {
    name: m.name, canonicalName: m.canonicalName, reps: m.reps,
    weight: m.weightMale != null ? { male: m.weightMale, female: m.weightFemale, unit: m.weightUnit || 'kg' } : null,
    distance: m.distanceValue != null ? { value: m.distanceValue, unit: m.distanceUnit || 'm' } : null,
    calories: m.calories, equipment: m.equipment, notes: m.notes,
  }
}

const section = (overrides = {}) => ({
  type: 'metcon', title: null, description: null, order: 0,
  format: 'AMRAP', formatConfig: { timeCapMinutes: 20, rounds: null, intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null },
  movements: [toMovementShape(movement())],
  equipment: [],
  scalingVersions: [],
  loggingMode: 'required', scoreType: 'Rounds + Reps', durationMinutes: 20,
  benchmarkMetadata: { name: null, isBenchmark: false, isHero: false },
  metadata: { difficulty: null, primaryEnergySystem: null, secondaryEnergySystem: null, dominantMovementPatterns: [], muscleGroups: [], priorityMuscles: [], mobilityFocus: [], tags: [], stimulus: null, coachNotes: [], commonFaults: [], coachingCues: [], tips: [], safetyNotes: [] },
  ...overrides,
})

const analysis = (sections) => ({ title: null, sections })

describe('composeMovementLine', () => {
  it('composes reps + name + weight', () => {
    expect(composeMovementLine(toMovementShape(movement({ weightMale: 43, weightFemale: 43, weightUnit: 'kg' })))).toBe('21 Thrusters @ 43kg')
  })
  it('does not duplicate reps already present in the name', () => {
    const m = toMovementShape(movement({ name: '15 Power Snatches', reps: 15, weightMale: null }))
    expect(composeMovementLine(m)).toBe('15 Power Snatches')
  })
  it('shows male/female weight only when they differ', () => {
    const same = toMovementShape(movement({ weightMale: 43, weightFemale: 43, weightUnit: 'kg' }))
    const diff = toMovementShape(movement({ weightMale: 61, weightFemale: 43, weightUnit: 'kg' }))
    expect(composeMovementLine(same)).toContain('@ 43kg')
    expect(composeMovementLine(same)).not.toContain('/')
    expect(composeMovementLine(diff)).toContain('@ 61/43kg')
  })
  it('includes distance and calories', () => {
    const m = toMovementShape(movement({ name: 'Row', canonicalName: 'Row', reps: null, distanceValue: 500, distanceUnit: 'm' }))
    expect(composeMovementLine(m)).toBe('Row 500m')
  })
  it('appends notes in parentheses', () => {
    const m = toMovementShape(movement({ notes: 'scale to band' }))
    expect(composeMovementLine(m)).toContain('(scale to band)')
  })

  // Gasit live (WI-1 validare): modelul pune uneori continutul deja compus
  // direct in `name` ("400m run", "Thrusters @ 43/30kg") SI separat in
  // campurile structurate - fara verificare, distanta/greutatea apareau de
  // doua ori ("400m run 400m", "Thrusters @ 43/30kg @ 43/30kg").
  it('does not duplicate distance already present in the name', () => {
    const m = toMovementShape(movement({ name: '400m run', canonicalName: 'Run', reps: null, distanceValue: 400, distanceUnit: 'm' }))
    expect(composeMovementLine(m)).toBe('400m run')
  })
  it('does not duplicate weight already present in the name', () => {
    const m = toMovementShape(movement({ name: 'Thrusters @ 43/30kg', reps: 21, weightMale: 43, weightFemale: 30, weightUnit: 'kg' }))
    expect(composeMovementLine(m)).toBe('21 Thrusters @ 43/30kg')
  })
})

describe('normalizeTitle', () => {
  it('passes through a normal short title unchanged', () => {
    expect(normalizeTitle('Fran')).toBe('Fran')
    expect(normalizeTitle('AB Complex')).toBe('AB Complex')
  })

  it('returns empty for null/blank input', () => {
    expect(normalizeTitle(null)).toBe('')
    expect(normalizeTitle('   ')).toBe('')
  })

  // Gasit live (WI-1, explorare 07-17): un paste stil Instagram cu text
  // decorativ literat a fost preluat ca titlu neschimbat.
  it('collapses letter-spaced decorative text back into real words', () => {
    expect(normalizeTitle('F O R   T I M E')).toBe('FOR TIME')
  })

  it('does not touch a short title that happens to contain single-letter words', () => {
    // 2 single-letter tokens intr-un bloc - sub pragul de 3, nu se colapseaza
    expect(normalizeTitle('A B Complex')).toBe('A B Complex')
  })

  it('discards a title that is implausibly long', () => {
    const long = 'AMRAP 2: Max Deadlifts (100/70kg) STRAIGHT INTO... AMRAP 19: 4 Strict Pull-ups 8 Wall Balls (9/6kg) 12 Cal Row 16 Air Squats'
    expect(normalizeTitle(long)).toBe('')
  })

  // Gasit live (WI-1, explorare 07-17): modelul a intors ocazional titlul ca
  // un ecou aproape complet al descrierii sectiunii.
  it('discards a title that is just an echo of the section description', () => {
    const description = 'Three AMRAP stages performed straight into each other. No rest between stages.'
    const echoedTitle = 'Three AMRAP stages performed straight into each other.'
    expect(normalizeTitle(echoedTitle, description)).toBe('')
  })

  it('keeps a short title that is coincidentally a substring of the description', () => {
    const description = 'For time: 21-15-9 Thrusters and Pull-ups, the classic Fran rep scheme.'
    expect(normalizeTitle('Fran', description)).toBe('Fran')
  })
})

describe('sectionFromAiSection - primary section', () => {
  it('maps a simple AMRAP into the editor shape, RX movements as an array', () => {
    const s = sectionFromAiSection(section(), true)
    expect(s.isPrimary).toBe(true)
    expect(s.format).toBe('AMRAP')
    expect(s.formatConfig).toEqual({ durationSec: 1200 })
    expect(s.variants.rx.movements).toEqual(['21 Thrusters'])
    expect(Array.isArray(s.variants.rx.movements)).toBe(true)
  })

  it('picks the RX variant weight from the first weighted movement', () => {
    const s = sectionFromAiSection(section({ movements: [toMovementShape(movement({ weightMale: 43, weightFemale: 30, weightUnit: 'kg' }))] }), true)
    expect(s.variants.rx.weight).toEqual({ male: '43kg', female: '30kg' })
  })

  it('leaves weight blank when no movement carries one', () => {
    const s = sectionFromAiSection(section({ movements: [toMovementShape(movement({ weightMale: null }))] }), true)
    expect(s.variants.rx.weight).toEqual({ male: '', female: '' })
  })

  it('maps scalingVersions into the matching editor variant slots', () => {
    const s = sectionFromAiSection(section({
      scalingVersions: [
        { level: 'intermediate', movements: [toMovementShape(movement({ name: 'Thrusters', reps: 15 }))], timeCapMinutes: null, notes: 'lighter' },
        { level: 'on_ramp', movements: [toMovementShape(movement({ name: 'Air Squats', canonicalName: 'Air Squat', reps: 10 }))], timeCapMinutes: null, notes: null },
      ],
    }), true)
    expect(s.variants.intermediate.movements).toEqual(['15 Thrusters'])
    expect(s.variants.intermediate.note).toBe('lighter')
    expect(s.variants.onramp.movements).toEqual(['10 Air Squats'])
  })

  it('does not synthesize formatConfig fields the AI schema has no source for (Chained AMRAP)', () => {
    const s = sectionFromAiSection(section({ format: 'Chained AMRAP', formatConfig: { timeCapMinutes: 23, rounds: null, intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null } }), true)
    expect(s.format).toBe('Chained AMRAP')
    expect(s.formatConfig.stages).toBeUndefined()
  })

  it('falls back to a known default format when the AI format is unrecognized', () => {
    const s = sectionFromAiSection(section({ format: 'TotallyMadeUpFormat' }), true)
    expect(s.format).toBe('AMRAP')
  })

  it('uses the recognized benchmark name as the WOD name', () => {
    const s = sectionFromAiSection(section({ benchmarkMetadata: { name: 'Fran', isBenchmark: true, isHero: false } }), true)
    expect(s.name).toBe('Fran')
  })

  it('normalizes a decorative AI title before it reaches the editor', () => {
    const s = sectionFromAiSection(section({ title: 'F O R   T I M E' }), true)
    expect(s.title).toBe('FOR TIME')
  })

  it('drops a title that is just an echo of the description', () => {
    const s = sectionFromAiSection(section({
      title: 'Three AMRAP stages performed straight into each other.',
      description: 'Three AMRAP stages performed straight into each other. No rest between stages.',
    }), true)
    expect(s.title).toBe('')
  })
})

describe('sectionFromAiSection - non-primary section', () => {
  it('joins movements into a single newline-separated text block', () => {
    const s = sectionFromAiSection(section({
      type: 'skill', format: 'Weightlifting', loggingMode: 'optional',
      movements: [toMovementShape(movement({ name: 'Back Squats', canonicalName: 'Back Squat', reps: 5, weightMale: 60, weightFemale: 60, weightUnit: 'kg' }))],
    }), false)
    expect(s.isPrimary).toBe(false)
    expect(s.text).toBe('5 Back Squats @ 60kg')
    expect(s.movementName).toBe('Back Squats')
  })
})

describe('sectionsFromAiAnalysis', () => {
  it('maps a multi-section workout preserving order, exactly one primary', () => {
    const warmup = section({ type: 'warmup', format: null, loggingMode: 'none', movements: [toMovementShape(movement({ name: '400m run', canonicalName: null, reps: null }))] })
    const skill = section({ type: 'skill', format: 'Weightlifting', loggingMode: 'optional' })
    const metcon = section({ type: 'metcon', format: 'For Time', loggingMode: 'required' })
    const sections = sectionsFromAiAnalysis(analysis([warmup, skill, metcon]))
    expect(sections).toHaveLength(3)
    expect(sections.filter(s => s.isPrimary)).toHaveLength(1)
    expect(sections[2].isPrimary).toBe(true)
  })

  it('guarantees exactly one primary even when the AI marks none as required', () => {
    const a = section({ loggingMode: 'optional' })
    const b = section({ loggingMode: 'none', format: null })
    const sections = sectionsFromAiAnalysis(analysis([a, b]))
    expect(sections.filter(s => s.isPrimary)).toHaveLength(1)
    // a has a format, b doesn't - the fallback should prefer a
    expect(sections[0].isPrimary).toBe(true)
  })

  it('returns an empty list for an empty analysis', () => {
    expect(sectionsFromAiAnalysis(analysis([]))).toEqual([])
    expect(sectionsFromAiAnalysis(null)).toEqual([])
  })

  // Gasit live (WI-1 validare): modelul a marcat AMBELE "Skill" (Back Squat,
  // Strength Sets) SI "Metcon" (For Time) drept loggingMode 'required' pt
  // un WOD real cu Warm-up+Skill+Metcon - prima varianta a tie-break-ului
  // alegea Skill (gresit, munca pregatitoare) in loc de Metcon (WOD-ul
  // zilei real). Structura reala de clasa (warmup -> strength/skill ->
  // metcon) face din ULTIMA sectiune 'required' alegerea corecta.
  it('prefers the LAST required section as primary when the AI marks more than one (real class structure: metcon comes last)', () => {
    const warmup = section({ type: 'warmup', format: null, loggingMode: 'none' })
    const skill = section({ type: 'skill', format: 'Strength Sets', loggingMode: 'required' })
    const metcon = section({ type: 'metcon', format: 'For Time', loggingMode: 'required' })
    const sections = sectionsFromAiAnalysis(analysis([warmup, skill, metcon]))
    expect(sections.filter(s => s.isPrimary)).toHaveLength(1)
    expect(sections[2].isPrimary).toBe(true)
    expect(sections[1].isPrimary).toBe(false)
  })
})

describe('deriveReviewFlags (WI-1: 6 fixed reasons, no confidence scoring)', () => {
  it('flags an unresolved movement (canonicalName null)', () => {
    const s = section({ movements: [toMovementShape(movement({ name: 'Some Weird Move', canonicalName: null }))] })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'unknown_movement' && f.detail === 'Some Weird Move')).toBe(true)
  })

  it('flags a cardio movement missing both distance and calories', () => {
    const s = section({ movements: [toMovementShape(movement({ name: 'Row', canonicalName: 'Row', reps: null }))] })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'missing_distance' && f.detail === 'Row')).toBe(true)
  })

  it('does not flag missing distance when calories are present instead', () => {
    const s = section({ movements: [toMovementShape(movement({ name: 'Row', canonicalName: 'Row', reps: null, calories: 20 }))] })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'missing_distance')).toBe(false)
  })

  it('flags an unrecognized format', () => {
    const s = section({ format: 'NotARealFormat' })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'ambiguous_format')).toBe(true)
  })

  it('flags a null format', () => {
    const s = section({ format: null })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'ambiguous_format')).toBe(true)
  })

  it('flags a weight-scored section with no weighted movement', () => {
    const s = section({ format: 'Weightlifting', scoreType: 'Weight', movements: [toMovementShape(movement({ weightMale: null }))] })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'missing_weight')).toBe(true)
  })

  it('does not flag missing weight for a bodyweight section with no weight-relevant scoreType', () => {
    const s = section({ format: 'For Time', scoreType: 'Time', movements: [toMovementShape(movement({ weightMale: null }))] })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'missing_weight')).toBe(false)
  })

  it('flags an unresolved benchmark (isBenchmark true, name null)', () => {
    const s = section({ benchmarkMetadata: { name: null, isBenchmark: true, isHero: false } })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'unresolved_benchmark')).toBe(true)
  })

  it('does not flag a resolved benchmark', () => {
    const s = section({ benchmarkMetadata: { name: 'Fran', isBenchmark: true, isHero: false } })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'unresolved_benchmark')).toBe(false)
  })

  it('flags a format with required config fields the AI schema cannot supply (Chained AMRAP -> stages)', () => {
    const s = section({ format: 'Chained AMRAP', formatConfig: { timeCapMinutes: 23, rounds: null, intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null } })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'needs_review' && f.detail.includes('stages'))).toBe(true)
  })

  it('does not flag a fully-covered format (AMRAP with an explicit time cap)', () => {
    const s = section({ format: 'AMRAP', formatConfig: { timeCapMinutes: 20, rounds: null, intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null } })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.filter(f => f.sectionIndex === 0 && f.reason === 'needs_review')).toHaveLength(0)
  })

  it('does not flag a required field that has a sane catalog default (Tabata scoringMode)', () => {
    const s = section({ format: 'Tabata', scoreType: 'Reps', formatConfig: { timeCapMinutes: null, rounds: 8, intervalSeconds: null, workSeconds: 20, restSeconds: 10, startReps: null, incrementReps: null } })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'needs_review' && f.detail?.includes('scoringMode'))).toBe(false)
  })

  it('flags an unmapped scaling level (e.g. "masters", no slot in the editor)', () => {
    const s = section({ scalingVersions: [{ level: 'masters', movements: [], timeCapMinutes: null, notes: null }] })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.reason === 'needs_review' && f.detail.includes('masters'))).toBe(true)
  })

  it('flags when the primary section had to be chosen by fallback (no explicit required section)', () => {
    const s = section({ loggingMode: 'optional' })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.sectionIndex === 0 && f.reason === 'needs_review' && f.detail.includes('fallback'))).toBe(true)
  })

  it('does not flag the primary section when the AI explicitly marked it required', () => {
    const s = section({ loggingMode: 'required' })
    const flags = deriveReviewFlags(analysis([s]))
    expect(flags.some(f => f.detail?.includes('fallback'))).toBe(false)
  })
})
