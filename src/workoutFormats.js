// Catalog unic de formate de antrenament (AMRAP, For Time, EMOM, Tabata...) -
// sursa unica de adevar care inlocuieste listele duplicate din App.jsx
// (WOD_TYPES, HERO_WOD_TIPURI, listele inline din onEditWod/logWOD) si
// select-urile hardcodate (tipWod, skillTypeWod). Fara React/Supabase aici -
// functii pure, testabile izolat (vezi utils.js).
//
// NU redenumi id-urile deja existente in date (`AMRAP`, `For Time`, `EMOM`,
// `Tabata`, `Chipper`, `Ladder`, `Partner WOD`, `Strength`) - sunt salvate deja
// in wods.type / wods.skill_type / header-ul text din wod_logs.notes si
// custom_hero_wods.format. Formatele noi din PDF sunt id-uri noi, adaugate.
//
// Fiecare format apartine unei "familii" de logare (nu 17 UI-uri diferite):
// - 'scored'  - rezultat = timp si/sau runde+reps partiale (AMRAP/For Time...)
// - 'sets'    - randuri (interval/runda/set), fiecare cu {reps, weight,
//               completed} - generalizarea seturilor de Weightlifting de la
//               Skill Work (EMOM, Tabata, Strength Sets, Complex...)
// - 'mixed'   - Buy-In/Cash-Out: sets + scored + sets
// - 'nft'     - Not For Time: doar completat + nota, fara scor

import { convertWeight, secToTime } from './utils'

// Scheme de reps clasice (ladder-uri consacrate), oferite ca quick-select in
// FormatConfigEditor peste campul de text liber - nu limiteaza ce se poate
// scrie manual, doar accelereaza cazurile comune.
export const REP_SCHEME_QUICK_OPTIONS = [
  '21-15-9', '21-18-15-12-9-6-3', '15-12-9-6-3', '12-9-6-3', '9-7-5',
  '50-40-30-20-10', '30-20-10', '25-20-15-10-5', '10-9-8-7-6-5-4-3-2-1',
  '10-8-6-4-2', '5-4-3-2-1', '1-2-3-4-5-6-7-8-9-10',
]

// Formate unde durata totala e 100% determinata de config (runde x
// interval) - a cere si o durata manuala separata e redundant si poate sa
// nu se potriveasca cu ce rezulta din config. Vezi estimateTotalDurationSec.
export const AUTO_DURATION_FORMAT_IDS = ['EMOM', 'Tabata', 'Intervals']

// Fiecare camp de config are `labelKey`, o cheie din translations.js (nu text
// literal) - catalogul e partajat intre UI romana/engleza, vezi
// FormatConfigEditor care rezolva `t[labelKey]`.
export const WORKOUT_FORMATS = {
  'AMRAP': {
    family: 'scored', scoreMode: 'amrap',
    config: { durationSec: { type: 'duration', required: true, labelKey: 'fmtDuration' } },
  },
  'For Time': {
    family: 'scored', scoreMode: 'fortime',
    config: { timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' } },
  },
  'RFT': {
    family: 'scored', scoreMode: 'fortime_or_amrap',
    config: {
      rounds: { type: 'number', required: true, labelKey: 'fmtRoundsCount' },
      timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' },
    },
  },
  'Chipper': {
    family: 'scored', scoreMode: 'fortime',
    config: { timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' } },
  },
  'Ladder': {
    // Ca la RFT: daca nu termini schema (21-15-9 etc) in time cap, trebuie sa
    // poti loga runde complete + reps partiale in loc de timp - fara asta nu
    // exista nicio cale sa notezi progresul unei ladder neterminate.
    family: 'scored', scoreMode: 'fortime_or_amrap',
    config: {
      // quickOptions: scheme clasice reutilizate des (21-15-9 etc), afisate ca
      // chip-uri peste inputul de text liber - vezi FormatConfigEditor.
      repsScheme: { type: 'text', required: false, labelKey: 'fmtRepsScheme', quickOptions: REP_SCHEME_QUICK_OPTIONS },
      ladderType: { type: 'select', options: ['Ascending', 'Descending', 'Asc-Desc'], required: true, labelKey: 'fmtLadderType' },
      timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' },
    },
  },
  'Partner WOD': {
    family: 'scored', scoreMode: 'fortime_or_amrap',
    config: {
      splitType: { type: 'select', options: ['You go/I go', 'Shared reps', 'Synchro'], required: true, labelKey: 'fmtSplitType' },
      baseFormat: { type: 'select', options: ['AMRAP', 'For Time'], required: true, labelKey: 'fmtBaseFormat' },
      durationSec: { type: 'duration', required: false, labelKey: 'fmtDurationOrTimeCap' },
    },
    extraLogFields: ['partnerName'],
  },
  'Death By': {
    family: 'sets', rowMode: 'interval',
    config: {
      startReps: { type: 'number', required: true, labelKey: 'fmtStartReps' },
      incrementReps: { type: 'number', required: true, default: 1, labelKey: 'fmtIncrementReps' },
      intervalSec: { type: 'duration', required: true, default: 60, labelKey: 'fmtIntervalDuration' },
    },
  },
  // Varianta cu greutate crescanda in loc de reps (ex: +5kg in fiecare minut
  // pana nu mai poti termina in interval) - acelasi principiu ca Death By,
  // dar tinta e o singura miscare cu incarcatura in crestere.
  'Death By Weight': {
    family: 'sets', rowMode: 'interval', prEligible: true,
    config: {
      startWeight: { type: 'number', required: true, labelKey: 'fmtStartWeight' },
      incrementWeight: { type: 'number', required: true, default: 5, labelKey: 'fmtIncrementWeight' },
      intervalSec: { type: 'duration', required: true, default: 60, labelKey: 'fmtIntervalDuration' },
    },
  },
  'EMOM': {
    family: 'sets', rowMode: 'interval',
    config: {
      totalRounds: { type: 'number', required: true, labelKey: 'fmtIntervalCount' },
      intervalSec: { type: 'duration', required: true, default: 60, labelKey: 'fmtIntervalDuration' },
      intervals: { type: 'intervalList', required: false, labelKey: 'fmtMovementPerInterval' },
    },
  },
  'Tabata': {
    family: 'sets', rowMode: 'interval',
    // O runda Tabata = un singur numar de reps (cate ai facut in cele 20s) -
    // nu un "set" cu greutate care se poate repeta de mai multe ori ca la
    // Strength Sets. FormatLogger randeaza un singur input de reps per runda,
    // fara camp de greutate si fara "+ Adauga set", cand acest flag e true.
    simpleReps: true,
    config: {
      rounds: { type: 'number', required: true, default: 8, labelKey: 'fmtRounds' },
      workSec: { type: 'duration', required: true, default: 20, labelKey: 'fmtWork' },
      restSec: { type: 'duration', required: true, default: 10, labelKey: 'fmtRest' },
      // scorul clasic Tabata e "cea mai slaba runda" (Lowest Reps), dar unii
      // coach vor suma totala - lasam alegerea, in loc sa hardcodam.
      scoringMode: { type: 'select', options: ['Lowest Reps', 'Total Reps'], required: true, default: 'Lowest Reps', labelKey: 'fmtIntervalScoring' },
    },
  },
  // Aceeasi structura ca Tabata (runde de lucru/odihna, scor = reps) - acelasi
  // motiv pentru simpleReps: o runda e un singur numar de reps, nu un set
  // repetabil cu greutate.
  'Intervals': {
    family: 'sets', rowMode: 'interval',
    simpleReps: true,
    config: {
      rounds: { type: 'number', required: true, labelKey: 'fmtRounds' },
      workSec: { type: 'duration', required: true, labelKey: 'fmtWork' },
      restSec: { type: 'duration', required: true, labelKey: 'fmtRest' },
      scoringMode: { type: 'select', options: ['Lowest Reps', 'Total Reps'], required: true, default: 'Total Reps', labelKey: 'fmtIntervalScoring' },
    },
  },
  // Id istoric (skill_type implicit dinainte de acest catalog) - pastrat ca
  // atare (nu redenumit 'Strength Sets') ca sa ramana compatibil cu toate
  // WOD-urile existente. Seturi libere, fara nr. de seturi prescris.
  'Weightlifting': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: {},
  },
  // setsScheme: lista de tinte de reps, un numar per set (ex [5,5,5,5,5] sau
  // [5,3,3,1,1]) - fiecare set poate avea o tinta diferita de reps, nu doar o
  // schema uniforma de tip "5x5". Numarul de seturi = lungimea listei.
  'Strength Sets': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: {
      setsScheme: { type: 'repsSchemeList', required: true, labelKey: 'fmtSetsScheme' },
    },
  },
  'Build to Heavy/1RM': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: { targetLabel: { type: 'text', required: false, default: '1RM', labelKey: 'fmtTargetLabel' } },
  },
  'Complex': {
    family: 'sets', rowMode: 'round', prEligible: true,
    config: {
      complexMovements: { type: 'movementList', required: true, labelKey: 'fmtComplexMovements' },
      rounds: { type: 'number', required: true, labelKey: 'fmtRoundsAttempts' },
    },
  },
  'Superset': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: {
      movements: { type: 'movementList', required: true, labelKey: 'fmtAlternatingMovements' },
      targetSets: { type: 'number', required: true, labelKey: 'fmtSetsCount' },
    },
  },
  'Buy-In/Cash-Out': {
    family: 'mixed',
    config: {
      buyIn: { type: 'movementList', required: true, labelKey: 'fmtBuyInMovements' },
      cashOut: { type: 'movementList', required: true, labelKey: 'fmtCashOutMovements' },
      mainFormat: { type: 'select', options: ['AMRAP', 'For Time'], required: true, labelKey: 'fmtMainWorkFormat' },
      mainDurationSec: { type: 'duration', required: false, labelKey: 'fmtMainWorkDuration' },
    },
  },
  // Diferit de Buy-In/Cash-Out: aici e o SINGURA durata totala (clock unic);
  // buy-in-ul consuma din ea, iar AMRAP-ul foloseste timpul ramas - nu doua
  // durate separate (buy-in + main work).
  'AMRAP with Buy-In': {
    family: 'mixed', scoreMode: 'amrap',
    config: {
      totalDurationSec: { type: 'duration', required: true, labelKey: 'fmtDuration' },
      buyIn: { type: 'movementList', required: true, labelKey: 'fmtBuyInMovements' },
    },
  },
  'Not For Time': {
    family: 'nft', config: {},
  },
  'Max Effort': {
    family: 'scored', scoreMode: 'single_value',
    config: { movement: { type: 'text', required: false, labelKey: 'fmtMovementTest' } },
  },
}

export const FORMAT_IDS = Object.keys(WORKOUT_FORMATS)
// Cele mai lungi id-uri primele, ca sa nu fie prins gresit un prefix mai scurt
// (ex. 'Build to Heavy/1RM' nu trebuie confundat cu nimic mai scurt).
const FORMAT_IDS_BY_LENGTH_DESC = [...FORMAT_IDS].sort((a, b) => b.length - a.length)

export const DEFAULT_FORMAT_ID = 'For Time'

export function getFormat(id) {
  return WORKOUT_FORMATS[id] || WORKOUT_FORMATS[DEFAULT_FORMAT_ID]
}

// Detecteaza tipul dintr-un header text liber (prima linie a `notes`/`format`
// din date istorice) - generalizarea `WOD_TYPES.some(t => linie.startsWith(t))`
// / parseHeroFormat() din App.jsx, acum plecand de la catalogul unic.
export function legacyHeaderTypeOf(headerLine) {
  const line = (headerLine || '').trim()
  return FORMAT_IDS_BY_LENGTH_DESC.find(id => line.startsWith(id)) || null
}

// --- family: 'scored' -------------------------------------------------

// Genereaza textul "3 runde + 5 Pull-ups, 10 Push-ups" dintr-un numar de
// runde complete + reps partiale per miscare. Genericul din spatele lui
// composeAmrapResult() din App.jsx.
export function composePartialText(partialArr, movements) {
  return movements
    .map((m, i) => partialArr[i]?.trim() ? `${partialArr[i].trim()} ${m}` : null)
    .filter(Boolean).join(', ')
}

export function parsePartialText(text, movements) {
  const partialArr = movements.map(() => '')
  ;(text || '').split(',').forEach(seg => {
    const mm = seg.trim().match(/^(\d+)\s+(.+)$/)
    if (mm) { const idx = movements.indexOf(mm[2].trim()); if (idx !== -1) partialArr[idx] = mm[1] }
  })
  return partialArr
}

export function composeAmrapResult(roundsCompleted, partialArr, movements) {
  if (!(roundsCompleted || '').toString().trim()) return ''
  const partialStr = composePartialText(partialArr, movements)
  return `${roundsCompleted.toString().trim()} runde${partialStr ? ' + ' + partialStr : ' complete'}`
}

export function parseAmrapResult(resultStr, movements) {
  const roundsMatch = (resultStr || '').match(/^(\d+)/)
  const plusIdx = (resultStr || '').indexOf('+')
  const partialArr = plusIdx !== -1 ? parsePartialText(resultStr.slice(plusIdx + 1), movements) : movements.map(() => '')
  return { rounds: roundsMatch ? roundsMatch[1] : '', partialArr }
}

// Compune/parseaza header-ul text "TIP mm:ss" folosit de Hero WOD-uri
// (custom_hero_wods.format) si de header-ul WOD-ului zilei din wod_logs.notes
// - generalizarea composeHeroFormat()/parseHeroFormat() din App.jsx, acum
// plecand de la catalogul unic in loc de HERO_WOD_TIPURI hardcodat.
export function composeFormatHeader(formatId, durMin, durSec) {
  const dur = (durMin || durSec) ? `${parseInt(durMin) || 0}:${String(parseInt(durSec) || 0).padStart(2, '0')}` : ''
  return `${formatId}${dur ? ' ' + dur : ''}`
}

export function parseFormatHeader(headerStr) {
  const tip = legacyHeaderTypeOf(headerStr) || DEFAULT_FORMAT_ID
  const rest = (headerStr || '').slice(tip.length).trim()
  const durMatch = rest.match(/(\d+):(\d+)/)
  return { tip, min: durMatch ? durMatch[1] : '', sec: durMatch ? durMatch[2] : '0' }
}

// Durata totala estimata (secunde) dintr-un config structurat, folosita doar
// pentru afisare/compatibilitate cu header-ul text vechi "TIP mm:ss" - nu
// toate formatele au o durata clara (ex. Death By e open-ended), caz in care
// intoarce null si header-ul ramane fara durata (optionala oricum).
export function estimateTotalDurationSec(formatId, config) {
  const cfg = config || {}
  if (formatId === 'AMRAP') return cfg.durationSec || null
  if (['For Time', 'Chipper', 'Ladder', 'RFT', 'Partner WOD'].includes(formatId)) return cfg.timeCapSec || cfg.durationSec || null
  if (formatId === 'EMOM') return (parseInt(cfg.totalRounds) || 0) * (cfg.intervalSec || 60) || null
  if (formatId === 'Tabata' || formatId === 'Intervals') return (parseInt(cfg.rounds) || 8) * ((cfg.workSec || 20) + (cfg.restSec || 10)) || null
  if (formatId === 'Buy-In/Cash-Out') return cfg.mainDurationSec || null
  if (formatId === 'AMRAP with Buy-In') return cfg.totalDurationSec || null
  return null
}

// Rezuma configul intr-un text scurt "Label: valoare · Label: valoare" pentru
// afisare pe ecranul de acasa/jurnal/logare - fara asta, campurile setate de
// admin (ex. RFT cu 5 runde, Ladder Ascending, EMOM cu exercitiu rotativ) erau
// salvate corect dar nu se vedeau nicaieri in afara formularului de editare
// (bug raportat: "la RFT ... nu imi ia rundele" - de fapt rundele erau
// salvate, doar nu erau afisate nicaieri membrului). Genereaza automat pentru
// orice format din catalog, plecand de la aceleasi field-uri ca
// FormatConfigEditor - nu hardcodeaza per format, deci acopera si formate noi
// adaugate ulterior in WORKOUT_FORMATS fara nicio modificare aici.
export function describeFormatConfig(formatId, config, t) {
  const fmt = getFormat(formatId)
  const cfg = config || {}
  const parts = []
  Object.entries(fmt.config || {}).forEach(([key, field]) => {
    const value = cfg[key]
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return
    const label = t?.[field.labelKey] || field.labelKey
    let displayValue
    if (field.type === 'duration') displayValue = secToTime(value)
    else if (field.type === 'movementList' || field.type === 'intervalList') displayValue = value.join(', ')
    else if (field.type === 'repsSchemeList') displayValue = value.join('-')
    else displayValue = String(value)
    parts.push(`${label}: ${displayValue}`)
  })
  return parts.join(' · ')
}

// Eticheta scurta a formatului, cu numarul de runde inclus acolo unde e
// conventie consacrata in CrossFit (ex. "5 RFT" - Rounds For Time), nu doar
// "RFT" urmat separat de "Numar runde: 5" (redundant si mai putin natural
// de citit pe cardurile din Jurnal/Acasa).
export function formatTypeLabel(formatId, config) {
  const cfg = config || {}
  if (formatId === 'RFT' && cfg.rounds) return `${cfg.rounds} RFT`
  return formatId
}

// --- family: 'sets' -----------------------------------------------------

// Accepta atat formatul vechi ({ miscare: ["40","50"] }, doar greutate ca
// string) cat si cel nou ({ rowLabel: [{reps,weight,completed}] }) -
// generalizarea normalizeSkillSets() din App.jsx, cheia nu mai e neaparat un
// nume de miscare (poate fi "Min 1", "Rundă 3" etc).
export function normalizeSetsRows(sets) {
  const out = {}
  Object.entries(sets || {}).forEach(([key, rows]) => {
    out[key] = (rows || []).map(v => typeof v === 'string' ? { weight: v, reps: '' } : v)
  })
  return out
}

export function addSetRow(rowsByKey, key) {
  return { ...rowsByKey, [key]: [...(rowsByKey[key] || []), { weight: '', reps: '', completed: false }] }
}

export function updateSetRow(rowsByKey, key, idx, field, value) {
  const next = [...(rowsByKey[key] || [])]
  next[idx] = { ...next[idx], [field]: value }
  return { ...rowsByKey, [key]: next }
}

export function removeSetRow(rowsByKey, key, idx) {
  return { ...rowsByKey, [key]: (rowsByKey[key] || []).filter((_, i) => i !== idx) }
}

// Genereaza randurile initiale goale pentru formatele family:'sets', pe baza
// config-ului definit de admin - ex. EMOM cu totalRounds:12 -> 12 randuri
// "Min 1".."Min 12"; Tabata cu rounds:8 -> "Rundă 1".."Rundă 8"; Strength Sets
// cu targetSets:5 -> 5 randuri goale per miscare din `movements`.
export function defaultRowsForFormat(formatId, config, movements) {
  const fmt = getFormat(formatId)
  if (fmt.family !== 'sets') return {}
  const emptyRow = () => ({ weight: '', reps: '', completed: false })
  const rowsOf = (n) => Array.from({ length: Math.max(1, n || 1) }, emptyRow)

  if (formatId === 'EMOM') {
    const n = parseInt(config?.totalRounds) || 1
    const customIntervals = Array.isArray(config?.intervals) && config.intervals.length > 0 ? config.intervals : null
    const out = {}
    for (let i = 1; i <= n; i++) {
      const label = customIntervals ? `Min ${i} · ${customIntervals[(i - 1) % customIntervals.length]}` : `Min ${i}`
      out[label] = [emptyRow()]
    }
    return out
  }
  if (formatId === 'Tabata' || formatId === 'Intervals') {
    const n = parseInt(config?.rounds) || 8
    const out = {}
    for (let i = 1; i <= n; i++) out[`Rundă ${i}`] = [emptyRow()]
    return out
  }
  if (formatId === 'Death By' || formatId === 'Death By Weight') {
    return { 'Min 1': [emptyRow()] }
  }
  if (formatId === 'Complex') {
    const n = parseInt(config?.rounds) || 1
    const out = {}
    for (let i = 1; i <= n; i++) out[`Rundă ${i}`] = [emptyRow()]
    return out
  }
  // Strength Sets: un rand per intrare din setsScheme (tinta de reps a acelui
  // set), purtata pe rand ca `targetReps` - FormatLogger o afiseaza ca hint
  // ("/ N reps"), nu forteaza valoarea logata.
  if (formatId === 'Strength Sets') {
    const scheme = Array.isArray(config?.setsScheme) && config.setsScheme.length > 0 ? config.setsScheme : [null]
    const movs = (movements && movements.length > 0) ? movements : ['']
    const out = {}
    movs.forEach(m => { out[m] = scheme.map(targetReps => ({ ...emptyRow(), targetReps: targetReps ?? null })) })
    return out
  }
  // Weightlifting / Superset / Build to Heavy/1RM: randuri per miscare. Fara
  // targetSets prescris (Weightlifting, Build to Heavy) pornim de la 0
  // randuri - membrul adauga manual cate seturi a facut, ca la Skill Work
  // Weightlifting azi (nu presupunem un numar).
  const targetSets = parseInt(config?.targetSets) || 0
  const movs = (movements && movements.length > 0) ? movements : ['']
  const out = {}
  movs.forEach(m => { out[m] = targetSets ? rowsOf(targetSets) : [] })
  return out
}

// Calculeaza scorul unui format family:'sets' cu scoringMode configurabil
// (Tabata/Intervals: Total Reps = suma tuturor randurilor, Lowest Reps = cea
// mai mica valoare dintre randuri cu reps completat). Intoarce null daca nu
// exista randuri cu reps valide sau formatul nu are scoringMode.
export function computeSetsScore(formatId, config, rowsByKey) {
  const scoringMode = config?.scoringMode
  if (!scoringMode) return null
  const repsValues = Object.values(rowsByKey || {})
    .flat()
    .map(r => parseInt(r?.reps))
    .filter(n => !isNaN(n))
  if (repsValues.length === 0) return null
  if (scoringMode === 'Total Reps') return repsValues.reduce((a, b) => a + b, 0)
  return Math.min(...repsValues)
}

// Pentru fiecare numar de reps logat, ia cea mai mare greutate introdusa si o
// compara cu cel mai mare PR existent la aceeasi miscare + acelasi numar
// exact de reps (PR-urile se tin separat pe numar de reps). Returneaza doar
// candidatii care bat recordul - generalizarea computeSkillPrCandidates() din
// App.jsx, acum reutilizabila pentru orice log family:'sets' (nu doar Skill
// Weightlifting).
export function computeSetsPrCandidates(movement, rowsByKey, weightUnit, prDate) {
  if (!movement) return []
  const bestByReps = {}
  Object.values(rowsByKey || {}).forEach(rows => (rows || []).forEach(r => {
    const reps = parseInt(r.reps), weight = parseFloat(r.weight)
    if (!reps || !weight) return
    if (!bestByReps[reps] || weight > bestByReps[reps]) bestByReps[reps] = weight
  }))
  return Object.entries(bestByReps).map(([repsStr, weight]) => {
    const reps = parseInt(repsStr)
    const existingKg = (prDate || [])
      .filter(r => r.movement === movement && (r.reps || 1) === reps && (r.unit === 'kg' || r.unit === 'lbs'))
      .map(r => convertWeight(parseFloat(r.value), r.unit, weightUnit))
    const bestExisting = existingKg.length ? Math.max(...existingKg) : null
    return { movement, reps, weight, unit: weightUnit, isNewPr: bestExisting == null || weight > bestExisting }
  }).filter(c => c.isNewPr).sort((a, b) => a.reps - b.reps)
}
