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

import { convertWeight } from './utils'

export const WORKOUT_FORMATS = {
  'AMRAP': {
    family: 'scored', scoreMode: 'amrap',
    config: { durationSec: { type: 'duration', required: true, label: 'Durată' } },
  },
  'For Time': {
    family: 'scored', scoreMode: 'fortime',
    config: { timeCapSec: { type: 'duration', required: false, label: 'Time cap (opțional)' } },
  },
  'RFT': {
    family: 'scored', scoreMode: 'fortime_or_amrap',
    config: {
      rounds: { type: 'number', required: true, label: 'Număr runde' },
      timeCapSec: { type: 'duration', required: false, label: 'Time cap (opțional)' },
    },
  },
  'Chipper': {
    family: 'scored', scoreMode: 'fortime',
    config: { timeCapSec: { type: 'duration', required: false, label: 'Time cap (opțional)' } },
  },
  'Ladder': {
    family: 'scored', scoreMode: 'fortime',
    config: {
      ladderType: { type: 'select', options: ['Ascending', 'Descending', 'Asc-Desc'], required: true, label: 'Tip ladder' },
      timeCapSec: { type: 'duration', required: false, label: 'Time cap (opțional)' },
    },
  },
  'Partner WOD': {
    family: 'scored', scoreMode: 'fortime_or_amrap',
    config: {
      splitType: { type: 'select', options: ['You go/I go', 'Shared reps', 'Synchro'], required: true, label: 'Tip split' },
      baseFormat: { type: 'select', options: ['AMRAP', 'For Time'], required: true, label: 'Format de bază' },
      durationSec: { type: 'duration', required: false, label: 'Durată/time cap' },
    },
    extraLogFields: ['partnerName'],
  },
  'Death By': {
    family: 'sets', rowMode: 'interval',
    config: {
      startReps: { type: 'number', required: true, label: 'Reps minutul 1' },
      incrementReps: { type: 'number', required: true, default: 1, label: 'Increment reps/minut' },
      intervalSec: { type: 'duration', required: true, default: 60, label: 'Durată interval' },
    },
  },
  'EMOM': {
    family: 'sets', rowMode: 'interval',
    config: {
      totalRounds: { type: 'number', required: true, label: 'Număr intervale' },
      intervalSec: { type: 'duration', required: true, default: 60, label: 'Durată interval' },
      intervals: { type: 'intervalList', required: false, label: 'Mișcare per interval (opțional)' },
    },
  },
  'Tabata': {
    family: 'sets', rowMode: 'interval',
    config: {
      rounds: { type: 'number', required: true, default: 8, label: 'Runde' },
      workSec: { type: 'duration', required: true, default: 20, label: 'Lucru' },
      restSec: { type: 'duration', required: true, default: 10, label: 'Odihnă' },
    },
  },
  'Intervals': {
    family: 'sets', rowMode: 'interval',
    config: {
      rounds: { type: 'number', required: true, label: 'Runde' },
      workSec: { type: 'duration', required: true, label: 'Lucru' },
      restSec: { type: 'duration', required: true, label: 'Odihnă' },
    },
  },
  'Strength Sets': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: {
      targetSets: { type: 'number', required: true, label: 'Nr. seturi' },
      repsScheme: { type: 'text', required: false, label: 'Schemă reps (ex: 5x5, 3-3-3-3-3)' },
    },
  },
  'Build to Heavy/1RM': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: { targetLabel: { type: 'text', required: false, default: '1RM', label: 'Etichetă target' } },
  },
  'Complex': {
    family: 'sets', rowMode: 'round', prEligible: true,
    config: {
      complexMovements: { type: 'movementList', required: true, label: 'Mișcări complex, în ordine' },
      rounds: { type: 'number', required: true, label: 'Nr. runde/încercări' },
    },
  },
  'Superset': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: {
      movements: { type: 'movementList', required: true, label: 'Mișcări (alternate)' },
      targetSets: { type: 'number', required: true, label: 'Nr. seturi' },
    },
  },
  'Buy-In/Cash-Out': {
    family: 'mixed',
    config: {
      buyIn: { type: 'movementList', required: true, label: 'Buy-In (mișcări)' },
      cashOut: { type: 'movementList', required: true, label: 'Cash-Out (mișcări)' },
      mainFormat: { type: 'select', options: ['AMRAP', 'For Time'], required: true, label: 'Format main work' },
      mainDurationSec: { type: 'duration', required: false, label: 'Durată/time cap main work' },
    },
  },
  'Not For Time': {
    family: 'nft', config: {},
  },
  'Max Effort': {
    family: 'scored', scoreMode: 'single_value',
    config: { movement: { type: 'text', required: false, label: 'Mișcare/test' } },
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
  if (formatId === 'Death By') {
    return { 'Min 1': [emptyRow()] }
  }
  if (formatId === 'Complex') {
    const n = parseInt(config?.rounds) || 1
    const out = {}
    for (let i = 1; i <= n; i++) out[`Rundă ${i}`] = [emptyRow()]
    return out
  }
  // Strength Sets / Superset / Build to Heavy/1RM: randuri per miscare.
  const targetSets = parseInt(config?.targetSets) || 1
  const movs = (movements && movements.length > 0) ? movements : ['']
  const out = {}
  movs.forEach(m => { out[m] = rowsOf(targetSets) })
  return out
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
