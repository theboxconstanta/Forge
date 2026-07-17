// Workout Intelligence, WI-1 - "Paste-to-Draft". Functii PURE (acelasi tipar
// ca workoutEngine.js/wodSections.js), separate de App.jsx ca sa poata fi
// testate izolat, fara Supabase/React.
//
// sectionsFromAiAnalysis() mapeaza raspunsul edge function-ului
// analyze-workout (WorkoutAnalysis.sections - vezi supabase/functions/
// analyze-workout/{openaiSchema,transform}.ts) in lista de sectiuni a
// editorului nativ (Faza 6, src/wodSections.js) - ACELASI tipar ca
// sectionsFromLegacyWod, doar cu alta sursa.
//
// Principiu explicit (decizia userului, discutia Faza 0/WI-1): populeaza
// DOAR ce AI-ul stie explicit. Niciodata nu sintetizam/inventam o valoare
// lipsa - un camp de config pe care schema AI-ului nu-l acopera (ex.
// Chained AMRAP.stages, Complex.complexMovements) ramane pur si simplu la
// valoarea implicita a editorului, iar sectiunea primeste un semnal de
// revizuire. Fara "allowlist" de formate - decizia se ia CAMP CU CAMP, nu
// per format, ca sa se extinda singura pe masura ce schema AI-ului se
// imbogateste, fara nicio lista de intretinut manual.
//
// Semnalele de revizuire (deriveReviewFlags) NU sunt un sistem de
// incredere/scor - doar 6 motive fixe, derivate STRICT din semnale deja
// prezente in raspunsul AI-ului (canonicalName null, greutate/distanta
// lipsa, format nerecunoscut, benchmark neconcludent) - nicio schimbare de
// prompt/schema in edge function.

import { createSection, newSectionId, emptySectionVariants, VARIANT_LEVELS } from './wodSections'
import { WORKOUT_FORMATS, getFormat } from './workoutFormats'
import { CARDIO_MISCARI } from './movements'

// --- compunere text dintr-o miscare structurata ----------------------------

// Echivalentul local al movementToLine() din edge function (transform.ts) -
// COPIE deliberata, nu import: edge function-ul (Deno, folder propriu) si
// aplicatia (Vite/React) nu-si partajeaza module, acelasi tipar deja stabilit
// la movementCatalog.ts ("copie statica din src/movements.js... Edge
// Function-ul ramane self-contained"). Tinute manual sincronizate daca
// vreuna din cele doua se schimba.
export function composeMovementLine(m) {
  if (!m) return ''
  const name = m.name || m.canonicalName || ''
  const nameLower = name.trim().toLowerCase()
  // Modelul pune uneori continutul deja compus direct in `name` (ex. "400m
  // run", "Thrusters @ 43/30kg") SI separat, structurat, in reps/distance/
  // weight - fara aceste verificari am produce duplicate vizibile ("400m
  // run 400m", "Thrusters @ 43/30kg @ 43/30kg"), gasit live la validare
  // (WI-1). Verificare simpla de continut (nu doar prefix, ca la reps -
  // distanta/greutatea pot aparea oriunde in name), suficienta cat sa evite
  // duplicarea fara sa ascunda vreodata o valoare structurata reala.
  const nameAlreadyHasReps = m.reps != null && new RegExp(`^${m.reps}\\b`).test(name.trim())
  const nameAlreadyHasDistance = m.distance != null && nameLower.includes(`${m.distance.value}${m.distance.unit}`.toLowerCase())
  const nameAlreadyHasCalories = m.calories != null && nameLower.includes(`${m.calories} cal`)
  const weightText = m.weight
    ? (m.weight.female != null && m.weight.female !== m.weight.male
      ? `${m.weight.male}/${m.weight.female}${m.weight.unit}`
      : `${m.weight.male}${m.weight.unit}`)
    : null
  const nameAlreadyHasWeight = weightText != null && nameLower.includes(weightText.toLowerCase())

  const parts = []
  if (m.reps != null && !nameAlreadyHasReps) parts.push(String(m.reps))
  parts.push(name)
  if (m.distance && !nameAlreadyHasDistance) parts.push(`${m.distance.value}${m.distance.unit}`)
  if (m.calories != null && !nameAlreadyHasCalories) parts.push(`${m.calories} cal`)
  if (weightText && !nameAlreadyHasWeight) parts.push(`@ ${weightText}`)
  const line = parts.filter(Boolean).join(' ')
  return m.notes ? `${line} (${m.notes})` : line
}

// --- traducere formatConfig (AI generic -> campul specific formatului) -----

// Pt fiecare format, DOAR campurile unde exista o corespondenta semantica
// directa, fara ambiguitate de unitate - restul campurilor din catalog
// (workoutFormats.js) raman neacoperite intentionat (schema AI-ului n-are
// un echivalent, ex. stages/complexMovements/setsScheme/buyIn/splitType) -
// sectiunea primeste automat semnalul "needs review" mai jos daca formatul
// ales are campuri OBLIGATORII (required: true) neacoperite. Adaugarea unui
// format nou in catalog NU cere nicio schimbare aici - pur si simplu nimic
// nu se populeaza pt el pana cand cineva adauga explicit o traducere.
const min2sec = (min) => (min != null ? Math.round(min * 60) : null)
const FORMAT_CONFIG_TRANSLATORS = {
  'AMRAP': (c) => ({ durationSec: min2sec(c.timeCapMinutes) }),
  'Ascending AMRAP': (c) => ({ durationSec: min2sec(c.timeCapMinutes), startReps: c.startReps, incrementReps: c.incrementReps }),
  'For Time': (c) => ({ rounds: c.rounds, timeCapSec: min2sec(c.timeCapMinutes) }),
  'RFT': (c) => ({ rounds: c.rounds, timeCapSec: min2sec(c.timeCapMinutes) }),
  'Chipper': (c) => ({ timeCapSec: min2sec(c.timeCapMinutes) }),
  'Ladder': (c) => ({ timeCapSec: min2sec(c.timeCapMinutes) }),
  'Partner WOD': (c) => ({ durationSec: min2sec(c.timeCapMinutes), rounds: c.rounds }),
  'Death By': (c) => ({ startReps: c.startReps, incrementReps: c.incrementReps, intervalSec: c.intervalSeconds }),
  'Death By Weight': (c) => ({ intervalSec: c.intervalSeconds }),
  'EMOM': (c) => ({ totalRounds: c.rounds, intervalSec: c.intervalSeconds }),
  'Tabata': (c) => ({ rounds: c.rounds, workSec: c.workSeconds, restSec: c.restSeconds }),
  'Intervals': (c) => ({ rounds: c.rounds, workSec: c.workSeconds, restSec: c.restSeconds }),
  'Weightlifting': () => ({}),
  'Complex': (c) => ({ rounds: c.rounds }),
  'AMRAP with Buy-In': (c) => ({ totalDurationSec: min2sec(c.timeCapMinutes) }),
  'Not For Time': () => ({}),
}

// Campurile obligatorii ale formatului ales care au ramas nepopulate dupa
// traducere -> semnal ca sectiunea are nevoie de completare manuala. Pur
// mecanic (citeste catalogul, nu presupune nimic despre formate anume) -
// asta face ca un format nou adaugat in workoutFormats.js sa fie automat
// semnalat corect, fara nicio actualizare aici.
// Un camp obligatoriu cu `default` in catalog nu conteaza ca "lipsa" - UI-ul
// (FormatConfigEditor) deja cade pe acel default cand campul nu e setat, deci
// coach-ul nu vede nimic incomplet - fara aceasta excludere, formate ca
// Tabata (scoringMode are default 'Lowest Reps') ar fi semnalate degeaba.
function missingRequiredConfigFields(formatId, config) {
  const fmt = WORKOUT_FORMATS[formatId]
  if (!fmt) return []
  return Object.entries(fmt.config || {})
    .filter(([key, def]) => def.required && def.default === undefined && (config[key] === undefined || config[key] === null))
    .map(([key]) => key)
}

// --- sectiune individuala ---------------------------------------------------

const KNOWN_SCALING_KEYS = VARIANT_LEVELS.map(v => v.key) // ['onramp','beginner','intermediate','rx']
const AI_LEVEL_TO_EDITOR_KEY = { rx: 'rx', intermediate: 'intermediate', beginner: 'beginner', on_ramp: 'onramp', onramp: 'onramp' }

// Alege greutatea "de sectiune" a unei variante dintr-o lista de miscari
// structurate - prima miscare CU greutate (cazul obisnuit: un WOD are un
// singur implement incarcat, restul e bodyweight). Nu inventeaza nimic -
// doar alege intre valorile deja explicite; daca miscarile incarcate au
// greutati DIFERITE, semnalam asta separat (vezi deriveReviewFlags) in loc
// sa alegem tacit una.
function pickVariantWeight(movements) {
  const weighted = (movements || []).filter(m => m.weight)
  if (weighted.length === 0) return { male: '', female: '', conflicting: false }
  const first = weighted[0].weight
  const conflicting = weighted.some(m => m.weight.male !== first.male || m.weight.female !== first.female)
  return {
    male: first.male != null ? `${first.male}${first.unit || 'kg'}` : '',
    female: first.female != null ? `${first.female}${first.unit || 'kg'}` : (first.male != null ? `${first.male}${first.unit || 'kg'}` : ''),
    conflicting,
  }
}

function buildVariants(aiSection) {
  const variants = emptySectionVariants()
  const rxWeight = pickVariantWeight(aiSection.movements)
  variants.rx = {
    movements: (aiSection.movements || []).map(composeMovementLine).filter(Boolean),
    quickAdd: '', paste: '',
    weight: { male: rxWeight.male, female: rxWeight.female },
    note: aiSection.description || '',
  }
  for (const sv of aiSection.scalingVersions || []) {
    const editorKey = AI_LEVEL_TO_EDITOR_KEY[sv.level]
    if (!editorKey || !KNOWN_SCALING_KEYS.includes(editorKey)) continue // ex. 'masters' - fara slot in editor, vezi deriveReviewFlags
    const w = pickVariantWeight(sv.movements)
    variants[editorKey] = {
      movements: (sv.movements || []).map(composeMovementLine).filter(Boolean),
      quickAdd: '', paste: '',
      weight: { male: w.male, female: w.female },
      note: sv.notes || '',
    }
  }
  return variants
}

// Titlul brut al AI-ului nu e validat inainte sa ajunga in editor - gasit la
// explorarea WI-1 (07-17): modelul intoarce ocazional text decorativ literat
// ("F O R   T I M E", dintr-un paste stil Instagram) sau, mai rar, un ecou
// aproape complet al textului sursa, ambele nefolositoare ca titlu de
// sectiune. MAX_TITLE_LENGTH si pragul de "ecou" sunt praguri deliberat
// conservatoare - scopul e sa scapam de cazurile clar degenerate, nu sa
// "curatam" un titlu neobisnuit dar real (in caz de dubiu, se renunta la
// titlu, nu se ghiceste o varianta curatata).
const MAX_TITLE_LENGTH = 80
const ECHO_MIN_LENGTH = 30

// Colapseaza text "literat" (o litera pe cuvant, spatiu unic intre litere,
// spatiu dublu+ intre cuvinte reale) inapoi la cuvinte normale - "F O R   T
// I M E" -> "FOR TIME". Un titlu scurt normal (ex. "AB Complex") nu e atins,
// fiindca nu TOATE token-urile dintr-un bloc sunt de o litera.
function collapseLetterSpacing(title) {
  return title
    .split(/\s{2,}/)
    .map(chunk => {
      const tokens = chunk.split(' ').filter(Boolean)
      const allSingleLetters = tokens.length >= 3 && tokens.every(tok => tok.length === 1)
      return allSingleLetters ? tokens.join('') : chunk
    })
    .join(' ')
}

/** Normalizeaza titlul brut al unei sectiuni AI - vezi comentariul de mai
 * sus. Intoarce '' (niciodata textul brut) cand titlul e clar degenerat. */
export function normalizeTitle(rawTitle, description) {
  const trimmed = (rawTitle || '').trim()
  if (!trimmed) return ''

  const collapsed = collapseLetterSpacing(trimmed)
  if (collapsed.length > MAX_TITLE_LENGTH) return ''

  const desc = (description || '').trim().toLowerCase()
  if (collapsed.length >= ECHO_MIN_LENGTH && desc && desc.includes(collapsed.toLowerCase())) return ''

  return collapsed
}

/** Mapare PURA: o sectiune WorkoutAnalysis.sections[i] -> o sectiune a
 * editorului nativ (acelasi shape ca createSection()). */
export function sectionFromAiSection(aiSection, isPrimary) {
  const formatKnown = !!aiSection.format && !!WORKOUT_FORMATS[aiSection.format]
  const format = formatKnown ? aiSection.format : (isPrimary ? 'AMRAP' : null)
  const translator = format ? FORMAT_CONFIG_TRANSLATORS[format] : null
  const rawConfig = translator ? translator(aiSection.formatConfig || {}) : {}
  const formatConfig = Object.fromEntries(Object.entries(rawConfig).filter(([, v]) => v != null))

  const base = createSection(aiSection.type || (isPrimary ? 'metcon' : 'skill'), isPrimary)
  const section = {
    ...base,
    id: newSectionId(),
    title: normalizeTitle(aiSection.title, aiSection.description),
    format,
    formatConfig,
  }

  if (isPrimary) {
    section.name = aiSection.benchmarkMetadata?.name || ''
    section.durationMin = aiSection.durationMinutes != null ? String(Math.floor(aiSection.durationMinutes)) : base.durationMin
    section.durationSec = '0'
    section.variants = buildVariants(aiSection)
  } else {
    section.movementName = (aiSection.movements || [])[0]?.name || ''
    section.text = (aiSection.movements || []).map(composeMovementLine).filter(Boolean).join('\n')
  }

  return section
}

/** Alege sectiunea primara. Deliberat DIFERIT de findPrimarySection() din
 * edge function (transform.ts, care ia PRIMA sectiune 'required') - gasit la
 * validarea live (WI-1): modelul marcheaza uneori MAI MULTE sectiuni ca
 * 'required' (ex. un Strength/Skill cu schema clara DE seturi, urmat de
 * metcon-ul propriu-zis) - prima in ordine e aproape mereu munca
 * secundara/pregatitoare, nu "WOD-ul zilei" pe care un coach l-ar alege ca
 * principal. Ultima sectiune 'required' e o potrivire mult mai buna cu
 * structura reala a unei clase (warmup -> strength/skill -> metcon,
 * metcon-ul fiind aproape intotdeauna ultimul). Garanteaza mereu EXACT o
 * sectiune primara, chiar daca AI-ul n-a marcat nicio sectiune (sau mai
 * multe) cu loggingMode 'required' - fara asta, un coach ar lovi imediat
 * eroarea de validare a Fazei 6 pe un draft proaspat produs. */
function pickPrimaryIndex(sections) {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].loggingMode === 'required' && sections[i].format) return i
  }
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].format) return i
  }
  return sections.length > 0 ? sections.length - 1 : -1
}

/** Punctul unic de intrare - WorkoutAnalysis -> lista de sectiuni a
 * editorului, in aceeasi ordine ca AI-ul (care reflecta deja ordinea din
 * textul original). */
export function sectionsFromAiAnalysis(analysis) {
  const aiSections = analysis?.sections || []
  if (aiSections.length === 0) return []
  const primaryIdx = pickPrimaryIndex(aiSections)
  return aiSections.map((s, i) => sectionFromAiSection(s, i === primaryIdx))
}

// --- semnale de revizuire (WI-1: simple, fara scor de incredere) -----------

const isCardioMovement = (m) => CARDIO_MISCARI.some(c => c.toLowerCase() === (m.canonicalName || m.name || '').toLowerCase())

/** Deriva semnalele de revizuire STRICT din raspunsul AI-ului (nu din
 * sectiunile deja mapate) - cele 6 motive fixe cerute (WI-1): miscare
 * necunoscuta, format ambiguu, greutate lipsa, distanta lipsa, benchmark
 * nerezolvat, generic "needs review". Fiecare flag e legat de un semnal deja
 * explicit in raspuns, niciodata o presupunere noua. Rezultat: array plat
 * `{ sectionIndex, reason, detail }` - App.jsx il ataseaza pe sectiunea
 * mapata corespunzatoare (acelasi index) ca `section.reviewFlags`. */
export function deriveReviewFlags(analysis) {
  const aiSections = analysis?.sections || []
  const primaryIdx = pickPrimaryIndex(aiSections)
  const flags = []
  const push = (sectionIndex, reason, detail) => flags.push({ sectionIndex, reason, detail })

  aiSections.forEach((s, i) => {
    const allMovementLists = [s.movements || [], ...(s.scalingVersions || []).map(sv => sv.movements || [])]
    for (const list of allMovementLists) {
      for (const m of list) {
        if (!m.canonicalName) push(i, 'unknown_movement', m.name)
        if (isCardioMovement(m) && m.distance == null && m.calories == null) push(i, 'missing_distance', m.name)
      }
    }

    if (!s.format || !WORKOUT_FORMATS[s.format] || s.format === 'Unrecognized') {
      push(i, 'ambiguous_format', s.format || null)
    } else {
      const translator = FORMAT_CONFIG_TRANSLATORS[s.format]
      const rawConfig = translator ? translator(s.formatConfig || {}) : {}
      const populated = Object.fromEntries(Object.entries(rawConfig).filter(([, v]) => v != null))
      const missing = missingRequiredConfigFields(s.format, populated)
      if (missing.length > 0) push(i, 'needs_review', `config: ${missing.join(', ')}`)

      const weightRelevant = s.scoreType === 'Weight' || getFormat(s.format)?.prEligible
      const anyWeighted = (s.movements || []).some(m => m.weight)
      if (weightRelevant && !anyWeighted) push(i, 'missing_weight', null)
      const rxW = pickVariantWeight(s.movements)
      if (rxW.conflicting) push(i, 'needs_review', 'conflicting weights across movements')
    }

    if (s.benchmarkMetadata?.isBenchmark && !s.benchmarkMetadata?.name) push(i, 'unresolved_benchmark', null)

    for (const sv of s.scalingVersions || []) {
      if (!AI_LEVEL_TO_EDITOR_KEY[sv.level] || !KNOWN_SCALING_KEYS.includes(AI_LEVEL_TO_EDITOR_KEY[sv.level])) {
        push(i, 'needs_review', `unmapped scaling level: ${sv.level}`)
      }
    }
  })

  if (primaryIdx === -1) push(-1, 'needs_review', 'no section detected')
  else if (!aiSections[primaryIdx]?.loggingMode || aiSections[primaryIdx].loggingMode !== 'required') {
    push(primaryIdx, 'needs_review', 'primary section chosen by fallback, not explicitly marked by the parser')
  }

  return flags
}
