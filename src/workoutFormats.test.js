import { describe, it, expect } from 'vitest'
import {
  WORKOUT_FORMATS, FORMAT_IDS, getFormat, legacyHeaderTypeOf,
  composePartialText, parsePartialText, composeAmrapResult, parseAmrapResult,
  composeFormatHeader, parseFormatHeader,
  normalizeSetsRows, addSetRow, updateSetRow, removeSetRow,
  defaultRowsForFormat, computeSetsPrCandidates,
} from './workoutFormats'

describe('getFormat', () => {
  it('întoarce definiția pentru un id cunoscut', () => {
    expect(getFormat('EMOM').family).toBe('sets')
  })
  it('cade pe For Time pentru un id necunoscut (nu crapă niciodată)', () => {
    expect(getFormat('Ceva Inexistent')).toBe(WORKOUT_FORMATS['For Time'])
  })
})

describe('legacyHeaderTypeOf', () => {
  it('detectează tipul dintr-un header text vechi', () => {
    expect(legacyHeaderTypeOf('AMRAP 12:00')).toBe('AMRAP')
    expect(legacyHeaderTypeOf('For Time · 20:00 — "Fran"')).toBe('For Time')
  })
  it('preferă cel mai lung id care se potrivește (Build to Heavy/1RM nu e confundat)', () => {
    expect(legacyHeaderTypeOf('Build to Heavy/1RM')).toBe('Build to Heavy/1RM')
  })
  it('întoarce null pentru text care nu începe cu niciun format cunoscut', () => {
    expect(legacyHeaderTypeOf('ceva complet liber')).toBe(null)
  })
})

describe('composePartialText / parsePartialText', () => {
  const movements = ['Pull-ups', 'Push-ups']
  it('compune și reparsează un rezultat parțial simetric', () => {
    const text = composePartialText(['5', '10'], movements)
    expect(text).toBe('5 Pull-ups, 10 Push-ups')
    expect(parsePartialText(text, movements)).toEqual(['5', '10'])
  })
  it('ignoră mișcările fără reps parțiale', () => {
    expect(composePartialText(['', '10'], movements)).toBe('10 Push-ups')
  })
})

describe('composeAmrapResult / parseAmrapResult', () => {
  const movements = ['Pull-ups', 'Push-ups']
  it('runde complete, fără parțial', () => {
    expect(composeAmrapResult('3', ['', ''], movements)).toBe('3 runde complete')
  })
  it('runde + parțial, round-trip', () => {
    const result = composeAmrapResult('3', ['5', ''], movements)
    expect(result).toBe('3 runde + 5 Pull-ups')
    expect(parseAmrapResult(result, movements)).toEqual({ rounds: '3', partialArr: ['5', ''] })
  })
  it('string gol dacă nu sunt runde completate', () => {
    expect(composeAmrapResult('', ['', ''], movements)).toBe('')
  })
})

describe('composeFormatHeader / parseFormatHeader', () => {
  it('round-trip cu durată', () => {
    const header = composeFormatHeader('EMOM', '12', '30')
    expect(header).toBe('EMOM 12:30')
    expect(parseFormatHeader(header)).toEqual({ tip: 'EMOM', min: '12', sec: '30' })
  })
  it('fără durată nu adaugă spațiu gol', () => {
    expect(composeFormatHeader('Chipper', '', '')).toBe('Chipper')
  })
  it('fallback For Time pentru header necunoscut, nu AMRAP', () => {
    expect(parseFormatHeader('ceva liber fara tip').tip).toBe('For Time')
  })
})

describe('normalizeSetsRows', () => {
  it('migrează formatul vechi (array de string-uri = doar greutate)', () => {
    expect(normalizeSetsRows({ Squat: ['40', '50'] })).toEqual({
      Squat: [{ weight: '40', reps: '' }, { weight: '50', reps: '' }],
    })
  })
  it('lasă neschimbat formatul nou', () => {
    const sets = { 'Min 1': [{ weight: '20', reps: '10', completed: true }] }
    expect(normalizeSetsRows(sets)).toEqual(sets)
  })
})

describe('addSetRow / updateSetRow / removeSetRow', () => {
  it('adaugă, editează și șterge un rând fără să mute obiectul original', () => {
    const empty = {}
    const withRow = addSetRow(empty, 'Min 1')
    expect(empty).toEqual({})
    expect(withRow['Min 1']).toHaveLength(1)

    const updated = updateSetRow(withRow, 'Min 1', 0, 'reps', '12')
    expect(updated['Min 1'][0].reps).toBe('12')
    expect(withRow['Min 1'][0].reps).toBe('')

    const removed = removeSetRow(updated, 'Min 1', 0)
    expect(removed['Min 1']).toHaveLength(0)
  })
})

describe('defaultRowsForFormat', () => {
  it('EMOM generează un rând per interval, cu exercițiu rotativ dacă e definit', () => {
    const rows = defaultRowsForFormat('EMOM', { totalRounds: 4, intervals: ['Row', 'Wall Ball'] }, [])
    expect(Object.keys(rows)).toEqual(['Min 1 · Row', 'Min 2 · Wall Ball', 'Min 3 · Row', 'Min 4 · Wall Ball'])
  })
  it('Tabata generează 8 runde implicit', () => {
    const rows = defaultRowsForFormat('Tabata', {}, [])
    expect(Object.keys(rows)).toHaveLength(8)
  })
  it('Strength Sets generează N seturi per mișcare', () => {
    const rows = defaultRowsForFormat('Strength Sets', { targetSets: 3 }, ['Back Squat'])
    expect(rows['Back Squat']).toHaveLength(3)
  })
  it('formatele scored nu au rânduri', () => {
    expect(defaultRowsForFormat('AMRAP', {}, [])).toEqual({})
  })
})

describe('computeSetsPrCandidates', () => {
  it('marchează un nou PR când greutatea depășește recordul existent la același nr. de reps', () => {
    const rows = { 'Min 1': [{ reps: '5', weight: '60' }] }
    const prDate = [{ movement: 'Back Squat', value: '55', unit: 'kg', reps: 5 }]
    const candidates = computeSetsPrCandidates('Back Squat', rows, 'kg', prDate)
    expect(candidates).toEqual([{ movement: 'Back Squat', reps: 5, weight: 60, unit: 'kg', isNewPr: true }])
  })
  it('nu marchează PR dacă greutatea e sub recordul existent', () => {
    const rows = { 'Min 1': [{ reps: '5', weight: '50' }] }
    const prDate = [{ movement: 'Back Squat', value: '55', unit: 'kg', reps: 5 }]
    expect(computeSetsPrCandidates('Back Squat', rows, 'kg', prDate)).toEqual([])
  })
  it('ignoră rânduri incomplete (fără reps sau fără greutate)', () => {
    const rows = { 'Min 1': [{ reps: '', weight: '60' }, { reps: '5', weight: '' }] }
    expect(computeSetsPrCandidates('Back Squat', rows, 'kg', [])).toEqual([])
  })
})
