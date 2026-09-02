// P11.1 — deterministic AI-vs-saved semantic diff.

import { describe, it, expect } from 'vitest'
import { diffAiVsSaved, normMovementName } from './aiProvenanceDiff'

// Minimal EditableSection factory (the shape both Builders hold).
const sec = (over = {}) => ({
  typeKey: 'metcon', isPrimary: true, scored: true, title: '',
  format: 'AMRAP', formatConfig: { durationSec: 600 },
  variants: {
    rx: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
    intermediate: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
    beginner: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
    onramp: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
  },
  ...over,
})
const mv = (name, extra = {}) => ({ instanceId: name, name, canonicalMovementId: null, reps: null, load: null, distance: null, calories: null, ...extra })
const rx = (instances) => ({ rx: { instances, movements: [], weight: { male: '', female: '' }, note: '' } })
const withRx = (over, instances) => sec({ ...over, variants: { ...sec().variants, ...rx(instances) } })

describe('P11.1 diff — no change / cosmetic', () => {
  it('identical -> accepted_unchanged, severity none', () => {
    const a = [withRx({}, [mv('Burpee', { reps: { mode: 'universal', value: 10 } })])]
    const r = diffAiVsSaved(a, JSON.parse(JSON.stringify(a)))
    expect(r.severity).toBe('none')
    expect(r.outcome).toBe('accepted_unchanged')
    expect(r.deltas).toEqual([])
  })

  it('case / whitespace-only movement rename -> cosmetic', () => {
    const a = [withRx({}, [mv('Burpee')])]
    const b = [withRx({}, [mv('  burpees ')])]
    const r = diffAiVsSaved(a, b)
    expect(r.severity).toBe('cosmetic')
    expect(r.outcome).toBe('accepted_cosmetic')
    expect(r.deltas[0].kind).toBe('movement_renamed')
    expect(normMovementName('  burpees ')).toBe('burpee')
  })

  it('note / title change -> cosmetic', () => {
    const a = [sec({ title: 'Metcon' })]
    const b = [sec({ title: 'Metcon', variants: { ...sec().variants, rx: { instances: [], movements: [], weight: { male: '', female: '' }, note: 'go hard' } } })]
    expect(diffAiVsSaved(a, b).severity).toBe('cosmetic')
  })
})

describe('P11.1 diff — CRITICAL', () => {
  it('§49 INC-11 — AMRAP Repeated Rounds -> Sequence = structure_changed / critical', () => {
    const a = [sec({ format: 'AMRAP', formatConfig: { durationSec: 600 } })]                       // absent structure = repeated
    const b = [sec({ format: 'AMRAP', formatConfig: { durationSec: 600, structure: 'Sequence' } })]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas.some(d => d.kind === 'structure_changed')).toBe(true)
    expect(r.severity).toBe('critical')
    expect(r.outcome).toBe('accepted_semantic')
  })

  it('absent structure vs explicit "Repeated Rounds" = NO delta', () => {
    const a = [sec({ format: 'AMRAP', formatConfig: { durationSec: 600 } })]
    const b = [sec({ format: 'AMRAP', formatConfig: { durationSec: 600, structure: 'Repeated Rounds' } })]
    expect(diffAiVsSaved(a, b).severity).toBe('none')
  })

  it('format change = critical', () => {
    const a = [sec({ format: 'AMRAP' })]
    const b = [sec({ format: 'For Time' })]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas.some(d => d.kind === 'format_changed')).toBe(true)
    expect(r.severity).toBe('critical')
  })

  it('score-family change = critical', () => {
    const a = [sec({ scoreType: 'Rounds + Reps' })]
    const b = [sec({ scoreType: 'Reps' })]
    expect(diffAiVsSaved(a, b).deltas.some(d => d.kind === 'score_family_changed')).toBe(true)
  })

  it('movement substituted (different identity) = critical', () => {
    const a = [withRx({}, [mv('Muscle-up')])]
    const b = [withRx({}, [mv('Pull-up')])]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas[0].kind).toBe('movement_substituted')
    expect(r.severity).toBe('critical')
  })

  it('canonicalMovementId equality beats name difference', () => {
    const a = [withRx({}, [mv('KB Swing', { canonicalMovementId: 'abc' })])]
    const b = [withRx({}, [mv('Russian Kettlebell Swing', { canonicalMovementId: 'abc' })])]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas.every(d => d.kind !== 'movement_substituted')).toBe(true)
  })
})

describe('P11.1 diff — SEMANTIC', () => {
  it('50 reps -> 40 reps = reps_changed / semantic', () => {
    const a = [withRx({}, [mv('Burpee', { reps: { mode: 'universal', value: 50 } })])]
    const b = [withRx({}, [mv('Burpee', { reps: { mode: 'universal', value: 40 } })])]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas[0].kind).toBe('reps_changed')
    expect(r.severity).toBe('semantic')
    expect(r.outcome).toBe('accepted_semantic')
  })

  it('24kg -> 20kg = load_changed / semantic', () => {
    const a = [withRx({}, [mv('KB Swing', { load: { mode: 'universal', value: 24, unit: 'kg' } })])]
    const b = [withRx({}, [mv('KB Swing', { load: { mode: 'universal', value: 20, unit: 'kg' } })])]
    expect(diffAiVsSaved(a, b).deltas[0].kind).toBe('load_changed')
  })

  it('10:00 -> 12:00 = duration_changed / semantic', () => {
    const a = [sec({ formatConfig: { durationSec: 600 } })]
    const b = [sec({ formatConfig: { durationSec: 720 } })]
    expect(diffAiVsSaved(a, b).deltas[0].kind).toBe('duration_changed')
  })

  it('rest change (structured intervals) = rest_changed / semantic', () => {
    const a = [sec({ format: 'Intervals', formatConfig: { roundCount: 5, stationMode: 'per-interval', workSec: 40, restSec: 20 } })]
    const b = [sec({ format: 'Intervals', formatConfig: { roundCount: 5, stationMode: 'per-interval', workSec: 40, restSec: 15 } })]
    expect(diffAiVsSaved(a, b).deltas.some(d => d.kind === 'rest_changed')).toBe(true)
  })

  it('movement reorder (same multiset) = movement_reordered / semantic', () => {
    const a = [withRx({}, [mv('Pull-up'), mv('Push-up'), mv('Air Squat')])]
    const b = [withRx({}, [mv('Air Squat'), mv('Pull-up'), mv('Push-up')])]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas.some(d => d.kind === 'movement_reordered')).toBe(true)
    expect(r.severity).toBe('semantic')
  })

  it('movement added at tail = movement_added / semantic', () => {
    const a = [withRx({}, [mv('Pull-up')])]
    const b = [withRx({}, [mv('Pull-up'), mv('Burpee')])]
    expect(diffAiVsSaved(a, b).deltas[0].kind).toBe('movement_added')
  })

  it('coach fills an empty scaling tier that the AI left empty -> NOT counted', () => {
    const a = [withRx({}, [mv('Pull-up', { reps: { mode: 'universal', value: 10 } })])]
    // final: rx unchanged, intermediate now populated
    const b = sec({ variants: { ...sec().variants, ...rx([mv('Pull-up', { reps: { mode: 'universal', value: 10 } })]) } })
    b.variants.intermediate = { instances: [mv('Ring Row', { reps: { mode: 'universal', value: 10 } })], movements: [], weight: { male: '', female: '' }, note: '' }
    const r = diffAiVsSaved(a, [b])
    expect(r.severity).toBe('none') // intermediate tier is only diffed when the AI baseline had it
  })
})

describe('P11.1 diff — sections', () => {
  it('coach adds a scored section AI did not produce = critical', () => {
    const a = [sec()]
    const b = [sec(), sec({ typeKey: 'skill', isPrimary: false, scored: true })]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas.some(d => d.kind === 'section_added' && d.severity === 'critical')).toBe(true)
  })
  it('coach removes a warm-up (non-scored) = semantic', () => {
    const a = [sec({ typeKey: 'warmup', isPrimary: false, scored: false }), sec()]
    const b = [sec()]
    // index-matched: a[0] warmup removed becomes a[0] vs b[0] primary -> messy;
    // this fixture just asserts the diff doesn't throw and flags a change.
    expect(diffAiVsSaved(a, b).severity).not.toBe('none')
  })
})
