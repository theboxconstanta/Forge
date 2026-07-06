import { describe, it, expect } from 'vitest'
import {
  WORKOUT_FORMATS, FORMAT_IDS, getFormat, legacyHeaderTypeOf,
  composePartialText, parsePartialText, composeAmrapResult, parseAmrapResult,
  composeFormatHeader, parseFormatHeader, estimateTotalDurationSec,
  normalizeSetsRows, addSetRow, updateSetRow, removeSetRow,
  defaultRowsForFormat, computeSetsPrCandidates, computeSetsScore,
  REP_SCHEME_QUICK_OPTIONS, describeFormatConfig, AUTO_DURATION_FORMAT_IDS,
} from './workoutFormats'
import { getT } from './translations'

describe('getFormat', () => {
  it('întoarce definiția pentru un id cunoscut', () => {
    expect(getFormat('EMOM').family).toBe('sets')
  })
  it('cade pe For Time pentru un id necunoscut (nu crapă niciodată)', () => {
    expect(getFormat('Ceva Inexistent')).toBe(WORKOUT_FORMATS['For Time'])
  })
  it('Ladder are scoreMode fortime_or_amrap, ca RFT - poate loga progres parțial dacă nu termină', () => {
    expect(getFormat('Ladder').scoreMode).toBe('fortime_or_amrap')
  })
  it('Intervals are simpleReps ca Tabata - o rundă e un singur număr de reps', () => {
    expect(getFormat('Intervals').simpleReps).toBe(true)
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
  it('nu dublează numărul cand miscarea are deja unul in text (scara descrescatoare) - arata facut/prescris', () => {
    const miscariScara = ['15 Power Snatches', '5 Rope Climbs']
    const text = composePartialText(['15', '3'], miscariScara)
    expect(text).toBe('15/15 Power Snatches, 3/5 Rope Climbs')
    expect(parsePartialText(text, miscariScara)).toEqual(['15', '3'])
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

describe('estimateTotalDurationSec', () => {
  it('AMRAP ia direct durationSec', () => {
    expect(estimateTotalDurationSec('AMRAP', { durationSec: 720 })).toBe(720)
  })
  it('EMOM înmulțește intervalul cu numărul de runde', () => {
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 10, intervalSec: 60 })).toBe(600)
  })
  it('Tabata înmulțește rundele cu lucru+odihnă', () => {
    expect(estimateTotalDurationSec('Tabata', { rounds: 8, workSec: 20, restSec: 10 })).toBe(240)
  })
  it('Death By nu are durată estimabilă (open-ended)', () => {
    expect(estimateTotalDurationSec('Death By', {})).toBe(null)
  })
  it('AMRAP with Buy-In ia durata totala (buy-in-ul consuma din ea)', () => {
    expect(estimateTotalDurationSec('AMRAP with Buy-In', { totalDurationSec: 1200 })).toBe(1200)
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
  it('Strength Sets generează un rând per intrare din setsScheme, cu targetReps purtat pe rând', () => {
    const rows = defaultRowsForFormat('Strength Sets', { setsScheme: [5, 3, 1] }, ['Back Squat'])
    expect(rows['Back Squat']).toHaveLength(3)
    expect(rows['Back Squat'].map(r => r.targetReps)).toEqual([5, 3, 1])
  })
  it('Weightlifting fără targetSets prescris pornește cu 0 rânduri (adăugate manual)', () => {
    const rows = defaultRowsForFormat('Weightlifting', {}, ['Back Squat'])
    expect(rows['Back Squat']).toHaveLength(0)
  })
  it('Death By Weight pornește cu 1 rând, ca Death By', () => {
    const rows = defaultRowsForFormat('Death By Weight', {}, [])
    expect(Object.keys(rows)).toEqual(['Min 1'])
  })
  it('Superset folosește config.movements (nu parametrul generic movements) pentru rândurile alternante', () => {
    const rows = defaultRowsForFormat('Superset', { movements: ['Pull-up', 'Push-up'], targetSets: 3 }, [])
    expect(Object.keys(rows)).toEqual(['Pull-up', 'Push-up'])
    expect(rows['Pull-up']).toHaveLength(3)
  })
  it('formatele scored nu au rânduri', () => {
    expect(defaultRowsForFormat('AMRAP', {}, [])).toEqual({})
  })
})

describe('computeSetsScore', () => {
  it('Total Reps însumează toate rândurile', () => {
    const rows = { 'Rundă 1': [{ reps: '10' }], 'Rundă 2': [{ reps: '8' }], 'Rundă 3': [{ reps: '12' }] }
    expect(computeSetsScore('Tabata', { scoringMode: 'Total Reps' }, rows)).toBe(30)
  })
  it('Lowest Reps ia minimul dintre rânduri', () => {
    const rows = { 'Rundă 1': [{ reps: '10' }], 'Rundă 2': [{ reps: '8' }], 'Rundă 3': [{ reps: '12' }] }
    expect(computeSetsScore('Tabata', { scoringMode: 'Lowest Reps' }, rows)).toBe(8)
  })
  it('întoarce null fără scoringMode sau fără rânduri completate', () => {
    expect(computeSetsScore('EMOM', {}, { 'Min 1': [{ reps: '5' }] })).toBe(null)
    expect(computeSetsScore('Tabata', { scoringMode: 'Total Reps' }, {})).toBe(null)
  })
})

describe('REP_SCHEME_QUICK_OPTIONS', () => {
  it('include schemele clasice și e atașat câmpului repsScheme al Ladder', () => {
    expect(REP_SCHEME_QUICK_OPTIONS).toContain('21-15-9')
    expect(WORKOUT_FORMATS['Ladder'].config.repsScheme.quickOptions).toBe(REP_SCHEME_QUICK_OPTIONS)
  })
})

describe('describeFormatConfig', () => {
  const tRo = getT('ro')

  it('RFT: rundele setate de admin apar în descriere (bug raportat - nu se vedeau nicăieri)', () => {
    expect(describeFormatConfig('RFT', { rounds: 5, timeCapSec: 1200 }, tRo)).toBe('Număr runde: 5 · Time cap (opțional): 20:00')
  })
  it('Ladder: tipul de ladder și schema de reps apar în descriere', () => {
    expect(describeFormatConfig('Ladder', { ladderType: 'Ascending', repsScheme: '21-15-9' }, tRo)).toContain('Ascending')
    expect(describeFormatConfig('Ladder', { ladderType: 'Ascending', repsScheme: '21-15-9' }, tRo)).toContain('21-15-9')
  })
  it('Partner WOD: split și format de bază apar', () => {
    const desc = describeFormatConfig('Partner WOD', { splitType: 'You go/I go', baseFormat: 'AMRAP' }, tRo)
    expect(desc).toContain('You go/I go')
    expect(desc).toContain('AMRAP')
  })
  it('EMOM: numărul de intervale, durata și exercițiile rotative apar', () => {
    const desc = describeFormatConfig('EMOM', { totalRounds: 12, intervalSec: 105, intervals: ['Row', 'Wall Ball'] }, tRo)
    expect(desc).toContain('12')
    expect(desc).toContain('1:45')
    expect(desc).toContain('Row, Wall Ball')
  })
  it('Tabata: rundele, lucru/odihnă și scoringMode apar', () => {
    const desc = describeFormatConfig('Tabata', { rounds: 8, workSec: 20, restSec: 10, scoringMode: 'Total Reps' }, tRo)
    expect(desc).toContain('8')
    expect(desc).toContain('Total Reps')
  })
  it('Death By Weight: greutatea de start și incrementul apar', () => {
    const desc = describeFormatConfig('Death By Weight', { startWeight: 40, incrementWeight: 5, intervalSec: 60 }, tRo)
    expect(desc).toContain('40')
    expect(desc).toContain('5')
  })
  it('Strength Sets: schema per set apare ca listă unită', () => {
    expect(describeFormatConfig('Strength Sets', { setsScheme: [5, 3, 1] }, tRo)).toContain('5-3-1')
  })
  it('Complex: mișcările și numărul de runde apar', () => {
    const desc = describeFormatConfig('Complex', { complexMovements: ['Clean', 'Front Squat', 'Jerk'], rounds: 3 }, tRo)
    expect(desc).toContain('Clean, Front Squat, Jerk')
    expect(desc).toContain('3')
  })
  it('Buy-In/Cash-Out: mișcările buy-in și cash-out apar', () => {
    const desc = describeFormatConfig('Buy-In/Cash-Out', { buyIn: ['Run 400m'], cashOut: ['Burpees'], mainFormat: 'AMRAP' }, tRo)
    expect(desc).toContain('Run 400m')
    expect(desc).toContain('Burpees')
  })
  it('AMRAP with Buy-In: durata totală și mișcările buy-in apar', () => {
    const desc = describeFormatConfig('AMRAP with Buy-In', { totalDurationSec: 1200, buyIn: ['Row 500m'] }, tRo)
    expect(desc).toContain('20:00')
    expect(desc).toContain('Row 500m')
  })
  it('câmpurile goale/nesetate sunt omise, nu apar ca "undefined"', () => {
    expect(describeFormatConfig('RFT', { rounds: 5 }, tRo)).toBe('Număr runde: 5')
    expect(describeFormatConfig('For Time', {}, tRo)).toBe('')
  })
  it('nu crapă pentru niciun format din catalog, cu orice config gol', () => {
    FORMAT_IDS.forEach(id => expect(() => describeFormatConfig(id, {}, tRo)).not.toThrow())
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
  it('cu movementKeyed=true, atribuie fiecare candidat cheii randului (miscarii reale), nu unui nume generic', () => {
    const rows = { 'Pull-up': [{ reps: '5', weight: '10' }], 'Push-up': [{ reps: '5', weight: '20' }] }
    const candidates = computeSetsPrCandidates('Superset Skill', rows, 'kg', [], true)
    expect(candidates).toEqual(expect.arrayContaining([
      { movement: 'Pull-up', reps: 5, weight: 10, unit: 'kg', isNewPr: true },
      { movement: 'Push-up', reps: 5, weight: 20, unit: 'kg', isNewPr: true },
    ]))
  })
  it('fara movementKeyed, chei tip eticheta ("Min 1") nu devin nume de miscare', () => {
    const rows = { 'Min 1': [{ reps: '5', weight: '60' }] }
    const candidates = computeSetsPrCandidates('Back Squat', rows, 'kg', [])
    expect(candidates).toEqual([{ movement: 'Back Squat', reps: 5, weight: 60, unit: 'kg', isNewPr: true }])
  })
})

describe('AUTO_DURATION_FORMAT_IDS', () => {
  it('conține EMOM, Tabata, Intervals - formate a căror durată totală e determinată de config', () => {
    expect(AUTO_DURATION_FORMAT_IDS).toEqual(['EMOM', 'Tabata', 'Intervals'])
  })
  it('Tabata/Intervals au valori implicite, deci se poate calcula durata chiar cu config gol', () => {
    expect(estimateTotalDurationSec('Tabata', {})).not.toBe(null)
    expect(estimateTotalDurationSec('Intervals', {})).not.toBe(null)
  })
  it('EMOM nu are un nr. implicit de intervale - fără totalRounds setat, durata nu poate fi calculată', () => {
    expect(estimateTotalDurationSec('EMOM', {})).toBe(null)
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 12, intervalSec: 60 })).toBe(720)
  })
})
