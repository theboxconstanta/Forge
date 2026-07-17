// Workout Composer - WORKOUT_COMPOSER_SPEC_v1.md (radacina repo). Transform
// PUR, fara stare: o sectiune (WorkoutSection, forma V2 curenta) -> un
// ComposedWorkout, reprezentarea coach-native ("cum ar scrie-o un antrenor pe
// whiteboard"), gata de consumat de un viitor strat React (nu construit inca -
// vezi spec §8, "Deliberately deferred"). Workout Engine V2 si Workout
// Intelligence raman intacte, neschimbate de acest fisier.
//
// Scop DELIBERAT limitat la sectiuni PRIMARE (section.isPrimary === true) in
// acest prim increment: doar ele poarta `variants[cheie].movements` complet
// populat (sectiunile non-primare/Skill folosesc `movementName`+`text` liber,
// o forma structural diferita - vezi wodSections.js). Extinderea la sectiuni
// non-primare e un increment separat, nu presupus aici.
//
// Niciun import de traduceri (t.xxx) - vezi spec "Language stays out of the
// Composer". `primary.text` foloseste NOTATIA CrossFit universala (AMRAP/FOR
// TIME/EMOM/TABATA...), identica in RO si EN (un coach din Romania spune si
// el "AMRAP", nu o traduce) - nu e "limba" in sensul in care principiul o
// exclude, e vocabular canonic CrossFit, exact ca in exemplele din spec.
// `scoreNote` ramane un COD inchis (nu propozitie gata scrisa) - fraza reala
// se decide la o etapa ulterioara de randare, cu acelasi tipar t.xxx.

import { getFormat, estimateTotalDurationSec } from './workoutFormats'
import { secToTime } from './utils'

// --- hoisting (spec §3 pasul 2) --------------------------------------------

// Un camp de config e "schema comuna de reps" dupa TIPUL lui
// (`repsSchemeList`), nu dupa nume - trateaza `sharedRepScheme` (For Time/
// RFT/Chipper/Ladder) SI `setsScheme` (Strength Sets) identic, fara sa
// enumere formate (spec §7, §9 - "orice cod generic care umbla dupa TIPUL
// campului"). Primul camp populat gasit e folosit (in catalogul de azi,
// niciun format nu are 2 campuri repsSchemeList deodata).
function findConfiguredScheme(fmt, config) {
  for (const [key, def] of Object.entries(fmt.config || {})) {
    if (def.type === 'repsSchemeList' && Array.isArray(config[key]) && config[key].length > 0) {
      return config[key]
    }
  }
  return null
}

// O "schema" poate fi un singur numar ("10 Pull-ups") SAU o secventa
// liniuta-separata ("21-15-9 Thrusters") - conventia de autor deja folosita
// in text liber cand nu exista un camp structurat dedicat (ex. formatele
// compuse - Buy-In/Cash-Out nu are un camp de config pentru schema lucrului
// principal, vezi comentariul de la findConfiguredScheme mai jos in
// composeMixed). Prinde ambele forme cu acelasi regex.
const LEADING_SCHEME_RE = /^(\d+(?:-\d+)*)\s+(.+)$/

// Cauta intai schema STRUCTURATA din config (sursa preferata - vezi
// findConfiguredScheme). Daca nu exista, cauta un prefix numeric IDENTIC pe
// fiecare miscare din lista (necesita cel putin 2 miscari - o singura
// miscare cu prefix numeric, ex. "50 Cal Row" la Buy-In, NU se desparte,
// exact ca in exemplul lucrat din spec §0). Daca nici asta nu se potriveste,
// nu inventeaza nimic - schema ramane null si miscarile raman neatinse.
function hoistScheme(movements, fmt, config) {
  const list = movements || []
  const configScheme = findConfiguredScheme(fmt, config || {})
  if (configScheme) return { scheme: configScheme.join('-'), movements: list }
  if (list.length > 1) {
    const matches = list.map(m => (m || '').match(LEADING_SCHEME_RE))
    if (matches.every(Boolean) && matches.every(m => m[1] === matches[0][1])) {
      return { scheme: matches[0][1], movements: matches.map(m => m[2]) }
    }
  }
  return { scheme: null, movements: list }
}

// --- fraza de identitate (spec §7 - dupa family/scoreMode, niciodata dupa
// numele intern al formatului) ------------------------------------------

function minutesLabel(sec) {
  if (sec == null) return null
  return sec % 60 === 0 ? String(sec / 60) : secToTime(sec)
}

// O schema "creste in fiecare runda" (Ascending AMRAP/Death By/Death By
// Weight) e deja reprezentata STRUCTURAL, prin PREZENTA acestor 2 perechi de
// campuri in config - niciun format fara aceasta conventie de escaladare nu
// le are pe amandoua. Citeste direct campurile (nu numele formatului) - un
// format nou cu aceeasi conventie (startX/incrementX) e recunoscut automat,
// fara nicio schimbare aici. Inlocuieste vechea dependenta de `fmt.ascending`
// (catalog flag folosit azi doar la Ascending AMRAP, nu si la Death By, desi
// ambele au STRUCTURAL aceeasi forma) - flag-ul ramane in workoutFormats.js
// (folosit real in App.jsx/FormatLogger.jsx pt calculul rundelor la logare),
// dar Composer-ul nu mai depinde de el.
function hasEscalatingScheme(config) {
  const cfg = config || {}
  return (cfg.startReps != null && cfg.incrementReps != null) || (cfg.startWeight != null && cfg.incrementWeight != null)
}

// Niciun `formatId === 'X'` mai jos - fiecare ramura citeste un camp de
// config deja existent, cu acelasi inteles peste toate formatele care il
// poarta (vezi comentariul din dreptul fiecarei ramuri pentru DE CE campul
// ales e sursa corecta, nu o coincidenta):
// - `cfg.baseFormat === 'AMRAP'` - Partner WOD e SINGURUL format 'scored'
//   care are un camp `baseFormat`, deci verificarea lui nu prinde niciodata
//   alt format din greseala.
// - `cfg.rounds` - RFT (obligatoriu), For Time (opțional, populat DOAR la
//   structure 'Repeated Rounds' - conventie deja documentata la campul din
//   catalog) si Partner WOD (opțional, populat DOAR la baseFormat 'For
//   Time') folosesc TOATE acelasi camp, cu acelasi inteles ("numarul de
//   runde prescrise") - simpla lui PREZENTA e deja semnalul, fara sa mai
//   trebuiasca stiut care format il poarta.
function archetypeTextForScored(formatId, config) {
  const fmt = getFormat(formatId)
  const cfg = config || {}
  const isAmrap = fmt.scoreMode === 'amrap' || cfg.baseFormat === 'AMRAP'
  if (isAmrap) {
    const dur = minutesLabel(cfg.durationSec ?? cfg.totalDurationSec)
    return dur != null ? `AMRAP ${dur}` : 'AMRAP'
  }
  if (fmt.scoreMode === 'single_value') return 'MAX EFFORT'
  if (cfg.rounds) return `${cfg.rounds} ROUNDS FOR TIME`
  return 'FOR TIME'
}

// Idem - niciun `formatId === 'X'` mai jos:
// - `cfg.totalRounds` - doar EMOM are acest camp (Tabata/Intervals au
//   `rounds`, nu `totalRounds`) - prezenta lui identifica exact forma "runda
//   fixa la fiecare interval", indiferent de numele formatului.
// - `hasEscalatingScheme` - vezi mai sus, aceeasi sursa ca la scoreNote.
// - fallback-ul generic (`formatId.toUpperCase()`) acopera Tabata/Intervals
//   FARA sa le distinga explicit intre ele - numele lor DEJA e cuvantul
//   corect de whiteboard ("TABATA"/"INTERVALS"), la fel ca "AMRAP"/"EMOM" -
//   nu exista NICIUN camp care sa le deosebeasca structural azi (config
//   identic: rounds+workSec+restSec+scoringMode), deci nu exista nimic de
//   citit generic - fallback-ul e deja raspunsul corect, nu o aproximare.
function archetypeTextForSets(formatId, config, strippedMovements) {
  const fmt = getFormat(formatId)
  const cfg = config || {}
  if (fmt.rowMode === 'interval') {
    if (cfg.totalRounds != null) {
      const totalSec = estimateTotalDurationSec(formatId, cfg)
      const dur = minutesLabel(totalSec)
      return dur != null ? `EMOM ${dur}` : 'EMOM'
    }
    if (hasEscalatingScheme(cfg)) return 'DEATH BY'
    return (formatId || '').toUpperCase()
  }
  // rowMode 'round' - azi doar 'Complex'. "6 SETS" (din config.rounds), NU
  // cuvantul "Complex" (nume intern, interzis explicit de spec §7).
  if (fmt.rowMode === 'round') return cfg.rounds ? `${cfg.rounds} SETS` : 'SETS'
  // rowMode 'movement' - Strength Sets/Weightlifting/Build to Heavy/Superset:
  // capul de afis e miscarea insasi (spec §7 - "BACK SQUAT"), nu numele
  // formatului. Schema (daca exista) ramane la nivel de bloc.
  return strippedMovements.length > 0 ? strippedMovements.join(' & ') : (formatId || '')
}

// --- un bloc simplu, cu o singura "runda" de miscari -----------------------

function singleBlock(movements, fmt, config) {
  const { scheme, movements: stripped } = hoistScheme(movements, fmt, config)
  return { block: { role: 'main', weight: 'primary', scheme, movements: stripped, transitionBefore: null, restSeconds: null }, stripped }
}

// --- family: 'scored' (AMRAP/For Time/RFT/Chipper/Ladder/Partner WOD/Max
// Effort) - un singur bloc ------------------------------------------------

function composeScored(section, fmt, config, movements, identity) {
  const { block } = singleBlock(movements, fmt, config)
  const primaryText = archetypeTextForScored(section.format, config)
  // Ascending AMRAP/Death By (vezi mai jos, family 'sets') au o conventie de
  // scor care nu reiese din titlu (runde de marime CRESCATOARE, nu fixa) -
  // exceptia ingusta din Core Principle (scoreNote). hasEscalatingScheme
  // citeste direct campurile de config (nu formatId) - vezi comentariul ei.
  const scoreNote = hasEscalatingScheme(config) ? 'ascending-rounds' : null
  return { identity, primary: { text: primaryText }, blocks: [block], scoreNote }
}

// --- family: 'sets' (EMOM/Tabata/Intervals/Death By/Strength Sets/
// Weightlifting/Build to Heavy/Complex/Superset) - un singur bloc ----------

function composeSets(section, fmt, config, movements, identity) {
  const { block, stripped } = singleBlock(movements, fmt, config)
  const primaryText = archetypeTextForSets(section.format, config, stripped)
  // Omite ce deja spune titlul (spec §3 pasul 5): la rowMode 'movement' fara
  // alt cuvant de arhetip, primary.text E chiar numele miscarii (ex. "Back
  // Squat") - daca blocul are exact ACEEASI miscare, unica, randarea ei si ca
  // linie de miscare n-ar adauga nimic, doar ar dubla titlul ("Back Squat" /
  // "Back Squat", gasit live la validare pe "Clean The Floor"/"GET UP").
  const finalBlock = (stripped.length === 1 && stripped[0] === primaryText) ? { ...block, movements: [] } : block
  const scoreNote = hasEscalatingScheme(config) ? 'death-by-escalating' : null
  return { identity, primary: { text: primaryText }, blocks: [finalBlock], scoreNote }
}

// --- family: 'nft' (Not For Time) - un singur bloc, fara scor -------------

function composeNft(section, fmt, config, movements, identity) {
  const { block } = singleBlock(movements, fmt, config)
  return { identity, primary: { text: 'NOT FOR TIME' }, blocks: [block], scoreNote: null }
}

// --- family: 'mixed' (Buy-In/Cash-Out, AMRAP with Buy-In) - 2-3 blocuri ---
//
// Distinctie intre cele 2 forme DUPA CE CAMPURI SUNT PREZENTE (nu dupa
// numele formatului) - Buy-In/Cash-Out are `mainFormat`, AMRAP with Buy-In
// are `totalDurationSec` in loc (vezi memoria "family alone e prea larg").
//
// Nota reala: niciun format din familia 'mixed' n-are un camp de config
// dedicat pentru schema lucrului principal (spre deosebire de For Time/RFT/
// Chipper/Ladder, care au `sharedRepScheme`) - "21-15-9" din exemplul lucrat
// al spec-ului (§0) exista DOAR daca antrenorul a scris-o direct in textul
// miscarii ("21-15-9 Thrusters"), caz prins de fallback-ul cu prefix comun
// din hoistScheme (LEADING_SCHEME_RE). Daca miscarile sunt scrise fara
// prefix, scheme ramane null - nu se inventeaza.
function composeMixed(section, fmt, config, movements, identity) {
  const cfg = config || {}
  const buyIn = Array.isArray(cfg.buyIn) ? cfg.buyIn : []
  const cashOut = Array.isArray(cfg.cashOut) ? cfg.cashOut : []
  const hasMainFormatField = cfg.mainFormat != null
  const blocks = []

  if (buyIn.length > 0) {
    const { scheme, movements: stripped } = hoistScheme(buyIn, fmt, cfg)
    blocks.push({ role: 'buy-in', weight: 'secondary', scheme, movements: stripped, transitionBefore: null, restSeconds: null })
  }

  const { scheme: mainScheme, movements: mainStripped } = hoistScheme(movements, fmt, cfg)
  blocks.push({
    role: 'main', weight: 'primary', scheme: mainScheme, movements: mainStripped,
    transitionBefore: buyIn.length > 0 ? 'then' : null, restSeconds: null,
  })

  if (cashOut.length > 0) {
    const { scheme, movements: stripped } = hoistScheme(cashOut, fmt, cfg)
    blocks.push({ role: 'cash-out', weight: 'secondary', scheme, movements: stripped, transitionBefore: 'then', restSeconds: null })
  }

  const primaryText = hasMainFormatField
    ? archetypeTextForScored(cfg.mainFormat, {})
    : (() => { const dur = minutesLabel(cfg.totalDurationSec); return dur != null ? `AMRAP ${dur}` : 'AMRAP' })()

  return { identity, primary: { text: primaryText }, blocks, scoreNote: null }
}

// --- family: 'chained' (Chained AMRAP) - o etapa = un bloc, niciodata
// reunite intr-o singura lista plata (garanteaza pe partea de output ce a
// reparat deja fix-ul Chained AMRAP pe partea de input, WI roadmap item 5) -

function composeChained(section, fmt, config, identity) {
  const stages = Array.isArray(config?.stages) ? config.stages : []
  const blocks = stages.map((stage, i) => {
    const { scheme, movements } = hoistScheme(stage.movements || [], fmt, {})
    return {
      role: 'stage', weight: 'primary', scheme, movements,
      transitionBefore: i === 0 ? null : 'straight-into',
      restSeconds: null,
    }
  })
  const primaryText = stages.length > 0 ? `${stages.length} STAGE${stages.length === 1 ? '' : 'S'}` : 'CHAINED AMRAP'
  // Conventia de scor (suma reps pe toate etapele) nu reiese din titlu -
  // exceptia ingusta scoreNote din Core Principle.
  return { identity, primary: { text: primaryText }, blocks, scoreNote: stages.length > 0 ? 'chained-total-reps' : null }
}

// --- punct unic de intrare ---------------------------------------------

/**
 * WorkoutSection (forma V2 curenta, sectiune PRIMARA) -> ComposedWorkout.
 * `variantKey` - una din cheile VARIANTE_WEIGHT_BASE ('rx'/'intermediate'/
 * 'beginner'/'onramp'). Pur, fara stare, fara efecte - vezi header-ul
 * fisierului pt limitele de scop ale acestui increment.
 *
 * ComposedWorkout = {
 *   identity: { name: string|null },
 *   primary: { text: string },
 *   blocks: Array<{
 *     role: 'buy-in'|'cash-out'|'main'|'stage',
 *     weight: 'primary'|'secondary',
 *     scheme: string|null,
 *     movements: string[],
 *     transitionBefore: 'then'|'straight-into'|null,
 *     restSeconds: number|null,
 *   }>,
 *   scoreNote: string|null,   // cod inchis, fraza reala decisa la randare
 * }
 */
export function composeSection(section, variantKey) {
  const format = section?.format
  if (!format) return { identity: { name: null }, primary: { text: '' }, blocks: [], scoreNote: null }

  const fmt = getFormat(format)
  const config = section?.formatConfig || {}
  const movements = section?.variants?.[variantKey]?.movements || []
  const identity = { name: (section?.name || '').trim() || null }

  if (fmt.family === 'mixed') return composeMixed(section, fmt, config, movements, identity)
  if (fmt.family === 'chained') return composeChained(section, fmt, config, identity)
  if (fmt.family === 'sets') return composeSets(section, fmt, config, movements, identity)
  if (fmt.family === 'nft') return composeNft(section, fmt, config, movements, identity)
  return composeScored(section, fmt, config, movements, identity)
}
