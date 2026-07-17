import { describe, it, expect } from 'vitest'
import {
  WORKOUT_FORMATS, FORMAT_IDS, getFormat, legacyHeaderTypeOf,
  composePartialText, parsePartialText, composeAmrapResult, parseAmrapResult,
  composeFormatHeader, parseFormatHeader, estimateTotalDurationSec,
  normalizeSetsRows, addSetRow, updateSetRow, removeSetRow,
  defaultRowsForFormat, computeSetsPrCandidates, computeSetsScore,
  REP_SCHEME_QUICK_OPTIONS, describeFormatConfig, AUTO_DURATION_FORMAT_IDS,
  isNotRxd, weightKeyForVariant, effectiveScoreMode,
  maxWeightFromSets, setsDisplayScore, isSequentialFormat,
  movementsChanged, isMixedCategory, composeFinishedRoundsText,
  composeStageResult, totalRepsChained, totalRepsAmrapStage,
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
  it('0 explicit (butonul de clear la For Time/Ladder) se pastreaza, nu e tratat ca "netouched"', () => {
    const miscariScara = ['15 Power Snatches', '5 Rope Climbs']
    const text = composePartialText(['0', '3'], miscariScara)
    expect(text).toBe('0/15 Power Snatches, 3/5 Rope Climbs')
    expect(parsePartialText(text, miscariScara)).toEqual(['0', '3'])
  })
})

describe('composeFinishedRoundsText', () => {
  it('compune "N runde complete" dintr-un numar de runde configurat', () => {
    expect(composeFinishedRoundsText(5)).toBe('5 runde complete')
    expect(composeFinishedRoundsText('5')).toBe('5 runde complete')
  })
  it('null cand nu exista un numar de runde valid (nu string gol)', () => {
    expect(composeFinishedRoundsText(undefined)).toBe(null)
    expect(composeFinishedRoundsText(null)).toBe(null)
    expect(composeFinishedRoundsText(0)).toBe(null)
    expect(composeFinishedRoundsText('')).toBe(null)
  })
})

describe('WOD-uri inlantuite (Chained AMRAP)', () => {
  it('totalRepsAmrapStage - runde complete x reps prescrise per runda + reps partiale', () => {
    const movements = ['4 Strict Pull-ups', '11 Box Jumps', '13 Hand Release Push-ups', '23 Cal Bike']
    // 3 runde complete (4+11+13+23=51 reps/runda) + 2 din Pull-ups in runda partiala
    expect(totalRepsAmrapStage('3', ['2', '', '', ''], movements)).toBe(3 * 51 + 2)
  })
  it('totalRepsAmrapStage - caz degenerat "max reps o singura miscare" (fara prefix numeric, fara runde)', () => {
    expect(totalRepsAmrapStage('', ['45'], ['Deadlifts'])).toBe(45)
  })
  it('composeStageResult kind amrap - text normal, cu runde', () => {
    const stage = { kind: 'amrap', movements: ['4 Strict Pull-ups', '11 Box Jumps', '13 Hand Release Push-ups', '23 Cal Bike'] }
    const { text, totalReps } = composeStageResult(stage, { roundsCompleted: '3', partialReps: ['2', '', '', ''] })
    expect(text).toBe('3 runde + 2/4 Strict Pull-ups')
    expect(totalReps).toBe(155)
  })
  it('composeStageResult kind amrap - caz degenerat "max reps o singura miscare" nu pierde reps-ul partial', () => {
    const stage = { kind: 'amrap', movements: ['Deadlifts'] }
    const { text, totalReps } = composeStageResult(stage, { roundsCompleted: '', partialReps: ['45'] })
    expect(text).toBe('45 Deadlifts')
    expect(totalReps).toBe(45)
  })
  it('composeStageResult kind interval - reutilizeaza computeSetsScore (Total Reps)', () => {
    const stage = { kind: 'interval', movements: [] }
    const { text, totalReps } = composeStageResult(stage, { sets: { 'Min 1': [{ reps: '10' }], 'Min 2': [{ reps: '8' }] } })
    expect(text).toBe('18 reps')
    expect(totalReps).toBe(18)
  })
  it('totalRepsChained - suma reps pe toate etapele (exemplul real: AMRAP 2 + AMRAP 19 + AMRAP 2)', () => {
    const stages = [
      { kind: 'amrap', movements: ['Deadlifts'] },
      { kind: 'amrap', movements: ['4 Strict Pull-ups', '11 Box Jumps', '13 Hand Release Push-ups', '23 Cal Bike'] },
      { kind: 'amrap', movements: ['Deadlifts'] },
    ]
    const values = [
      { roundsCompleted: '', partialReps: ['45'] },
      { roundsCompleted: '3', partialReps: ['2', '', '', ''] },
      { roundsCompleted: '', partialReps: ['12'] },
    ]
    expect(totalRepsChained(stages, values)).toBe(45 + 155 + 12)
  })
  it('estimateTotalDurationSec - suma duratelor etapelor', () => {
    const stages = [{ durationSec: 120 }, { durationSec: 1140 }, { durationSec: 120 }]
    expect(estimateTotalDurationSec('Chained AMRAP', { stages })).toBe(1380)
  })
})

describe('weightKeyForVariant', () => {
  it('mapeaza fiecare nivel + gen la coloana lui din wods', () => {
    expect(weightKeyForVariant('RX', 'masculin')).toBe('rx_weight_male')
    expect(weightKeyForVariant('RX', 'feminin')).toBe('rx_weight_female')
    expect(weightKeyForVariant('Intermediate', 'masculin')).toBe('intermediate_weight_male')
    expect(weightKeyForVariant('Beginner', 'feminin')).toBe('beginner_weight_female')
    expect(weightKeyForVariant('OnRamp', 'masculin')).toBe('onramp_weight_male')
  })
  it('gen lipsa/necunoscut cade pe male (fallback existent inainte de completarea profilului)', () => {
    expect(weightKeyForVariant('RX', undefined)).toBe('rx_weight_male')
  })
  it('nivel necunoscut sau lipsa -> null', () => {
    expect(weightKeyForVariant('Altceva', 'masculin')).toBe(null)
    expect(weightKeyForVariant(undefined, 'masculin')).toBe(null)
  })
})

describe('effectiveScoreMode', () => {
  it('formatId absent -> null, nu fallback-ul implicit al catalogului (For Time)', () => {
    expect(effectiveScoreMode(undefined, null)).toBe(null)
    expect(effectiveScoreMode(null, null)).toBe(null)
  })
  it('format normal -> scoreMode-ul din catalog', () => {
    expect(effectiveScoreMode('For Time', null)).toBe('fortime_or_amrap')
    expect(effectiveScoreMode('AMRAP', null)).toBe('amrap')
  })
  it('Partner WOD cu baseFormat AMRAP -> amrap, nu fallback-ul generic din catalog', () => {
    expect(effectiveScoreMode('Partner WOD', { baseFormat: 'AMRAP' })).toBe('amrap')
  })
  it('Partner WOD cu baseFormat For Time -> fortime_or_amrap', () => {
    expect(effectiveScoreMode('Partner WOD', { baseFormat: 'For Time' })).toBe('fortime_or_amrap')
  })
  it('Partner WOD fara baseFormat configurat -> fallback-ul generic din catalog', () => {
    expect(effectiveScoreMode('Partner WOD', null)).toBe('fortime_or_amrap')
  })
})

describe('isNotRxd', () => {
  it('greutate identica cu prescrisul (trim + case-insensitive) -> RXd', () => {
    expect(isNotRxd({ weight_logged: ' 61KG ', time_result: '10:00' }, '61kg', 'For Time')).toBe(false)
  })
  it('greutate diferita de prescris -> Not RXd', () => {
    expect(isNotRxd({ weight_logged: '40kg', time_result: '10:00' }, '61kg', 'For Time')).toBe(true)
  })
  it('spatiu intern intre numar si unitate -> tot RXd ("61 kg" vs "61kg")', () => {
    expect(isNotRxd({ weight_logged: '61 kg', time_result: '10:00' }, '61kg', 'For Time')).toBe(false)
  })
  it('unitate omisa de membru -> tot RXd cand numarul coincide ("61" vs "61kg")', () => {
    expect(isNotRxd({ weight_logged: '61', time_result: '10:00' }, '61kg', 'For Time')).toBe(false)
  })
  it('zecimala redundanta -> tot RXd ("61.0kg" vs "61kg")', () => {
    expect(isNotRxd({ weight_logged: '61.0kg', time_result: '10:00' }, '61kg', 'For Time')).toBe(false)
  })
  it('fara greutate logata (camp gol) -> presupus RXd la greutate', () => {
    expect(isNotRxd({ weight_logged: '', time_result: '10:00' }, '61kg', 'For Time')).toBe(false)
  })
  it('For Time neterminat (fara time_result) -> Not RXd, chiar cu greutate corecta', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: null }, '61kg', 'For Time')).toBe(true)
  })
  it('AMRAP fara time_result -> tot RXd (nu exista concept de neterminat la AMRAP)', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: null }, '61kg', 'AMRAP')).toBe(false)
  })
  it('fara greutate prescrisa configurata -> nu poate fi Not RXd pe greutate', () => {
    expect(isNotRxd({ weight_logged: '40kg', time_result: '10:00' }, null, 'For Time')).toBe(false)
  })
  it('formatId absent (log fara wods/format_type/header recunoscut) -> nu presupune "For Time", sare peste verificarea de time cap', () => {
    expect(isNotRxd({ weight_logged: '', time_result: null }, null, undefined)).toBe(false)
  })
  it('Partner WOD cu baseFormat AMRAP, fara time_result -> tot RXd (UI-ul de logare nu a cerut niciodata timp)', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: null }, '61kg', 'Partner WOD', { baseFormat: 'AMRAP' })).toBe(false)
  })
  it('Partner WOD cu baseFormat For Time, fara time_result -> Not RXd', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: null }, '61kg', 'Partner WOD', { baseFormat: 'For Time' })).toBe(true)
  })
  it('miscari schimbate, greutate identica si terminat in timp -> Not RXd', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: '10:00' }, '61kg', 'For Time', {}, ['21 Thrusters', '15 Wall Balls'], ['21 Thrusters', '15 Pull-ups'])).toBe(true)
  })
  it('miscari identice, greutate identica, terminat in timp -> RXd', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: '10:00' }, '61kg', 'For Time', {}, ['21 Thrusters', '15 Pull-ups'], ['21 Thrusters', '15 Pull-ups'])).toBe(false)
  })
  it('loggedMovements/prescribedMovements omise (apelanti vechi) -> nu afecteaza rezultatul', () => {
    expect(isNotRxd({ weight_logged: '61kg', time_result: '10:00' }, '61kg', 'For Time')).toBe(false)
  })
})

describe('movementsChanged', () => {
  it('lista identica -> neschimbata', () => {
    expect(movementsChanged(['21 Thrusters @ 43kg', '15 Pull-ups'], ['21 Thrusters @ 43kg', '15 Pull-ups'])).toBe(false)
  })
  it('trim + case-insensitive -> tot neschimbata', () => {
    expect(movementsChanged([' 21 THRUSTERS @ 43KG ', '15 pull-ups'], ['21 Thrusters @ 43kg', '15 Pull-ups'])).toBe(false)
  })
  it('o miscare rescrisa (greutate diferita) -> schimbata', () => {
    expect(movementsChanged(['21 Thrusters @ 24kg', '15 Pull-ups'], ['21 Thrusters @ 43kg', '15 Pull-ups'])).toBe(true)
  })
  it('miscare inlocuita cu alta -> schimbata', () => {
    expect(movementsChanged(['21 Thrusters @ 43kg', '15 Ring Rows'], ['21 Thrusters @ 43kg', '15 Pull-ups'])).toBe(true)
  })
  it('numar diferit de miscari (adaugata/stearsa) -> schimbata', () => {
    expect(movementsChanged(['21 Thrusters @ 43kg', '15 Pull-ups', '9 Burpees'], ['21 Thrusters @ 43kg', '15 Pull-ups'])).toBe(true)
  })
  it('fara lista prescrisa (WOD vechi/necompletat) -> nu poate fi "schimbata"', () => {
    expect(movementsChanged(['21 Thrusters @ 24kg'], [])).toBe(false)
    expect(movementsChanged(['21 Thrusters @ 24kg'], null)).toBe(false)
  })
  it('fara lista logata -> neschimbata (nimic de comparat)', () => {
    expect(movementsChanged(null, ['21 Thrusters @ 43kg'])).toBe(false)
  })
})

describe('isMixedCategory', () => {
  it('greutate si miscari identice prescrisului -> nu e Mixed', () => {
    expect(isMixedCategory('61kg', '61kg', ['21 Thrusters @ 61kg'], ['21 Thrusters @ 61kg'])).toBe(false)
  })
  it('doar greutatea difera -> Mixed', () => {
    expect(isMixedCategory('24kg', '61kg', ['21 Thrusters @ 61kg'], ['21 Thrusters @ 61kg'])).toBe(true)
  })
  it('doar miscarile difera -> Mixed', () => {
    expect(isMixedCategory('61kg', '61kg', ['21 Thrusters @ 61kg', '15 Ring Rows'], ['21 Thrusters @ 61kg', '15 Pull-ups'])).toBe(true)
  })
  it('nimic prescris (WOD vechi) -> nu poate fi Mixed', () => {
    expect(isMixedCategory('24kg', null, ['orice'], null)).toBe(false)
  })
})

describe('isSequentialFormat', () => {
  it('For Time fara config sau cu structura implicita "Sequence" -> secvential', () => {
    expect(isSequentialFormat('For Time', null)).toBe(true)
    expect(isSequentialFormat('For Time', {})).toBe(true)
    expect(isSequentialFormat('For Time', { structure: 'Sequence' })).toBe(true)
  })
  it('For Time cu structura explicita "Repeated Rounds" -> NU e secvential (identic cu RFT)', () => {
    expect(isSequentialFormat('For Time', { structure: 'Repeated Rounds' })).toBe(false)
  })
  it('Ladder e mereu secvential, indiferent de config (schema descrescatoare nu are varianta "runde repetate")', () => {
    expect(isSequentialFormat('Ladder', null)).toBe(true)
    expect(isSequentialFormat('Ladder', { structure: 'Repeated Rounds' })).toBe(true)
  })
  it('RFT si alte formate fara sequentialPartial in catalog -> niciodata secvential', () => {
    expect(isSequentialFormat('RFT', null)).toBe(false)
    expect(isSequentialFormat('AMRAP', null)).toBe(false)
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
  it('Total Weight (Complex) însumează greutatea din fiecare rundă', () => {
    const rows = { 'Rundă 1': [{ weight: '20' }], 'Rundă 2': [{ weight: '30' }], 'Rundă 3': [{ weight: '40' }] }
    expect(computeSetsScore('Complex', { scoringMode: 'Total Weight' }, rows)).toBe(90)
  })
  it('Max Weight (Complex) ia greutatea maximă dintre runde', () => {
    const rows = { 'Rundă 1': [{ weight: '20' }], 'Rundă 2': [{ weight: '40' }], 'Rundă 3': [{ weight: '30' }] }
    expect(computeSetsScore('Complex', { scoringMode: 'Max Weight' }, rows)).toBe(40)
  })
})

describe('REP_SCHEME_QUICK_OPTIONS', () => {
  it('include schemele clasice și e atașat câmpului sharedRepScheme (Ladder, For Time, RFT, Chipper)', () => {
    expect(REP_SCHEME_QUICK_OPTIONS).toContain('21-15-9')
    for (const formatId of ['Ladder', 'For Time', 'RFT', 'Chipper']) {
      expect(WORKOUT_FORMATS[formatId].config.sharedRepScheme.quickOptions).toBe(REP_SCHEME_QUICK_OPTIONS)
      expect(WORKOUT_FORMATS[formatId].config.sharedRepScheme.type).toBe('repsSchemeList')
    }
  })

  // WI Composer (2026-07-17): sharedRepScheme e conceptul generic - Strength
  // Sets pastreaza numele istoric (setsScheme) dar acelasi TIP structurat,
  // deliberat NEredenumit (migrare doar de dragul numelui, cost nejustificat
  // pt un format deja stabilit).
  it('Strength Sets.setsScheme ramane acelasi tip structurat, doar sub numele istoric', () => {
    expect(WORKOUT_FORMATS['Strength Sets'].config.setsScheme.type).toBe('repsSchemeList')
  })
})

describe('describeFormatConfig', () => {
  const tRo = getT('ro')

  it('RFT: rundele setate de admin apar în descriere (bug raportat - nu se vedeau nicăieri)', () => {
    expect(describeFormatConfig('RFT', { rounds: 5, timeCapSec: 1200 }, tRo)).toBe('Număr runde: 5 · Time cap (opțional): 20:00')
  })
  it('Ladder: tipul de ladder și schema comună de reps (array) apar în descriere', () => {
    const cfg = { ladderType: 'Ascending', sharedRepScheme: [21, 15, 9] }
    expect(describeFormatConfig('Ladder', cfg, tRo)).toContain('Ascending')
    expect(describeFormatConfig('Ladder', cfg, tRo)).toContain('21-15-9')
  })
  it('For Time: schema comună de reps apare în descriere, la fel ca la Ladder', () => {
    expect(describeFormatConfig('For Time', { sharedRepScheme: [50, 40, 30, 20, 10] }, tRo)).toContain('50-40-30-20-10')
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

describe('maxWeightFromSets / setsDisplayScore', () => {
  it('gaseste cea mai mare greutate dintre mai multe randuri/miscari', () => {
    const sets = { 'Front Squat': [{ reps: '3', weight: '90' }, { reps: '3', weight: '92.5' }, { reps: '3', weight: '100' }] }
    expect(maxWeightFromSets(sets)).toBe(100)
  })
  it('ignora randurile fara greutate valida (goale sau necompletate)', () => {
    const sets = { 'Deadlift': [{ reps: '5', weight: '' }, { reps: '5', weight: '120' }] }
    expect(maxWeightFromSets(sets)).toBe(120)
  })
  it('fara niciun rand cu greutate -> null', () => {
    expect(maxWeightFromSets({})).toBe(null)
    expect(maxWeightFromSets(null)).toBe(null)
    expect(maxWeightFromSets({ 'Squat': [{ reps: '5', weight: '' }] })).toBe(null)
  })
  it('setsDisplayScore foloseste scoringMode configurat (Tabata/Intervals) inaintea greutatii maxime', () => {
    const rows = { 'Runda 1': [{ reps: '10' }], 'Runda 2': [{ reps: '8' }] }
    expect(setsDisplayScore('Tabata', { scoringMode: 'Total Reps' }, rows)).toBe(18)
    expect(setsDisplayScore('Tabata', { scoringMode: 'Lowest Reps' }, rows)).toBe(8)
  })
  it('setsDisplayScore cade pe greutatea maxima cand nu exista scoringMode (Build to Heavy/1RM, Weightlifting etc)', () => {
    const sets = { 'Front Squat': [{ reps: '3', weight: '90' }, { reps: '3', weight: '100' }] }
    expect(setsDisplayScore('Build to Heavy/1RM', {}, sets)).toBe(100)
  })
  it('fara nimic logat -> null (afisat ca "-" pe Clasament)', () => {
    expect(setsDisplayScore('Build to Heavy/1RM', {}, null)).toBe(null)
  })
})
