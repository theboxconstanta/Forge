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
import { resolveAthleteGenderKey } from './rxEngine'
import { classifyRxStatus } from './rxEngine'
import { resolveMovementCapability } from './prescriptionContract'

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
  // INC-11 - AMRAP is a TIME ENVELOPE, not a progression structure. `structure`
  // is the explicit discriminator (same concept + same canonical vocabulary as
  // For Time's `structure`): 'Repeated Rounds' (classic - repeat the round list
  // until the clock expires, scored Rounds + Additional Reps) vs 'Sequence' (a
  // finite ordered pass - buy-in / chipper / buy-in + max-reps tail - scored as
  // ordered station progress + Total Reps). ABSENT = 'Repeated Rounds' (every
  // legacy AMRAP; `required:false`, never inferred from movement text - INC-11
  // §31/§65). Member display suppresses it (MEMBER_SUPPRESSED_FIELDS).
  'AMRAP': {
    family: 'scored', scoreMode: 'amrap',
    config: {
      durationSec: { type: 'duration', required: true, labelKey: 'fmtDuration' },
      structure: { type: 'select', options: ['Sequence', 'Repeated Rounds'], required: false, default: 'Repeated Rounds', labelKey: 'fmtAmrapStructure' },
    },
  },
  // AMRAP cu runde care cresc (ex. "AVALANCHE": 3-3, 6-6, 9-9... burpees si
  // deadlifts, +3 la fiecare runda) - gasit deja programat manual la aceasta
  // sala, prin retiparea intregii secvente in miscari (movements_rx cu 6+
  // randuri de tipul "3 burpee...", "6 burpee..."), inconsecvent de la o
  // logare la alta (typo-uri, variante diferite ale numelui miscarii). Bug
  // real gasit in datele existente (07-15): UI-ul de logare arata mereu
  // tinta STATICA a primei runde scrise (3), nu tinta reala a rundei curente
  // (ex. runda 6 are 18) - rezultate confuze/gresite ("2/3 burpees" cand ar
  // fi trebuit sa fie "X/18"). Cu acest format, antrenorul scrie miscarile
  // O SINGURA DATA (fara numere), iar tinta per runda se calculeaza automat
  // (startReps + incrementReps * (runda-1)) - vezi repsForAscendingRound.
  'Ascending AMRAP': {
    family: 'scored', scoreMode: 'amrap', ascending: true,
    config: {
      durationSec: { type: 'duration', required: true, labelKey: 'fmtDuration' },
      startReps: { type: 'number', required: true, default: 3, labelKey: 'fmtStartReps' },
      incrementReps: { type: 'number', required: true, default: 3, labelKey: 'fmtIncrementReps' },
    },
  },
  // "For Time" poate insemna 2 lucruri diferite: o secventa unica de miscari
  // distincte (ex. "TO THE SKY": 15-12-9-6-3 - "runde complete" nu are sens
  // aici) SAU runde repetate din aceleasi miscari (ex. "7 rounds for time
  // of: ..." - identic cu RFT, doar numit "For Time" de admin). config.structure
  // marcheaza explicit care caz e - vezi isSequentialFormat mai jos, singura
  // sursa de adevar (nu mai citi direct .sequentialPartial static, poate fi
  // gresit pt "Repeated Rounds"). Sequence: daca nu termini in time cap,
  // loghezi direct cate repetari ai facut la FIECARE miscare din lista (nu
  // doar "runda partiala" a unei runde repetate) - vezi FormatLogger.
  'For Time': {
    family: 'scored', scoreMode: 'fortime_or_amrap', sequentialPartial: true,
    config: {
      structure: { type: 'select', options: ['Sequence', 'Repeated Rounds'], required: true, default: 'Sequence', labelKey: 'fmtForTimeStructure' },
      // Opțional, relevant doar la structura "Repeated Rounds" (identic cu
      // RFT) - vezi composeFinishedRoundsText mai jos si comentariul de la
      // 'RFT'.rounds pt motiv.
      rounds: { type: 'number', required: false, labelKey: 'fmtRoundsCount' },
      timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' },
      // Schema comuna de reps pe runda (ex. 21-15-9) - vezi comentariul de la
      // 'Ladder'.sharedRepScheme mai jos pentru istoricul deciziei. Cele mai
      // cunoscute benchmark-uri cu scheme descrescatoare (Fran, Annie) sunt
      // taggate 'For Time', nu 'Ladder' (vezi prompt.ts) - fara acest camp,
      // Workout Composer n-ar avea de unde sa afiseze "21-15-9" ca titlu.
      sharedRepScheme: { type: 'repsSchemeList', required: false, labelKey: 'fmtSharedRepScheme', quickOptions: REP_SCHEME_QUICK_OPTIONS },
    },
  },
  // rounds: numarul prescris de runde e mereu cunoscut dinainte (config), nu
  // ceva ce membrul trebuie sa retina/scrie de mana la logare - a termina =
  // a facut toate rundele prescrise, prin definitie. Bug real gasit (07-15):
  // fara asta, campul "Rezultat" de la un RFT terminat era text liber (cu
  // un placeholder-hint "ex: 18 runde complete"), iar cineva a scris doar
  // "5" - afisat ambiguu pe Jurnal/Clasament ca "5 · 9:33" langa timp, fara
  // unitate. Vezi composeFinishedRoundsText - deriva automat "N runde
  // complete" din config.rounds, fara sa mai ceara input manual la finisheri.
  'RFT': {
    family: 'scored', scoreMode: 'fortime_or_amrap',
    config: {
      rounds: { type: 'number', required: true, labelKey: 'fmtRoundsCount' },
      timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' },
      sharedRepScheme: { type: 'repsSchemeList', required: false, labelKey: 'fmtSharedRepScheme', quickOptions: REP_SCHEME_QUICK_OPTIONS },
    },
  },
  // O secventa de miscari distincte facute o singura data ("chip away" prin
  // lista) - structural identic cu 'For Time' (structura Sequence), doar
  // pastrat ca id separat (nu redenumit, date deja salvate). Bug real gasit
  // (07-15, la o verificare sistematica): scoreMode 'fortime' (nu
  // 'fortime_or_amrap') nu era prins de NICIO ramura din ScoredFields -
  // cadea pe fallback-ul generic (doar Timp + text liber), fara nicio
  // urmarire structurata a repetarilor la un DNF, desi Chipper are deja
  // time cap configurabil (deci un DNF e un caz real, nu ipotetic). Acelasi
  // scoreMode/sequentialPartial ca 'For Time' rezolva exact aceeasi
  // problema deja rezolvata acolo, fara cod nou.
  'Chipper': {
    family: 'scored', scoreMode: 'fortime_or_amrap', sequentialPartial: true,
    config: {
      timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' },
      sharedRepScheme: { type: 'repsSchemeList', required: false, labelKey: 'fmtSharedRepScheme', quickOptions: REP_SCHEME_QUICK_OPTIONS },
    },
  },
  'Ladder': {
    // La fel ca "For Time": o schema 21-15-9 e tot o secventa, nu runde
    // repetate - sequentialPartial: daca nu termini, loghezi direct
    // repetarile facute la fiecare treapta a scarii.
    family: 'scored', scoreMode: 'fortime_or_amrap', sequentialPartial: true,
    config: {
      // Migrat de la text liber ("21-15-9") la array structurat (Workout
      // Composer, 2026-07-17) - acelasi concept generic ca For Time/RFT/
      // Chipper.sharedRepScheme mai sus, acum sub un singur nume/tip in tot
      // catalogul in loc de un camp "repsScheme" specific doar Ladder-ului.
      // quickOptions: scheme clasice reutilizate des (21-15-9 etc), afisate ca
      // chip-uri - vezi FormatConfigEditor (RepsSchemeListField).
      sharedRepScheme: { type: 'repsSchemeList', required: false, labelKey: 'fmtSharedRepScheme', quickOptions: REP_SCHEME_QUICK_OPTIONS },
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
      // Opțional, relevant doar la baseFormat "For Time" cu runde repetate -
      // vezi comentariul de la 'RFT'.rounds.
      rounds: { type: 'number', required: false, labelKey: 'fmtRoundsCount' },
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
      // Optional (spre deosebire de Tabata/Intervals, unde e obligatoriu) -
      // multe EMOM-uri sunt centrate pe greutate (fallback-ul existent,
      // maxWeightFromSets, ramane corect pt ele daca acest camp nu e setat).
      // Dar un EMOM pur pe repetari (ex. "EMOM 10: 5 Burpees", fara greutate
      // deloc) cadea pe acelasi fallback, care returneaza null - Clasament il
      // arata neclasat ("-"), exact bug-ul deja reparat la Tabata/Build to
      // Heavy dar niciodata extins la EMOM. Cu campul optional, adminul poate
      // alege explicit scorarea pe reps pt EMOM-urile care chiar au nevoie.
      scoringMode: { type: 'select', options: ['Total Reps', 'Lowest Reps'], required: false, labelKey: 'fmtIntervalScoring' },
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
  // INC-07 - STRUCTURED per-interval Intervals. The coach authors roundCount
  // (real repeated rounds), workSec, restSec + a per-variant station list; the
  // save path derives the legacy `rounds` (= roundCount × stationCount) and
  // stamps `stationMode:'per-interval'` / `restPlacement:'after-each-station'`
  // for readers. `rounds` is NOT a schema field any more (never authored) but
  // legacy rows that still carry it keep rendering/logging flat (INC-07 §21) -
  // resolveIntervalStructure gates structured mode on the stored stationMode.
  'Intervals': {
    family: 'sets', rowMode: 'interval',
    simpleReps: true,
    config: {
      roundCount: { type: 'number', required: true, labelKey: 'fmtRounds' },
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
  // NEredenumit 'sharedRepScheme' (spre deosebire de Ladder/For Time/RFT/
  // Chipper mai jos/sus) - Strength Sets e un format mult mai stabilit, o
  // migrare doar de dragul numelui n-a meritat riscul (WI Composer, decizie
  // 2026-07-17). Aceeasi forma (`repsSchemeList`), acelasi concept - orice
  // cod generic care umbla dupa TIPUL campului (nu numele lui) trateaza
  // `setsScheme` ca alias al lui `sharedRepScheme`.
  'Strength Sets': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: {
      setsScheme: { type: 'repsSchemeList', required: true, labelKey: 'fmtSetsScheme' },
    },
  },
  'Build to Heavy/1RM': {
    family: 'sets', rowMode: 'movement', prEligible: true,
    config: { targetLabel: { type: 'repMaxStepper', required: false, default: '1RM', labelKey: 'fmtTargetLabel' } },
  },
  'Complex': {
    family: 'sets', rowMode: 'round', prEligible: true,
    config: {
      complexMovements: { type: 'movementList', required: true, labelKey: 'fmtComplexMovements' },
      rounds: { type: 'number', required: true, labelKey: 'fmtRoundsAttempts' },
      // Optional (ca la EMOM, nu obligatoriu ca la Tabata) - un Complex tipic
      // (ex. "Build to a 3-rep-max front squats") ramane corect pe fallback-ul
      // existent (maxWeightFromSets = cea mai grea runda). Dar un EMOM-complex
      // cu greutate DIFERITA per interval (ex. gasit pe BTWB la insusi acest
      // sala: "Every 2 mins for 10 mins: Thrusters, Push Press, Front Squats",
      // 20/30/40/40/40kg) e scorat acolo ca SUMA greutatilor peste runde
      // (170kg), nu doar cea mai grea (40kg) - fara acest camp, Forge arunca
      // silentios cea mai mare parte din munca depusa.
      scoringMode: { type: 'select', options: ['Max Weight', 'Total Weight'], required: false, labelKey: 'fmtComplexScoring' },
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
  // WOD-uri "straight into" (ex. "AMRAP 2 max reps deadlifts, straight into
  // AMRAP 19 cu 4 miscari, straight into AMRAP 2 din nou") - gasit real la
  // aceasta sala (si pe BTWB, "Jack's Triangle") si imposibil de reprezentat
  // in vreun format existent (toate au o singura "forma" fixa). O etapa poate
  // fi 'amrap' (runde+reps partiale, exact ca AMRAP - "max reps dintr-o
  // singura miscare" e doar cazul degenerat, o miscare fara prefix numeric)
  // sau 'interval' (randuri reps/greutate per interval, exact ca EMOM) -
  // acopera orice WOD real de conditionare cu etape inlantuite. Etape bazate
  // pe timp (For Time) sunt scoase din scop deliberat - un scor total "reps"
  // n-are sens langa o etapa cronometrata; se adauga daca apare un WOD real
  // cu asa ceva, nu presupus dinainte.
  'Chained AMRAP': {
    family: 'chained',
    config: {
      stages: { type: 'stageList', required: true, labelKey: 'fmtStages' },
    },
  },
  'Max Effort': {
    family: 'scored', scoreMode: 'single_value',
    config: { movement: { type: 'movementText', required: false, labelKey: 'fmtMovementTest' } },
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

// INC-14 - UNIVERSAL PARTIAL RESULT INTEGRITY. For a plain sequential For
// Time/Chipper/Ladder/Buy-In-Cash-Out (isSequentialFormat, NOT Sequence AMRAP
// - that has its own station-object model in sequentialAmrap.js), derives the
// EFFECTIVE per-movement reps from the athlete's raw partial-input array.
//
// A blank/untouched station must NEVER be read as completed work - it means
// "not reached", never "assume they did all of it". Mirrors
// autoCompleteSequentialProgress's own rule (INC-11 §15) on this plain-text
// model: only a station STRICTLY BEFORE the furthest station the athlete
// actually touched is inferred complete (reaching station N implies every
// earlier one was necessarily cleared to reach it, per the sequential
// contract); every station AT or AFTER the furthest touched index keeps its
// raw value untouched - blank stays blank (omitted by composePartialText,
// "not reached"), an explicit "0" stays "0" (INC-11.1 owner decision #3).
//
// Previously this backfilled EVERY blank station, regardless of position,
// with its prescribed target parsed from the movement text - so "12" at
// station 1 with every later station left blank silently became
// "12/21/15/15/9/9" (the programmed workout), not the athlete's actual
// 12-unit progress. Only the FIRST layer (this function) manufactured work;
// composePartialText / partialRepsOfLog / sequentialProgressionDeparted
// downstream were always correct once given a truthful effective array.
export function repsEfectiveSecvential(partialReps, movements) {
  const perf = movements.map((_, i) => {
    const v = (partialReps || [])[i]
    return v != null ? String(v) : ''
  })
  let furthest = -1
  perf.forEach((v, i) => { if (v.trim() !== '') furthest = i })
  return movements.map((m, i) => {
    if (perf[i].trim() !== '') return perf[i]
    if (i >= furthest) return ''
    const prescrisMatch = m.match(/^(\d+)\s+/)
    return prescrisMatch ? prescrisMatch[1] : ''
  })
}

// Genereaza textul "3 runde + 5 Pull-ups, 10 Push-ups" dintr-un numar de
// runde complete + reps partiale per miscare. Genericul din spatele lui
// composeAmrapResult() din App.jsx.
// Cand textul miscarii are deja un numar la inceput (uzual la AMRAP scrise ca
// scara descrescatoare - "15 Power Snatches", "12 Power Snatches"...), a pune
// pur si simplu reps-ul partial inaintea textului producea dublari confuze
// ("15 15 Power Snatches"). In cazul asta aratam "facut/prescris" ("3/15
// Power Snatches") - fara ambiguitate, indiferent daca a terminat miscarea
// integral sau nu ("15/15 Power Snatches" = a facut-o pe toata).
export function composePartialText(partialArr, movements) {
  return movements
    .map((m, i) => {
      const val = partialArr[i]?.trim()
      if (!val) return null
      const cuNumar = m.match(/^(\d+)\s+(.+)$/)
      return cuNumar ? `${val}/${cuNumar[1]} ${cuNumar[2]}` : `${val} ${m}`
    })
    .filter(Boolean).join(', ')
}

export function parsePartialText(text, movements) {
  const partialArr = movements.map(() => '')
  ;(text || '').split(',').forEach(seg => {
    const trimmed = seg.trim()
    const cuNumar = trimmed.match(/^(\d+)\/(\d+)\s+(.+)$/)
    if (cuNumar) {
      const idx = movements.indexOf(`${cuNumar[2]} ${cuNumar[3]}`.trim())
      if (idx !== -1) { partialArr[idx] = cuNumar[1]; return }
    }
    // Compatibilitate cu rezultate vechi, deja salvate inainte de acest fix
    // (fara "/", numarul dublat direct in fata textului miscarii).
    const simplu = trimmed.match(/^(\d+)\s+(.+)$/)
    if (simplu) { const idx = movements.indexOf(simplu[2].trim()); if (idx !== -1) { partialArr[idx] = simplu[1]; return } }
    // P9.5.1 - the "N runde + M" plain form (Universal Log WOD single
    // "additional reps"): a lone number with no movement name -> attribute the
    // whole partial to the first movement so composeAmrapResult re-emits an
    // equal sum on edit. partialRepsOfLog reads the same total either way.
    const lone = trimmed.match(/^(\d+(?:\.\d+)?)$/)
    if (lone && movements.length > 0 && partialArr.every(v => !v)) partialArr[0] = lone[1]
  })
  return partialArr
}

export function composeAmrapResult(roundsCompleted, partialArr, movements) {
  if (!(roundsCompleted || '').toString().trim()) return ''
  const partialStr = composePartialText(partialArr, movements)
  return `${roundsCompleted.toString().trim()} runde${partialStr ? ' + ' + partialStr : ' complete'}`
}

// LEADERBOARD_FINISH_TIME_INVESTIGATION.md - la formatele scoreMode
// 'fortime_or_amrap' NEsecventiale (RFT, For Time cu structure 'Repeated
// Rounds', Partner WOD), FormatLogger arata simultan campul de Timp SI campul
// de Runde complete - un membru care a terminat scrie firesc numarul de runde
// SI timpul lui. Bug real gasit (confirmat pe date live): campul de Runde
// avea prioritate necontitionata, stergand silentios un Timp valid introdus
// in acelasi log (time_result salvat null desi membrul chiar terminase).
// Timpul introdus e mereu autoritar - Runde complete ramane calea de logare
// DOAR cat timp Timpul e gol (membru neterminat/capped). Aplicata atat in
// calea de scriere (composeWodLogFields), ca protectie indiferent de sursa
// payload-ului (client vechi, bundle cache stricat), cat si in UI
// (FormatLogger.ScoredFields), care acum ascunde campul de Runde complete de
// indata ce Timpul are o valoare, in loc sa se bazeze doar pe un text de hint.
export function shouldLogRoundsInsteadOfTime(wodTime, wodRoundsCompleted) {
  return !(wodTime || '').toString().trim() && !!(wodRoundsCompleted || '').toString().trim()
}

// SCORING_MODEL_ARCHITECTURE_VNEXT.md sectiunea 11 (Completion State, Faza 0)
// - starea de finalizare a unui rezultat Duration-based (a terminat sau a
// fost oprit de time cap) nu mai e doar o regula implicita (dedusa la citire
// din prezenta/absenta lui time_result) - e calculata O SINGURA DATA, chiar
// la punctul unde scrierea decide oricum intre "a terminat" si "capped/
// neterminat" (acelasi `hasTime` boolean care alege deja intre cele doua
// ramuri mai jos SI in ramura secventiala din App.jsx), niciodata re-dedusa
// separat dintr-un payload deja compus - asta face imposibil structural ca
// completion_state sa contrazica time_result, fara nicio validare separata.
// Doar 'completed'/'capped' sunt scrise de vreo cale de cod curenta - 'dnf'/
// 'dns' raman in vocabular doar pt compatibilitate inainte (nu exista azi un
// flux UI care sa produca un log complet gol, vezi `areContiut` in App.jsx).
// Parametrul e boolean-ul de ramura DEJA calculat la locul de apel
// (shouldLogRoundsInsteadOfTime pt nesecvential, useReps pt secvential) - nu
// re-verifica time_result separat, ca sa nu existe a doua sursa de adevar
// care ar putea vreodata sa contrazica ramura care a compus deja rezultatul.
export function deriveDurationCompletionState(isCapped) {
  return isCapped ? 'capped' : 'completed'
}

// LEADERBOARD_FINISH_TIME_INVESTIGATION.md / SCORING_MODEL_ARCHITECTURE_
// VNEXT.md sectiunea 8 (Defensive Validation) - normalizeaza completion_state
// la granita de scriere (nu respinge salvarea - un membru nu trebuie
// niciodata blocat de o verificare interna). Aplicata dupa TOATE ramurile
// din composeWodLogFields, indiferent care a produs rezultatul - protectie
// impotriva unui client vechi/bundle cache stricat care ar putea vreodata
// trimite time_result si completion_state in dezacord; corecteaza silentios
// completion_state sa fie mereu consecvent cu time_result (singura sursa
// reala de adevar pt "a terminat" la formatele Duration-based), fara sa
// modifice scorul propriu-zis.
export function normalizeCompletionState(fields) {
  if (fields.completion_state == null) return fields
  const consistent = deriveDurationCompletionState(!fields.time_result)
  return fields.completion_state === consistent ? fields : { ...fields, completion_state: consistent }
}

// Compune result/time_result/completion_state pt un log 'fortime_or_amrap'
// NEsecvential (RFT, For Time cu structure 'Repeated Rounds', Partner WOD) -
// extras din composeWodLogFields (App.jsx) ca sa fie testabil izolat de
// restul formularului React, per LEADERBOARD_FINISH_TIME_INVESTIGATION.md
// sectiunea 9. Comportament IDENTIC cu ramurile echivalente ale lantului
// useReps generic pt acest subset de formate (isSequential e mereu fals si
// format.ascending nu exista niciodata la scoreMode 'fortime_or_amrap', deci
// nimic din logica generica se aplica diferit aici) - singura schimbare reala
// e ca Timpul introdus e acum garantat autoritar peste Runde completate
// manual (shouldLogRoundsInsteadOfTime), indiferent de sursa payload-ului.
export function composeFortimeOrAmrapFields({ wodTime, wodRoundsCompleted, wodPartialReps, movements, rounds, wodResult, wodAdditionalReps }) {
  if (shouldLogRoundsInsteadOfTime(wodTime, wodRoundsCompleted)) {
    // P9.5.1 - the Universal Log WOD "Time Capped" input collects ONE
    // "additional reps" number (not a per-movement breakdown). When present,
    // compose the plain "N runde + M" form. parseRoundsScore() -> N and
    // partialRepsOfLog() -> M both read it unchanged (it is a simpler subset of
    // the existing result grammar), so leaderboard order is identical. The
    // per-movement composeAmrapResult path stays for the FormatLogger flows.
    const result = wodAdditionalReps !== undefined
      ? composeCappedRoundsResult(wodRoundsCompleted, wodAdditionalReps)
      : (composeAmrapResult(wodRoundsCompleted, wodPartialReps, movements) || null)
    return { result: result || null, time_result: null, completionState: deriveDurationCompletionState(true) }
  }
  const finishedRoundsText = composeFinishedRoundsText(rounds)
  const time = (wodTime || '').toString().trim()
  return { result: (finishedRoundsText ?? (wodResult || '').toString().trim()) || null, time_result: time || null, completionState: deriveDurationCompletionState(false) }
}

// P9.5.1 - "2 full rounds + 43 additional reps" -> "2 runde + 43". No additional
// reps -> "N runde complete" (matches composeFinishedRoundsText for finishers).
export function composeCappedRoundsResult(roundsCompleted, additionalReps) {
  const r = (roundsCompleted ?? '').toString().trim()
  if (!r) return ''
  const a = (additionalReps ?? '').toString().trim()
  return a && parseFloat(a) > 0 ? `${r} runde + ${a}` : `${r} runde complete`
}

// Inverse, for re-opening a capped result in the editor. Reads the plain
// "N runde + M" form AND the legacy per-movement "N runde + 43/12 X, ..." form
// (additional = summed partial, same as partialRepsOfLog).
export function parseCappedRoundsResult(resultStr) {
  const s = (resultStr || '').toString()
  const roundsMatch = s.match(/^(\d+)/)
  const rounds = roundsMatch ? roundsMatch[1] : ''
  const plusIdx = s.indexOf('+')
  let additional = ''
  if (plusIdx !== -1) {
    const seg = s.slice(plusIdx + 1)
    const sum = seg.split(',').reduce((acc, part) => {
      const m = part.trim().match(/^(\d+(\.\d+)?)/)
      return m ? acc + parseFloat(m[1]) : acc
    }, 0)
    if (sum > 0) additional = String(sum)
  }
  return { rounds, additional }
}

// Text de rezultat pt un log 'fortime_or_amrap' TERMINAT (are Timp) la un
// format cu config.rounds cunoscut (RFT, sau For Time/Partner WOD cu runde
// repetate) - vezi comentariul de la 'RFT'.rounds mai sus. null (nu string
// gol) daca nu exista un numar de runde configurat, ca sa poata fi distins
// de "0 runde" si sa cada pe fallback-ul de text liber la locul de apel.
export function composeFinishedRoundsText(rounds) {
  const n = parseInt(rounds)
  if (!n) return null
  return `${n} runde complete`
}

export function parseAmrapResult(resultStr, movements) {
  const roundsMatch = (resultStr || '').match(/^(\d+)/)
  const plusIdx = (resultStr || '').indexOf('+')
  const partialArr = plusIdx !== -1 ? parsePartialText(resultStr.slice(plusIdx + 1), movements) : movements.map(() => '')
  return { rounds: roundsMatch ? roundsMatch[1] : '', partialArr }
}

// --- AMRAP ascendent (runde care cresc, ex. "AVALANCHE": 3-3, 6-6, 9-9...) --

export function repsForAscendingRound(round, startReps, incrementReps) {
  const start = parseInt(startReps) || 0
  const inc = parseInt(incrementReps) || 0
  return start + inc * (Math.max(1, round) - 1)
}

// Reconstruieste lista de "miscari" (nume de baza, fara numere - vezi
// catalogul) cu reps-ul corect prescris pt runda data, refolosind
// composePartialText/parsePartialText existente FARA nicio modificare -
// acelea deja stiu sa formateze "facut/prescris Miscare" cand textul
// miscarii incepe cu un numar (vezi composePartialText mai sus).
export function ascendingMovementsForRound(baseMovements, round, startReps, incrementReps) {
  const reps = repsForAscendingRound(round, startReps, incrementReps)
  return (baseMovements || []).map(m => `${reps} ${m}`)
}

// Parsare in 2 pasi a unui rezultat deja salvat: runda partiala (deci
// reps-ul corect prescris pt fiecare miscare) depinde de roundsCompleted,
// care se afla abia dupa un prim parse - vezi bug-ul real gasit in datele
// existente (07-15, "AVALANCHE"): fara asta, UI-ul de editare/afisare ar
// aplica mereu tinta STATICA a rundei 1, exact greseala pe care acest
// format o repara.
export function parseAscendingAmrapResult(resultStr, baseMovements, startReps, incrementReps) {
  const { rounds } = parseAmrapResult(resultStr, baseMovements)
  const roundsNum = parseInt(rounds) || 0
  const currentRoundMovements = ascendingMovementsForRound(baseMovements, roundsNum + 1, startReps, incrementReps)
  const { partialArr } = parseAmrapResult(resultStr, currentRoundMovements)
  return { rounds, partialArr, currentRoundMovements }
}

// Suma reala de reps acumulate - runde complete (fiecare cu marimea ei,
// per miscare) + reps partiale in runda curenta neterminata. Scorul de
// clasat/afisat: "12 runde" nu e comparabil direct intre doi oameni (fiecare
// runda are alta marime), dar "165 reps" da.
export function totalRepsAscendingAmrap(roundsCompleted, partialArr, movementsCount, startReps, incrementReps) {
  const rounds = parseInt(roundsCompleted) || 0
  let total = 0
  for (let r = 1; r <= rounds; r++) total += repsForAscendingRound(r, startReps, incrementReps) * movementsCount
  ;(partialArr || []).forEach(v => { const n = parseInt(v); if (!Number.isNaN(n)) total += n })
  return total
}

// --- WOD-uri inlantuite (etape 'amrap'/'interval' legate "straight into") --

// Suma reps-urilor PRESCRISE intr-o singura runda, extrasa din prefixele
// numerice ale textului miscarilor (ex. ["10 Pull-ups","15 KB Swings","20
// Box Jumps"] -> 45). O miscare FARA prefix numeric (ex. "Deadlifts", cazul
// "max reps dintr-o singura miscare continua", fara concept real de runda)
// conteaza 0 - tot reps-ul acelei etape vine atunci din reps-ul partial logat
// direct (vezi totalRepsAmrapStage mai jos).
function repsPerRound(movements) {
  return (movements || []).reduce((sum, m) => {
    const match = m.match(/^(\d+)\s+/)
    return sum + (match ? parseInt(match[1]) : 0)
  }, 0)
}

// Total reps acumulate intr-o etapa 'amrap' (runde complete x reps prescrise
// per runda, plus reps-ul facut in runda partiala/neterminata) - aceeasi
// matematica dovedita corecta la totalRepsAscendingAmrap mai sus, generalizata
// la runde cu marime FIXA (nu crescatoare).
export function totalRepsAmrapStage(roundsCompleted, partialArr, movements) {
  const rounds = parseInt(roundsCompleted) || 0
  let total = rounds * repsPerRound(movements)
  ;(partialArr || []).forEach(v => { const n = parseInt(v); if (!Number.isNaN(n)) total += n })
  return total
}

// Rezultatul compus (text de afisat + total de reps) al unei singure etape -
// 'amrap' reutilizeaza composeAmrapResult existent (identic cu AMRAP simplu);
// 'interval' reutilizeaza computeSetsScore existent (Total Reps, identic cu
// scorul EMOM pe reps). `value` e slice-ul din wodChainedStages[i]:
// {roundsCompleted, partialReps} la 'amrap', {sets} la 'interval'.
export function composeStageResult(stage, value) {
  if (stage.kind === 'interval') {
    const total = computeSetsScore('EMOM', { scoringMode: 'Total Reps' }, value?.sets || {})
    return { text: total != null ? `${total} reps` : '', totalReps: total || 0 }
  }
  const roundsCompleted = value?.roundsCompleted || ''
  const partialArr = value?.partialReps || []
  const movements = stage.movements || []
  const totalReps = totalRepsAmrapStage(roundsCompleted, partialArr, movements)
  let text = composeAmrapResult(roundsCompleted, partialArr, movements)
  // Caz degenerat "max reps dintr-o singura miscare continua" (roundsCompleted
  // gol - fara concept real de runda, tot reps-ul vine din partialArr[0]) -
  // composeAmrapResult returneaza mereu text gol cand roundsCompleted e
  // falsy, indiferent de reps-ul partial real logat (vezi garda lui). Afisam
  // direct "<reps> <miscare>" in loc sa pierdem singura valoare introdusa.
  if (!text && totalReps > 0) text = `${totalReps} ${movements[0] || ''}`.trim()
  return { text, totalReps }
}

// Scorul total al unui WOD inlantuit - suma reps pe toate etapele. `values`
// e array paralel cu `stages` (wodChainedStages din App.jsx sau
// log_meta.stages reconstruit la editare).
export function totalRepsChained(stages, values) {
  return (stages || []).reduce((sum, stage, i) => sum + (composeStageResult(stage, values?.[i]).totalReps || 0), 0)
}

// Sursa unica pt cele 4 variante + coloana lor de baza in wods - orice cod
// care are nevoie de toate cele 8 coloane de greutate (select-uri Supabase,
// payload-ul Admin de salvare, populare formular la editare) deriva lista din
// VARIANTE_WEIGHT_BASE in loc sa o scrie de mana, ca sa nu existe N liste
// hardcodate care pot desincroniza cand se adauga/redenumeste o varianta.
export const VARIANTE_WEIGHT_BASE = [
  { nivel: 'RX', key: 'rx' },
  { nivel: 'Intermediate', key: 'intermediate' },
  { nivel: 'Beginner', key: 'beginner' },
  { nivel: 'OnRamp', key: 'onramp' },
]

// Toate cele 8 coloane de greutate (4 variante x 2 genuri) din wods, ca lista
// flata de nume - folosita direct in select()-urile Supabase.
export const ALL_WEIGHT_COLUMNS = VARIANTE_WEIGHT_BASE.flatMap(v => [`${v.key}_weight_male`, `${v.key}_weight_female`])

// Numele coloanei din wods care tine greutatea prescrisa a unei variante,
// separata pe gen (RX barbati 61kg vs RX femei 43kg - o singura coloana
// combinata nu se poate compara cu greutatea individuala logata de un
// membru). Sursa unica pentru App.jsx (VARIANTE_CONFIG), JurnalList si
// Clasament, ca sa nu existe mai multe maps hardcodate care pot desincroniza.
//
// P0-02 (audit platforma) - inainte, ramura de gen era un ternar inline
// (`gender === 'feminin' ? 'female' : 'male'`) care trata ORICE valoare
// non-'feminin' - inclusiv null/undefined/o valoare invalida - ca 'male',
// silentios. resolveAthleteGenderKey (rxEngine.js) exista deja ca rezolvator
// null-safe (intoarce null pt gen nesetat/nerecunoscut, nu presupune 'male')
// dar era folosit doar de fluxul de afisare a textului miscarilor
// (resolveMovementDisplayText), niciodata aici - doua politici diferite pt
// exact aceeasi intrebare ("ce gen are membrul asta?"), care puteau
// interpreta acelasi profil diferit in surse diferite ale aplicatiei. Acum
// SINGURUL loc care decide gen-ul e resolveAthleteGenderKey; aici doar
// construim numele coloanei din rezultatul lui. Gen nerezolvat -> null
// explicit (nicio coloana, deci niciun preset gresit) - politica de "unknown
// explicit", nu un fallback silentios pe un gen implicit.
export function weightKeyForVariant(nivel, gender) {
  const v = VARIANTE_WEIGHT_BASE.find(v => v.nivel === nivel)
  if (!v) return null
  const genderKey = resolveAthleteGenderKey(gender)
  if (!genderKey) return null
  return `${v.key}_weight_${genderKey}`
}

// scoreMode-ul REAL folosit la logare, nu doar cel din catalog. La Partner
// WOD, catalogul are un scoreMode generic ('fortime_or_amrap') ca fallback -
// alegerea reala de baseFormat (AMRAP/For Time) a antrenorului schimba UI-ul
// de logare in FormatLogger (nu mai arata camp de Timp la baseFormat AMRAP).
// Orice cod care decide dupa scoreMode (aici isNotRxd, dar si FormatLogger)
// trebuie sa foloseasca ACELASI calcul - altfel un Partner WOD AMRAP e
// judecat gresit dupa scoreMode-ul de fallback ('fortime_or_amrap'), desi
// UI-ul de logare nu i-a cerut niciodata un time_result.
// formatId absent/necunoscut (log fara wods legat, fara format_type, fara
// header recunoscut) -> null, nu fallback-ul implicit al catalogului
// (getFormat(undefined) ar cadea tacit pe 'For Time' altfel).
export function effectiveScoreMode(formatId, config) {
  if (!formatId) return null
  if (formatId === 'Partner WOD' && config?.baseFormat) return config.baseFormat === 'AMRAP' ? 'amrap' : 'fortime_or_amrap'
  // Buy-In/Cash-Out: acelasi motiv ca Partner WOD - config.mainFormat
  // (AMRAP/For Time) decide UI-ul real de logare al lucrului principal, nu
  // scoreMode-ul din catalog (care lipseste complet la acest format - vezi
  // mai jos). Bug real gasit (07-15): FormatLogger.jsx calcula acelasi lucru
  // separat, local, in loc sa foloseasca aceasta functie unica.
  if (formatId === 'Buy-In/Cash-Out' && config?.mainFormat) return config.mainFormat === 'AMRAP' ? 'amrap' : 'fortime_or_amrap'
  return getFormat(formatId)?.scoreMode ?? null
}

// 'For Time' e ambiguu: poate fi o secventa unica (21-15-9, gen "TO THE
// SKY") SAU runde repetate din aceleasi miscari (ex. "7 rounds for time of:
// ...", identic cu RFT) - config.structure ('Repeated Rounds') marcheaza
// explicit al doilea caz. Bug real gasit: un WOD "7 rounds for time of..."
// tratat implicit ca secventa facea ca cineva cu doar 6 din 7 runde complete
// (dar cu un time_result populat oricum) sa fie clasat pe Clasament ca
// "terminat", inaintea celor care chiar terminasera toate cele 7 runde -
// FormatLogger arata (gresit) reps per miscare in loc de runde
// complete+reps partiale, iar sortLogs nu avea cum sa distinga runda
// partiala de o secventa. 'Ladder' ramane intotdeauna o secventa (schema
// descrescatoare e prin definitie secventiala, fara varianta "runde
// repetate"). Orice cod care citea inainte direct `.sequentialPartial`
// (static, din catalog) trebuie sa foloseasca acum aceasta functie.
// INC-11 - a base AMRAP whose coach explicitly marked it a finite one-way pass
// (`format_config.structure === 'Sequence'`). Base 'AMRAP' only: 'Ascending
// AMRAP' is inherently a repeated round (increasing targets) and never carries
// `structure`. ABSENT / 'Repeated Rounds' -> false (classic behaviour, the
// default for every legacy AMRAP - never guessed from movement text).
export function isSequentialAmrap(formatId, config) {
  return formatId === 'AMRAP' && config?.structure === 'Sequence'
}

export function isSequentialFormat(formatId, config) {
  if (formatId === 'For Time') return config?.structure !== 'Repeated Rounds'
  // INC-11 - a Sequence AMRAP ranks + logs as ordered station progress (Total
  // Reps), exactly the existing sequential path (sortSectionLogs skips the
  // rounds diff and sums partial reps; the edit flow re-parses per-movement).
  if (isSequentialAmrap(formatId, config)) return true
  // Lucrul principal al unui Buy-In/Cash-Out cu mainFormat "For Time" e o
  // secventa (nu runde repetate, spre deosebire de "For Time" simplu, care
  // are un camp explicit `structure` pt asta) - acelasi motiv ca Chipper mai
  // sus. Bug real gasit (07-15): fara acest caz, un Buy-In/Cash-Out
  // neterminat pe lucrul principal n-avea nicio urmarire structurata a
  // repetarilor (doar Timp + text liber).
  if (formatId === 'Buy-In/Cash-Out') return config?.mainFormat !== 'AMRAP'
  return !!getFormat(formatId)?.sequentialPartial
}

// Numarul de la inceputul textului de greutate (ex. "61kg" -> 61, "61.5 KG"
// -> 61.5, "61" -> 61) - membrul si adminul scriu greutatea ca text liber, in
// campuri separate, fara nicio conventie impusa de format; o comparatie de
// text exact ar rata gresit ca "diferita" perechi ca "61kg"/"61 kg" (spatiu
// intern) sau "61kg"/"61" (unitate omisa) sau "61.0kg"/"61kg" (zecimala),
// desi e aceeasi greutate. Nu face conversie intre unitati (kg/lbs) - doar
// normalizeaza formatarea aceleiasi unitati implicite.
export function greutateNumerica(w) {
  const match = (w || '').replace(/\s+/g, '').match(/^(\d+(\.\d+)?)/)
  return match ? parseFloat(match[1]) : null
}

// Cheie canonica de greutate - numeric cand se poate extrage un numar din
// text (unifica "61kg"/"61 kg"/"61KG"/"61.0kg"/"61" pe aceeasi cheie),
// altfel text fara spatii/case. Sursa unica de normalizare, folosita atat de
// isNotRxd (a comparat corect membru vs prescris) cat si de gruparea pe
// greutate din Clasament (getWeightGroups in App.jsx) - inainte erau 2
// normalizari separate care puteau desincroniza (cineva declarat "not RX" de
// isNotRxd, dar grupat separat de altcineva cu aceeasi greutate scrisa
// diferit, pe Clasament).
export function canonicalWeightKey(w) {
  const numeric = greutateNumerica(w)
  return numeric != null ? String(numeric) : (w || '').trim().replace(/\s+/g, '').toLowerCase()
}

// Doua texte de greutate "insemna acelasi lucru" daca au aceeasi cheie
// canonica. Nu face conversie intre unitati (kg/lbs) - doar normalizeaza
// formatarea aceleiasi unitati implicite.
export function weightMatches(a, b) {
  if (!a?.trim() || !b?.trim()) return false
  return canonicalWeightKey(a) === canonicalWeightKey(b)
}

// Faza 3 (rxEngine.js) - inlocuieste egalitatea exacta (weightMatches) cu
// regula RX corecta: enteredWeight >= standard => RX, altfel Not RX. Bug-ul
// real reparat aici: cineva care logheaza MAI MULT decat prescris (ex. 70kg
// cand standardul e 61kg) era gresit marcat "Not RXd" de vechea egalitate
// exacta (70 !== 61) - motivul aproape sigur al bug-ului raportat de membri
// pe Clasament. classifyRxStatus intoarce null cand oricare text nu are un
// numar la inceput (ex. "bodyweight") - in acel caz pastram fallback-ul
// vechi (weightMatches, comparatie de text canonic) neschimbat, asa cum era
// inainte de aceasta faza, pt orice greutate scrisa fara cifre.
// Nu converteste unitati (la fel ca weightMatches inainte) - prescribedWeight
// aici e deja rezolvat pe genul membrului de catre apelanti (weightKeyForVariant),
// nu textul brut cu ambele standarde.
function greutateEsteSubStandard(weightLogged, prescribedWeight) {
  if (!prescribedWeight?.trim() || !weightLogged?.trim()) return false
  const rxClassification = classifyRxStatus({
    enteredWeightText: weightLogged,
    standardKg: greutateNumerica(prescribedWeight),
    athleteUnit: null,
  })
  if (rxClassification != null) return rxClassification === 'not_rx'
  return !weightMatches(weightLogged, prescribedWeight)
}

// P9.5.6 - THE ONE canonical "did the athlete materially change the SELECTED
// variant's prescription?" rule. This is AXIS B (prescription / composition
// status) and it is COMPLETELY INDEPENDENT of AXIS A (which variant the athlete
// selected) and AXIS C (how much of the workout they completed / their score).
//
// It is the SINGLE authority for BOTH:
//   - the leaderboard bucket (isMixedCategory below), and
//   - the result badge ("Not RX'd" for an RX variant, "Modified" for a non-RX
//     variant - the wording is display only, the classification is one rule),
//     rendered on the leaderboard card, the Jurnal card, the share card and the
//     benchmark-history row (via App.jsx resultIsCompositionModified).
// The badge and the bucket therefore can never disagree.
//
// Three signals, all read-time, none persisted, ALL evaluated RELATIVE TO THE
// SELECTED VARIANT (never automatically relative to RX - the prescribed weight /
// movements passed in come from the SELECTED variant's frozen prescription_snapshot,
// see resolveResultProvenance):
//   1. weight_logged is below the SELECTED variant's prescribed standard
//      (greutateEsteSubStandard - Faza 3, `entered >= standard` rule).
//   2. the logged movement list differs from the SELECTED variant's prescribed one
//      (movementsChanged - substituted / added / removed / rewritten).
//   3. a non-null performed_prescription (P9.5.2). saveWodLog only ever writes it
//      when the athlete's performed overlay MATERIALLY differs from the SELECTED
//      variant - a per-movement load / distance / calorie change, or a canonical
//      movement substitution. `!= null` is a composition modification by
//      construction.
//
// It DELIBERATELY does NOT look at completion_state / time_result / rounds
// completed / partial reps / score magnitude. "Did not finish", "capped",
// "2 of 3 rounds", a slow time, a low rep count, DNF - these are COMPLETION /
// PERFORMANCE status (a separate axis), shown separately, and NEVER make an
// otherwise-as-prescribed result "modified". (Pre-P9.5.6 the badge helper
// isNotRxd ORed in a `did not finish inside the time cap` term - that conflated
// AXIS C into AXIS B and is the INC / P9.5.6 regression that was removed.)
//
// The SELECTED variant is NEVER mutated - RX stays RX, Intermediate stays
// Intermediate; only this Modified/As-Prescribed classification and the
// leaderboard bucket move.
// INC-12 - the 4th composition signal (formatId/formatConfig are the FROZEN
// format resolved by resolveResultProvenance; when absent the term is skipped -
// a legacy log with no frozen structure is never newly classified, P10 §9).
export function resultCompositionModified(log, prescribedWeight, loggedMovements, prescribedMovements, formatId = null, formatConfig = null) {
  return greutateEsteSubStandard(log?.weight_logged, prescribedWeight)
    || movementsChanged(loggedMovements, prescribedMovements)
    || (log?.performed_prescription != null)
    || (formatId != null && isSequentialFormat(formatId, formatConfig) && sequentialProgressionDeparted(log?.result))
}

// INC-12 - SEQUENTIAL PROGRESSION COMPOSITION. For a workout whose frozen
// structure explicitly requires ordered completion (everything isSequentialFormat
// covers: Sequence AMRAP, For Time-Sequence / Chipper / Ladder, Buy-In/Cash-Out
// non-AMRAP), a finite/fixed predecessor station must be completed to its target
// before the next station is reachable.
//
// This reads ONLY the FROZEN result string. The "done/target" grammar that
// composePartialText already writes carries, for every fixed station, the
// per-athlete frozen target AND the performed value; an open / stopping station
// renders bare ("5 Name"). Nothing here touches the mutable workout,
// prescription_snapshot, or performed_prescription (INC-12 §9/§13). The caller
// gates on isSequentialFormat(frozen format).
//
// DEPARTED  iff  some fixed station i has performed(i) < target(i)
//               AND some later station j > i has performed(j) > 0.
//   - the final reached station may be partial (no later positive work) - valid (Case A)
//   - an incomplete station with no later positive work - valid
//   - open / Max-Reps stations carry no target (bare segment) - never a predecessor
//   - performed >= target counts as complete (over-log tolerated - INC-12 §7)
//   - a blank later station is omitted from the string entirely - not "> 0"
//   - an explicit later "0" renders as "0 Name" - performed 0, NOT "> 0" (INC-12 §4)
//   - completion_state / elapsed time / score magnitude never participate
export function sequentialProgressionDeparted(resultString) {
  const segs = String(resultString || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (segs.length < 2) return false
  const perf = segs.map((seg) => {
    const fixed = seg.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(?:\s|$)/)
    if (fixed) return { done: parseFloat(fixed[1]), target: parseFloat(fixed[2]) }
    const bare = seg.match(/^(\d+(?:\.\d+)?)(?:\s|$)/)
    if (bare) return { done: parseFloat(bare[1]), target: null }
    return { done: null, target: null }
  })
  return perf.some((s, i) => {
    if (s.target == null || s.done == null || !(s.done < s.target)) return false
    return perf.slice(i + 1).some((later) => (later.done ?? 0) > 0)
  })
}

// Lista de miscari logata difera (orice diferenta - inlocuita, adaugata,
// stearsa, sau doar rescrisa) de lista prescrisa a variantei - membrul poate
// edita liber miscarile la logarea WOD-ului oficial (SortableList permite tap
// pentru rescriere), nu doar reordonare. Compara pozitie cu pozitie (nu ca
// set neordonat) - o simpla reordonare tot conteaza ca "diferita" aici,
// intentionat: pe Clasament(getSectionLogs) sortarea deja ignora ordinea
// miscarilor, deci singurul motiv sa difere pozitional e ca a schimbat ceva.
export function movementsChanged(loggedMovements, prescribedMovements) {
  if (!Array.isArray(prescribedMovements) || prescribedMovements.length === 0) return false
  if (!Array.isArray(loggedMovements)) return false
  if (loggedMovements.length !== prescribedMovements.length) return true
  return loggedMovements.some((m, i) => (m || '').trim().toLowerCase() !== (prescribedMovements[i] || '').trim().toLowerCase())
}

// "Mixed Categories" (Clasament) leaderboard bucket = the RESULT COMPOSITION
// differs from the SELECTED variant's prescription (resultCompositionModified).
// Thin, back-compatible wrapper: the first arg stays `weight_logged` (string),
// with the optional `performedPrescription` 5th arg carrying the P9.5.2 signal.
// P9.5.6 - identical to the result badge now (both are just
// resultCompositionModified): a capped / incomplete result whose composition is
// exactly the selected variant stays in that variant's bucket (ranked after the
// finishers by sortSectionLogs), never moved to Mixed, and carries NO badge.
// Every leaderboard surface that buckets by variant routes through here so the
// bucket, the badge, the filter and the participant count never disagree.
// INC-12 - the optional 6th arg carries the FROZEN result string + frozen format
// so the sequential-progression term can evaluate; omitted by pre-INC-12 callers
// (term simply never fires - no behaviour change for non-sequential results).
export function isMixedCategory(weightLogged, prescribedWeight, loggedMovements, prescribedMovements, performedPrescription = null, opts = {}) {
  return resultCompositionModified(
    { weight_logged: weightLogged, performed_prescription: performedPrescription, result: opts.result ?? null },
    prescribedWeight, loggedMovements, prescribedMovements, opts.formatId ?? null, opts.formatConfig ?? null,
  )
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
export function estimateTotalDurationSec(formatId, config, movements) {
  const cfg = config || {}
  if (formatId === 'AMRAP') return cfg.durationSec || null
  if (['For Time', 'Chipper', 'Ladder', 'RFT', 'Partner WOD'].includes(formatId)) return cfg.timeCapSec || cfg.durationSec || null
  if (formatId === 'EMOM') return (parseInt(cfg.totalRounds) || 0) * (cfg.intervalSec || 60) || null
  if (formatId === 'Tabata' || formatId === 'Intervals') {
    // INC-07 - structured per-interval Intervals: roundCount × stationCount ×
    // (work + rest). The derived legacy `rounds` already equals that product
    // once saved, so a 2-arg call on a stored row still gets the right total;
    // pass `movements` from the editor (before `rounds` is derived) to compute
    // it from roundCount + the live station list.
    const iv = resolveIntervalStructure(formatId, cfg, movements)
    if (iv && iv.structured && iv.totalDurationSec != null) return iv.totalDurationSec
    return (parseInt(cfg.rounds) || 8) * ((cfg.workSec || 20) + (cfg.restSec || 10)) || null
  }
  if (formatId === 'Buy-In/Cash-Out') return cfg.mainDurationSec || null
  if (formatId === 'AMRAP with Buy-In') return cfg.totalDurationSec || null
  if (formatId === 'Chained AMRAP') return (cfg.stages || []).reduce((sum, s) => sum + (s.durationSec || 0), 0) || null
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
    else if (field.type === 'stageList') displayValue = `${value.length} etape`
    else displayValue = String(value)
    parts.push(`${label}: ${displayValue}`)
  })
  return parts.join(' · ')
}

// Valoarea de timp aratata in header-ul cardului de WOD al membrului
// (Improve Member Workout Header), aliniata pe acelasi rand cu numele
// formatului, colorata distinct (#EF4444 in JSX) - reutilizeaza
// estimateTotalDurationSec (deja existent, folosit si de Quick Create pt
// "Durata" auto-calculata la EMOM/Tabata/Intervals), nu recalculeaza nimic
// nou. Eticheta "Time cap" apare DOAR pt formatele unde timpul e cu-adevarat
// un plafon opțional peste o incercare care s-ar putea termina mai devreme
// (For Time/Chipper/Ladder/RFT/Partner WOD, campul timeCapSec) - la AMRAP/
// EMOM/Tabata/Intervals timpul e chiar durata prescrisa a antrenamentului,
// nu un "cap", asa ca acolo se arata doar valoarea goala (cerinta explicita -
// vezi exemplele "AMRAP / 15:00" vs "For Time / Time cap 20:00").
// The `fortime_or_amrap` formats where a stated time is a CAP over an attempt
// that could finish earlier (not a fixed prescribed duration like AMRAP). For
// these, `wods.duration` / `format_config.timeCapSec` / `durationSec` all mean
// "the cap". P9.5.3: scoreDefinition.js reads this to decide whether the
// Finished / Did-not-finish choice applies.
export const TIME_CAP_LABEL_FORMAT_IDS = ['For Time', 'Chipper', 'Ladder', 'RFT', 'Partner WOD']

// Universal Member Workout Format Header - singura sursa de adevar pt
// perechea "format + metadata de timp/structura relevanta", derivata
// exclusiv din estimateTotalDurationSec (deja canonic, folosit si de Quick
// Create) - nu introduce o a doua taxonomie de formate. Intoarce forma
// structurata {primary, secondaryLabel, secondaryValue} in loc de un string
// concatenat, ca UI-ul sa poata pune primary/secondary pe aceeasi linie (sau
// sa le stivuiasca pe ecrane inguste) fara sa parseze un string. Cade pe
// legacyDuration (coloana veche wods.duration, deja normalizata de apelant
// prin formatWodDurata) cand estimateTotalDurationSec nu are nimic de
// calculat din format_config - multe WOD-uri legacy nu au niciodata
// format_config populat (confirmat live). Daca niciuna dintre cele doua
// surse nu are o valoare, secondaryValue ramane null si UI-ul arata DOAR
// formatul, fara sa inventeze o metadata secundara.
export function getWorkoutFormatDisplay(formatId, config, legacyDuration, t) {
  const seconds = estimateTotalDurationSec(formatId, config)
  const value = seconds != null ? secToTime(seconds) : (legacyDuration || null)
  const primary = formatTypeLabel(formatId, config)
  if (!value) return { primary, secondaryLabel: null, secondaryValue: null }
  const isCap = TIME_CAP_LABEL_FORMAT_IDS.includes(formatId)
  return { primary, secondaryLabel: isCap ? (t?.memberWodTimeCapLabel || 'Time cap') : null, secondaryValue: value }
}

export function formatMemberHeaderTiming(formatId, config, t) {
  const { secondaryLabel, secondaryValue } = getWorkoutFormatDisplay(formatId, config, null, t)
  if (!secondaryValue) return null
  return secondaryLabel ? `${secondaryLabel} ${secondaryValue}` : secondaryValue
}

// Multe WOD-uri legacy (create inainte de Workout Engine V2 / Quick Create)
// n-au niciodata format_config populat in DB (confirmat live: format_config
// null, dar coloana veche wods.duration = "20:00") - formatMemberHeaderTiming
// singur intoarce null pt ele, lasand headerul fara nicio valoare de timp.
// Acest wrapper cade pe duration-ul legacy (deja normalizat de apelant, ex.
// prin formatWodDurata) cand config-ul n-are nimic, pastrand aceeasi eticheta
// "Time cap" doar pt formatele cu plafon.
export function resolveMemberHeaderTiming(formatId, config, legacyDuration, t) {
  const { secondaryLabel, secondaryValue } = getWorkoutFormatDisplay(formatId, config, legacyDuration, t)
  if (!secondaryValue) return null
  return secondaryLabel ? `${secondaryLabel} ${secondaryValue}` : secondaryValue
}

// Randuri curate, separate, pt restul cardului de WOD al membrului (sub
// header) - spre deosebire de describeFormatConfig (folosit de coach/Admin,
// "eticheta: valoare" alaturate cu " · " - neschimbat, inca folosit acolo,
// eticheta din editor e copy CORECT acolo), aici numarul de runde primeste
// propriul rand, cu formulare naturala ("5 Rounds", nu "Numar runde: 5").
// Time cap-ul NU mai apare aici - a migrat in header (formatMemberHeaderTiming,
// mai sus), ca sa nu se repete de doua ori pe acelasi card.
//
// Universal Member Workout Display Cleanup (deduplicare structurala +
// eliminare limbaj de editor din Member View) - doua probleme reale gasite
// dupa fix-ul anterior (MEMBER_WORKOUT_PROGRAMMING_DISPLAY_INTEGRITY):
//
// 1. DUPLICARE: cand primary deja incorporeaza un fapt structural (ex. "3
//    RFT" incorporeaza rounds=3), randul generic nu mai trebuie sa-l repete
//    ("3 Rounds" dedesubt). Rezolvat generic, nu doar pt RFT: orice cheie
//    din consumedKeys (computeFormatPrimaryLabel, singura sursa de adevar
//    pt "ce stie deja primary") e omisa aici, automat pt orice format
//    curent SAU viitor care ajunge sa foloseasca acelasi tipar.
// 2. LEAKAGE DE COPY DE EDITOR: eticheta campurilor de config (fmtSharedRepScheme
//    = "Shared rep scheme (e.g. 21-15-9)") e text de FORMULAR, potrivit in
//    editorul coach-ului (App Admin), gresit ca limbaj pt membru. Pt campuri
//    a caror VALOARE e deja notatie CrossFit auto-explicativa (o schema de
//    reps "21-15-9", "5-5-5-5-5") sau vocabular de sportiv deja lizibil ca
//    valoare goala (splitType "You go/I go", scoringMode "Total Reps"),
//    aratam DOAR valoarea, fara eticheta - vezi MEMBER_BARE_VALUE_TYPES/
//    MEMBER_BARE_VALUE_SELECT_FIELDS. Campuri care exista doar ca discriminator
//    intern al modelului de date, fara sens pt un sportiv nici macar ca
//    valoare goala (`structure`: 'Sequence'/'Repeated Rounds') sunt complet
//    suprimate - MEMBER_SUPPRESSED_FIELDS. Restul campurilor (numere care au
//    nevoie de context ca sa se inteleaga singure - startReps, targetSets
//    etc, liste de miscari) raman pe randul generic eticheta: valoare, ca sa
//    nu piarda tacut informatie - nicio schimbare de comportament acolo.
// INC-07 - `roundCount` (structured Intervals) is preferred over the legacy
// `rounds` (which, for a structured workout, is the DERIVED scoreable-interval
// count and must never be shown as the round count - §88).
const MEMBER_ROUNDS_KEYS = ['roundCount', 'rounds', 'totalRounds']
// Legacy config keys that may carry a round count without a matching schema
// field on the current format (an Intervals workout saved before INC-07 has
// `format_config.rounds` but the schema now only declares `roundCount`).
const MEMBER_LEGACY_ROUNDS_KEYS = new Set(['rounds'])
// Aceleasi campuri pe care formatMemberHeaderTiming le poate consuma (direct
// sau prin estimateTotalDurationSec) - marcate "consumed" fara sa produca un
// rand propriu aici, altfel ar aparea A DOUA OARA pe randul generic
// "eticheta: valoare" de mai jos, dupa ce au fost deja aratate in header.
const MEMBER_HEADER_TIMING_KEYS = ['timeCapSec', 'durationSec', 'mainDurationSec', 'totalDurationSec']
// Tipuri de camp a caror valoare formatata e deja notatie CrossFit completa
// prin ea insasi ("21-15-9", "5-5-5-5-5") - eticheta de editor n-ar adauga
// nimic, doar ar suna a formular.
const MEMBER_BARE_VALUE_TYPES = new Set(['repsSchemeList'])
// Campuri `select` ale caror OPTIUNI sunt deja vocabular de sportiv, lizibile
// ca valoare goala in contextul cardului (sub header-ul de format) - spre
// deosebire de `structure`, care e un discriminator pur intern.
const MEMBER_BARE_VALUE_SELECT_FIELDS = new Set(['splitType', 'baseFormat', 'scoringMode', 'ladderType'])
// Campuri care descriu doar modelul de date al lui Forge, fara niciun sens
// pt un sportiv nici macar aratate ca valoare goala.
const MEMBER_SUPPRESSED_FIELDS = new Set(['structure', 'stationMode', 'restPlacement', 'rounds'])
// Universal Visual Hierarchy Rule - o linie generata aici nu e automat
// "metadata muted": doar campurile care descriu STRICT scorarea/logarea
// (scoringMode - "Total Reps" vs "Lowest Reps" nu schimba CE faci fizic,
// doar cum se noteaza rezultatul) sunt metadata secundara, aratata mai
// discret. Orice altceva intors de acest fisier (schema de reps, numarul de
// runde, work/rest, start/increment, split-ul de partener etc.) e
// PRESCRIPTION STRUCTURE - informatie de care ai nevoie ca sa stii CE ai de
// facut - si trebuie sa aiba aceeasi emfaza vizuala ca restul cardului, nu
// stilul gri/muted rezervat notelor cu adevarat secundare. Clasificare pe
// TIP/nume de camp (scoringMode), nu pe format - se aplica identic la EMOM/
// Tabata/Intervals/Complex, fara niciun switch pe formatId.
const MEMBER_METADATA_FIELDS = new Set(['scoringMode'])

// Motorul comun din spatele randurilor member-clean - parametrizat DOAR pe
// "suprima si campurile de timing (deja aratate intr-un header separat)?",
// nu duplicat intre apelanti. formatMemberScheduleLines (cardul principal de
// WOD, care ARE un header separat, WorkoutFormatHeader) suprima timing-ul;
// formatMemberSkillDetailLines (Sectiunea Skill Work de pe Acasa, care NU
// are niciun header separat) nu-l suprima, ca sa nu piarda tacut informatie
// reala (gasit live: Skill Work tip RFT cu rounds+timeCapSec ambele setate,
// fara alta locatie unde time cap-ul sa mai apara).
//
// Intoarce { prescriptionLines, metadataLines } (nu un singur array plat) -
// ierarhia vizuala ceruta e FORMAT -> PRESCRIPTION STRUCTURE -> MISCARI ->
// SECONDARY METADATA, adica metadata trebuie sa apara DUPA lista de
// miscari, nu amestecata cu structura de dinaintea ei - apelantul (JSX)
// randeaza cele doua grupuri separat, in acea ordine, cu stiluri diferite.
function computeMemberDetailLines(formatId, config, t, suppressTimingKeys) {
  const fmt = getFormat(formatId)
  const cfg = config || {}
  const fields = fmt.config || {}
  const prescriptionLines = []
  const metadataLines = []
  const { consumedKeys } = computeFormatPrimaryLabel(formatId, cfg)
  const consumed = new Set(consumedKeys)
  if (suppressTimingKeys) MEMBER_HEADER_TIMING_KEYS.forEach(k => consumed.add(k))
  // INC-07 - a structured per-interval Interval shows its work/rest schedule as
  // the station TIMELINE (Home renders intervalTimelineLines); the bare
  // "Work: 0:40" / "Rest: 0:20" generic lines would just duplicate it. Legacy
  // Intervals / Tabata keep those lines (no timeline is shown for them).
  if (isStructuredInterval(cfg)) { consumed.add('workSec'); consumed.add('restSec') }

  // INC-07 - a structured Interval carries `roundCount` (semantic rounds) and,
  // for legacy compat, a derived `rounds` (= roundCount × stationCount). Show
  // `roundCount` when present; fall back to a legacy `rounds` even if the
  // current schema no longer declares it as a field.
  const roundsKey = MEMBER_ROUNDS_KEYS.find(k =>
    (fields[k] || MEMBER_LEGACY_ROUNDS_KEYS.has(k)) && cfg[k] != null && cfg[k] !== '' && !consumed.has(k))
  if (roundsKey) {
    prescriptionLines.push(`${cfg[roundsKey]} ${t?.memberWodRoundsLabel || 'Rounds'}`)
    consumed.add(roundsKey)
    consumed.add('rounds') // never also emit the derived compat count
  }

  // Ladder: directia (Ascending/Descending/Asc-Desc) e deja lizibila DIN
  // secventa de reps aratata mai jos ("21-18-15-12-9" citeste vizual ca
  // descrescator) - a mai arata si eticheta separat ar fi redundant, exact
  // exemplul concret care a declansat aceasta misiune. Doar cand schema
  // lipseste (date legacy) ladderType ramane singura informatie structurala
  // disponibila si e aratata (bare value, mai jos).
  if (fields.sharedRepScheme && Array.isArray(cfg.sharedRepScheme) && cfg.sharedRepScheme.length > 0) {
    consumed.add('ladderType')
  }

  Object.entries(fields).forEach(([key, field]) => {
    if (consumed.has(key) || MEMBER_SUPPRESSED_FIELDS.has(key)) return
    const value = cfg[key]
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return
    let displayValue
    if (field.type === 'duration') displayValue = secToTime(value)
    else if (field.type === 'movementList' || field.type === 'intervalList') displayValue = value.join(', ')
    else if (field.type === 'repsSchemeList') displayValue = value.join('-')
    else if (field.type === 'stageList') displayValue = `${value.length} etape`
    else displayValue = String(value)

    const bucket = MEMBER_METADATA_FIELDS.has(key) ? metadataLines : prescriptionLines
    if (MEMBER_BARE_VALUE_TYPES.has(field.type) || MEMBER_BARE_VALUE_SELECT_FIELDS.has(key)) {
      bucket.push(displayValue)
      return
    }
    const label = t?.[field.labelKey] || field.labelKey
    bucket.push(`${label}: ${displayValue}`)
  })

  return { prescriptionLines, metadataLines }
}

export function formatMemberScheduleLines(formatId, config, t) {
  return computeMemberDetailLines(formatId, config, t, true)
}

// Vezi comentariul de la computeMemberDetailLines - Sectiunea Skill Work de
// pe Acasa (SkillHomeSection) foloseste aceasta varianta pt ca nu are un
// WorkoutFormatHeader separat care sa "consume" deja time cap/duration.
export function formatMemberSkillDetailLines(skillType, config, t) {
  return computeMemberDetailLines(skillType, config, t, false)
}

// PHOTO RESULT / SHARE CARD Phase 2.2 - the structural "prescription header"
// for a photo-backed result card (owner §7/§8: "reuse the narrowest existing
// canonical source... do NOT write a card-specific workout parser, do NOT
// infer structure from result text"). This is a thin COMBINATOR of the two
// canonical sources the logging screen itself already uses together
// (App.jsx's WorkoutFormatHeader + the scheduleLines rendered right below it
// - see the primary Log WOD screen) - zero new parsing/inference. `null`
// formatId (a free-text log with no linked format) returns null - the
// caller shows no structure block rather than leaking an unrelated
// default-format's fields into it.
//
// Movement lines are DELIBERATELY NOT produced here - those come from a
// separate, already-canonical projection (resolveResultMovementLines /
// composePerformedResultLines) that is performed-aware; this function only
// ever describes the FORMAT/STRUCTURE (e.g. "5 RFT", "AMRAP" + duration,
// "5 Rounds"), never a specific movement or its performed substitution.
//
// PHOTO RESULT CARD Phase 4 (owner universal presentation hierarchy) - the
// single duration `getWorkoutFormatDisplay` resolves splits into two
// DIFFERENT concepts, using the SAME canonical distinction that function
// already encodes (`secondaryLabel` is set ONLY for the formats in
// TIME_CAP_LABEL_FORMAT_IDS - For Time/RFT/Chipper/Ladder/Partner WOD -
// never for AMRAP/EMOM/Intervals) - never a per-format branch invented
// here:
//   - `timeCap`  - a genuine cap on a separate for-time/rounds effort
//     (owner's dedicated "TOP SECONDARY" slot - shown ONCE, on its own,
//     never folded into the center format label).
//   - `intrinsicDuration` - part of the format's OWN identity (AMRAP
//     12:00 / EMOM 12:00 IS the workout, not a cap on something else) -
//     stays combined with `primary` wherever the format itself is shown,
//     and is never duplicated as a separate "time cap" fact.
// A format with neither (e.g. RFT/Ladder/Chipper with no cap configured)
// leaves both null - nothing invented.
export function resolveWorkoutStructureHeader(formatId, config, t, legacyDuration = null) {
  if (!formatId) return null
  const { primary, secondaryLabel, secondaryValue } = getWorkoutFormatDisplay(formatId, config, legacyDuration, t)
  const { prescriptionLines } = formatMemberScheduleLines(formatId, config, t)
  const isTimeCap = !!secondaryLabel // getWorkoutFormatDisplay only ever sets secondaryLabel for TIME_CAP_LABEL_FORMAT_IDS
  return {
    primary,
    timeCap: (isTimeCap && secondaryValue) ? `${secondaryLabel} ${secondaryValue}` : null,
    intrinsicDuration: (!isTimeCap && secondaryValue) ? secondaryValue : null,
    prescriptionLines,
  }
}

// PHOTO RESULT CARD Phase 2.4 - the compact TOP-OF-CARD headline ("5 RFT:
// 200m Run, 20 Air Squats, 20 Push-Ups, and 1 more"), a PRESENTATION-ONLY
// truncated summary - never a second workout parser. Combines exactly two
// already-canonical, already-resolved pieces the caller passes in:
// `resolveWorkoutStructureHeader`'s own output (format/structure) and the
// SAME performed-aware movement line list already shown lower on the card
// (resolveResultMovementLines) - it reads neither wods nor wod_logs itself,
// and never re-parses a movement string.
//
// No canonical "bare movement name" (without its reps/load) projection
// exists anywhere in the codebase (audited: resultWorkoutLines.js exposes
// only full display LINES) - inventing one here would BE the "second
// parser" the owner explicitly prohibits, so this headline reuses the
// movement lines EXACTLY as already resolved, reps/load included. This is
// a disclosed, deliberate difference from the owner's illustrative mockup
// text (which showed bare names) - see the Phase 2.4 report.
//
// PHOTO RESULT CARD Phase 4 - the headline uses ONLY `structureHeader.primary`,
// never `timeCap`/`intrinsicDuration` - both already have their own
// dedicated slot elsewhere on the card (TOP SECONDARY / the center format
// label respectively), so folding either in here would duplicate it
// (owner's universal "no piece of information duplicated" rule).
export function composeWorkoutHeadline(structureHeader, movementLines, t, maxMovements = 3) {
  if (!structureHeader) return null
  const formatLabel = structureHeader.primary
  const lines = movementLines || []
  if (lines.length === 0) return formatLabel
  const shown = lines.slice(0, maxMovements)
  const remaining = lines.length - shown.length
  const parts = [...shown]
  if (remaining > 0) parts.push(t?.photoCardAndMore ? t.photoCardAndMore(remaining) : `and ${remaining} more`)
  return `${formatLabel}: ${parts.join(', ')}`
}

// PHOTO RESULT CARD Phase 6 (owner bottom-bar final polish) - the bottom
// bar's compact final result must NEVER be the verbose composed
// per-movement partial-progress sentence a capped/DNF SEQUENTIAL
// (chipper-style) result stores as its own `result` field
// (composePartialText's own output, joined with ", " - see
// composeFortimeOrAmrapFields). Leaderboard's own compact score column
// (App.jsx's Clasament render) has this EXACT same characteristic today -
// no existing canonical compact summary exists for that one case - so
// rather than inventing a new parser to manufacture one, this resolves to
// `null` for it (owner §6 - "do not fall back to a long movement/
// progression sentence... omit... according to the safest existing
// semantics"), and the caller then shows status alone.
//
// Every other branch mirrors Leaderboard's own compact score precedence
// (App.jsx's `result` variable in the Clasament render) verbatim - this is
// a NEW shared helper, not a replacement of that inline computation, so
// Leaderboard's own already-correct output is completely unaffected by
// this extraction.
export function resolveCompactResultText({ formatId, formatConfig, result, timeResult, t }) {
  if (timeResult) return timeResult
  if (!result) return null
  // INC-11 - Sequence AMRAP already has a canonical compact summary
  // (Total Reps, same read as the sort/Leaderboard) - reuse it verbatim.
  if (isSequentialAmrap(formatId, formatConfig)) {
    return `${partialRepsOfLog({ result }, true)} ${t?.clasamentRepsUnit || 'reps'}`
  }
  // A plain sequential/chipper-style format (For Time without Repeated
  // Rounds, Chipper, Ladder, Partner WOD, etc.) with no time_result stores
  // its raw `result` as a composed per-movement partial-progress sentence
  // when capped/DNF - no safe compact summary exists for it anywhere in
  // FORGE today (Leaderboard shows the same raw text in this exact case) -
  // so the bottom bar omits the score entirely rather than rendering it.
  if (isSequentialFormat(formatId, formatConfig)) return null
  return result
}

// Eticheta scurta a formatului, cu numarul de runde/tinta inclus acolo unde
// e conventie consacrata in CrossFit (ex. "5 RFT" - Rounds For Time, "5RM"),
// nu doar formatId urmat separat de un rand generic "Numar runde: 5"
// (redundant si mai putin natural de citit). For Time cu structure=
// "Repeated Rounds" e semantic identic cu RFT (vezi comentariul de la
// definitia formatului For Time) - primeste acelasi tratament "N <format>".
// Build to Heavy/1RM: targetLabel ('5RM'/'3RM'/'1RM'...) e deja limbaj de
// sportiv, mult mai clar decat id-ul brut de format ("Build to Heavy/1RM")
// - devine chiar el primary cand exista.
//
// Universal Member Workout Display Cleanup (deduplicare structurala) -
// returneaza si SETUL de chei de config deja "consumate" de primary, ca
// formatMemberScheduleLines (mai jos) sa poata omite exact acele campuri in
// loc sa tina o lista separata, dezsincronizabila, de reguli "ce e deja
// aratat in header". O singura sursa de adevar pt "ce stie deja primary".
function computeFormatPrimaryLabel(formatId, config) {
  const cfg = config || {}
  if (formatId === 'RFT' && cfg.rounds) return { label: `${cfg.rounds} RFT`, consumedKeys: new Set(['rounds']) }
  if (formatId === 'For Time' && cfg.rounds && cfg.structure === 'Repeated Rounds') return { label: `${cfg.rounds} For Time`, consumedKeys: new Set(['rounds']) }
  if (formatId === 'Build to Heavy/1RM' && cfg.targetLabel) return { label: cfg.targetLabel, consumedKeys: new Set(['targetLabel']) }
  // EVERY-N-MINUTES ARBITRARY INTERVAL DURATION - EMOM/E1:30MOM/E2MOM/... are
  // one canonical family named from intervalSec (owner spec), not separate
  // format ids. intervalSec is folded into primary exactly like RFT folds in
  // rounds, so the generic field line below never repeats it a second time.
  if (formatId === 'EMOM') {
    const label = emomFamilyLabel(cfg.intervalSec)
    return label === 'EMOM' ? { label, consumedKeys: new Set() } : { label, consumedKeys: new Set(['intervalSec']) }
  }
  return { label: formatId, consumedKeys: new Set() }
}

export function formatTypeLabel(formatId, config) {
  return computeFormatPrimaryLabel(formatId, config).label
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

// INC-07 - is this workout line pure timing (rest), never a movement? A
// structured interval workout carries rest as format_config.restSec, never in
// the movement list; this is a safety net (+ it keeps a stray "…Rest" line out
// of the station list when one slips through a legacy paste). Matches "Rest",
// ":20 Rest", "2:00 Rest", "20s Rest", "Rest 0:20".
export function isRestLine(text) {
  const s = String(text ?? '').trim().toLowerCase()
  if (!s) return false
  const dur = '[:\\d.]*\\d[:\\d.]*\\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes)?'
  return new RegExp(`^(?:${dur}\\s*)?rest(?:\\s*${dur})?$`).test(s)
}

// INC-07 - THE canonical structural resolver for interval / station workouts.
// One pure function; Home, Coach Preview, the logger and the duration helper
// all consume its output so no surface re-derives "rounds × stations" on its
// own.
//
// STRUCTURED (new, explicit): format_config carries
//   { stationMode:'per-interval', roundCount:N, workSec, restSec,
//     restPlacement:'after-each-station' }
// and `movements` is the list of scoreable stations. Then:
//   roundCount            = N (the coach's real repeated rounds)
//   stationCount          = scoreable stations in `movements` (rest excluded)
//   scoreableIntervalCount = roundCount × stationCount   (DERIVED, never stored as truth)
//   totalDurationSec       = roundCount × stationCount × (workSec + restSec)
//                            for restPlacement 'after-each-station'
//
// LEGACY (everything else - existing Intervals/Tabata with only
// `format_config.rounds`): `rounds` stays "number of flat score inputs",
// movements are decorative. NEVER reinterpreted (INC-07 audit §J proved other
// production Intervals workouts use the identical legacy schema for
// structurally different concepts). `15 ÷ 3 = 5` is not applied to anything.
// EMOM STRUCTURED RESULT INTEGRITY - 'shared-interval' is a SECOND structured
// stationMode, additive to INC-07's 'per-interval'. Never set by
// Intervals/Tabata - both branches stay mutually exclusive so this can never
// change their existing behavior.
export function isStructuredInterval(config) {
  if (!config) return false
  if (config.stationMode === 'shared-interval') return Number(config.roundCount ?? config.totalRounds) > 0
  return config.stationMode === 'per-interval' && Number(config.roundCount) > 0
}

export function resolveIntervalStructure(formatId, config, movements) {
  const fmt = getFormat(formatId)
  if (!fmt || fmt.rowMode !== 'interval') return null
  const cfg = config || {}
  const workSec = Number(cfg.workSec) || 0
  const restSec = Number(cfg.restSec) || 0

  // EMOM STRUCTURED RESULT INTEGRITY - 'shared-interval': N movements all
  // fit INSIDE one undivided interval (e.g. 3 movements within the same
  // 1:00 minute), never sequential per-station timed slots like
  // 'per-interval' below. A self-contained early branch so the existing
  // 'per-interval' code (Intervals/Tabata's regression boundary) is never
  // touched or reused for a formula it was not designed for -
  // totalDurationSec here is roundCount × ONE shared intervalSec, not
  // roundCount × stationCount × (work+rest).
  if (cfg.stationMode === 'shared-interval') {
    const roundCount = parseInt(cfg.roundCount ?? cfg.totalRounds) || 0
    const stations = (Array.isArray(movements) ? movements : [])
      .map((m) => (typeof m === 'string' ? { name: m } : m))
      .filter((m) => {
        const name = m && typeof m.name === 'string' ? m.name.trim() : ''
        return name && !isRestLine(name)
      })
    const stationCount = stations.length
    const sharedIntervalSec = Number(cfg.intervalSec) || 0
    return {
      structured: true,
      roundCount,
      stationCount,
      stations,
      scoreableIntervalCount: roundCount * stationCount,
      workSec: sharedIntervalSec || null,
      restSec: null,
      restPlacement: null,
      totalDurationSec: roundCount && sharedIntervalSec ? roundCount * sharedIntervalSec : null,
      scoreMode: resolveSetsScoringMode(formatId, cfg),
    }
  }

  if (!isStructuredInterval(cfg)) {
    const n = parseInt(cfg.rounds) || (formatId === 'Tabata' ? 8 : 0)
    return {
      structured: false,
      roundCount: n,
      stationCount: 0,
      stations: [],
      scoreableIntervalCount: n,
      workSec: cfg.workSec != null ? workSec : null,
      restSec: cfg.restSec != null ? restSec : null,
      restPlacement: null,
      totalDurationSec: n && (cfg.workSec != null || cfg.restSec != null) ? n * (workSec + restSec) : null,
      scoreMode: resolveSetsScoringMode(formatId, cfg),
    }
  }

  const roundCount = parseInt(cfg.roundCount) || 0
  const stations = (Array.isArray(movements) ? movements : [])
    .map((m) => (typeof m === 'string' ? { name: m } : m))
    .filter((m) => {
      const name = m && typeof m.name === 'string' ? m.name.trim() : ''
      return name && !isRestLine(name)
    })
  const stationCount = stations.length
  const restPlacement = cfg.restPlacement || 'after-each-station'
  const scoreableIntervalCount = roundCount * stationCount
  const totalDurationSec = restPlacement === 'between-rounds'
    ? roundCount * (stationCount * workSec) + Math.max(0, roundCount) * restSec
    : roundCount * stationCount * (workSec + restSec)

  return {
    structured: true,
    roundCount,
    stationCount,
    stations,
    scoreableIntervalCount,
    workSec,
    restSec,
    restPlacement,
    totalDurationSec: totalDurationSec || null,
    scoreMode: resolveSetsScoringMode(formatId, cfg),
  }
}

// INC-07 - deterministic round-major key for one structured-interval score
// input. Station index (1-based) is part of the key so a movement repeated
// inside a round stays two distinct inputs (§33/§41); the name is kept for a
// readable logger label. Order across keys is R1/S1, R1/S2, … R{n}/S{m}.
export function intervalStationKey(roundIndex, stationIndex, stationName) {
  return `Rundă ${roundIndex} · ${stationIndex}. ${stationName}`
}

// EMOM STRUCTURED RESULT INTEGRITY - same round-major shape as
// intervalStationKey, labeled "Min" (EMOM's own pre-existing convention,
// e.g. legacy "Min 1".."Min 12") instead of "Rundă" (Intervals/Tabata's).
// A label-only difference: computeSetsScore/setsDisplayScore read
// rowsByKey generically regardless of key text, so this is not a parallel
// scoring path, only a parallel LABEL for EMOM's own structured rows.
export function emomStationKey(minuteIndex, stationIndex, stationName) {
  return `Min ${minuteIndex} · ${stationIndex}. ${stationName}`
}

// EVERY-N-MINUTES ARBITRARY INTERVAL DURATION - intervalSec (already the sole
// canonical field, already a 'duration' input with minute+second precision,
// already read generically by resolveIntervalStructure/resolveEmomTimeline
// with no whole-minute assumption anywhere in the scoring/structure layer)
// only lacked a DISPLAY-layer name and a terminology switch for its pattern
// positions once an interval no longer spans exactly one minute. These two
// pure helpers are the single source of truth for both - never re-derive
// "is this a whole minute" from a formatted string elsewhere.
export function isWholeMinuteInterval(intervalSec) {
  return (parseInt(intervalSec) || 60) === 60
}

// "MIN 1"/"MIN 2" only reads naturally when a position IS one minute long;
// once it can be 1:30/2:00/2:30/etc., "INTERVAL 1"/"INTERVAL 2" is the
// duration-neutral term (owner spec) - same intervalSec drives both this and
// emomFamilyLabel below, so the two can never disagree for a given config.
export function emomPositionWord(intervalSec) {
  return isWholeMinuteInterval(intervalSec) ? 'MIN' : 'INTERVAL'
}

// 60s -> 'EMOM' (unchanged); otherwise 'E{m}MOM' or 'E{m}:{ss}MOM' - derived
// arithmetically from intervalSec, never string-parsed and never a second
// format id (EMOM/E1:30MOM/E2MOM/... are one canonical family - owner spec).
export function emomFamilyLabel(intervalSec) {
  if (isWholeMinuteInterval(intervalSec)) return 'EMOM'
  const sec = parseInt(intervalSec)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `E${m}MOM` : `E${m}:${String(s).padStart(2, '0')}MOM`
}

// EMOM MINUTE-PATTERN AUTHORING - a THIRD, additive EMOM structural mode,
// distinct from both legacy flat/cycling (single value per minute) and
// 'shared-interval' (ALL movements repeat every single interval - INC-07
// era, `970b26f`+). Real coach intent for a movement list like:
//   10 Push-ups
//   10 Air Squats
//   10 Pull-ups
// is usually "MIN 1 = Push-ups, MIN 2 = Air Squats, MIN 3 = Pull-ups, then
// repeat the 3-minute pattern" - NOT "all three every minute". Rather than
// overload 'shared-interval' with a second, incompatible meaning (explicit
// owner instruction), this is a distinct `stationMode:'minute-pattern'`.
//
// Storage: reuses the EXISTING flat RX `instances` array unchanged (same
// per-movement editing/reorder/substitution/capability machinery as every
// other format - no second competing workout model) - each instance
// additionally carries `patternMinute` (0-based index into the pattern,
// set by the Coach Builder's minute-grouped editor). Grouping into minutes
// is a pure DERIVED view over that flat array, not a second stored shape.
//
// `resolveEmomTimeline(formatId, config, movements)` expands the pattern
// cyclically across `config.totalRounds` real minutes (modulo
// patternLength), stopping exactly at totalRounds - never a stray extra
// partial-pattern minute (owner §8). null for anything that is not a
// minute-pattern EMOM (formatId !== 'EMOM' or stationMode !== that value) -
// callers then fall through to resolveIntervalStructure/legacy flat
// unaffected, so this is fully additive.
export function isMinutePatternEmom(config) {
  return !!config && config.stationMode === 'minute-pattern'
}

export function resolveEmomTimeline(formatId, config, movements) {
  if (formatId !== 'EMOM' || !isMinutePatternEmom(config)) return null
  const cfg = config || {}
  const totalRounds = parseInt(cfg.totalRounds) || 0
  const list = (Array.isArray(movements) ? movements : [])
    .map((m) => (typeof m === 'string' ? { name: m } : m))
    .filter((m) => m && typeof m.name === 'string' && m.name.trim() && !isRestLine(m.name))
  const byMinute = new Map()
  list.forEach((m) => {
    const idx = Number.isInteger(m.patternMinute) ? m.patternMinute : 0
    if (!byMinute.has(idx)) byMinute.set(idx, [])
    byMinute.get(idx).push(m)
  })
  const patternLength = byMinute.size === 0 ? 0 : Math.max(...byMinute.keys()) + 1
  const effectiveMinutes = []
  if (patternLength > 0 && totalRounds > 0) {
    for (let minute = 1; minute <= totalRounds; minute++) {
      const patternIndex = (minute - 1) % patternLength
      effectiveMinutes.push({ minute, patternIndex, movements: byMinute.get(patternIndex) || [] })
    }
  }
  return {
    structured: true,
    patternLength,
    totalRounds,
    effectiveMinutes,
    scoreMode: resolveSetsScoringMode(formatId, cfg),
  }
}

// INC-07 - the ONE structured-interval display timeline: interleaves each
// station's work interval with its rest, so Home / Coach Preview show
//   0:40  Handstand Push-up
//   0:20  Rest
//   0:40  Renegade Row @ 17.5 kg
//   0:20  Rest
//   …
// instead of "15 Rounds / Work 0:40 / Rest 0:20" + a disconnected movement
// list. `stationDisplayLines` is the already-resolved per-variant station list
// (P9.4 output or legacy names). Returns null for a legacy / non-structured
// interval (caller keeps its existing rendering). Rest lines only when
// restSec > 0 and restPlacement is 'after-each-station'.
export function intervalTimelineLines(formatId, config, stationDisplayLines) {
  const iv = resolveIntervalStructure(formatId, config, stationDisplayLines)
  if (!iv || !iv.structured || iv.stationCount === 0) return null
  const work = iv.workSec ? secToTime(iv.workSec) : null
  const rest = iv.restSec ? secToTime(iv.restSec) : null
  const showRest = rest && iv.restPlacement !== 'between-rounds'
  const out = []
  iv.stations.forEach((st) => {
    out.push(work ? `${work}  ${st.name}` : st.name)
    if (showRest) out.push(`${rest}  Rest`)
  })
  return out
}

// Genereaza randurile initiale goale pentru formatele family:'sets', pe baza
// config-ului definit de admin - ex. EMOM cu totalRounds:12 -> 12 randuri
// "Min 1".."Min 12"; Tabata cu rounds:8 -> "Rundă 1".."Rundă 8"; Strength Sets
// cu targetSets:5 -> 5 randuri goale per miscare din `movements`.
// INC-07 - structured Intervals -> roundCount × stationCount rows, round-major.
// STRENGTH SETS LOGGER OBJECT LABEL REGRESSION - `movements`/
// `prescriptionMovements` throughout this module can be EITHER plain
// display-line strings OR the canonical RX instance array ({instanceId,
// name, canonicalMovementId, reps, load, ...} - since UniversalScoreInput
// forwards prescriptionMovements to every SETS-family format, not just
// EMOM). Any caller that keys data by a movement's identity (row grouping,
// capability lookup, ...) must read the NAME, never use the raw entry as an
// object key (JS silently coerces an object key to "[object Object]"). Same
// typeof-string-vs-object normalization already used by
// resolveIntervalStructure/resolveEmomTimeline for the identical reason -
// ONE shared helper, module-level so every caller (defaultRowsForFormat,
// resolveMovementLoadCapabilityByKey below, ...) reuses it instead of
// reimplementing the same ternary.
export function movementNameOf(m) {
  return typeof m === 'string' ? m : (m?.name ?? '')
}

export function defaultRowsForFormat(formatId, config, movements) {
  const fmt = getFormat(formatId)
  if (fmt.family !== 'sets') return {}
  const emptyRow = () => ({ weight: '', reps: '', distance: '', completed: false })
  const rowsOf = (n) => Array.from({ length: Math.max(1, n || 1) }, emptyRow)

  if (formatId === 'EMOM') {
    // EMOM MINUTE-PATTERN AUTHORING - movements are assigned to SPECIFIC
    // minutes (patternMinute) and the pattern cycles across totalRounds;
    // ONE row per movement per EFFECTIVE minute, never every movement every
    // minute. Checked BEFORE 'shared-interval' - gated strictly on the NEW
    // stationMode, so an existing shared-interval or legacy EMOM (no
    // instance ever carries patternMinute) is completely unaffected.
    const timeline = resolveEmomTimeline(formatId, config, movements)
    if (timeline && timeline.structured && timeline.effectiveMinutes.length > 0) {
      const out = {}
      timeline.effectiveMinutes.forEach(({ minute, movements: minuteMovements }) => {
        minuteMovements.forEach((m, si) => { out[emomStationKey(minute, si + 1, m.name)] = [emptyRow()] })
      })
      return out
    }
    // EMOM STRUCTURED RESULT INTEGRITY - multiple movements sharing ONE
    // interval (stationMode:'shared-interval'): roundCount × stationCount
    // rows, round-major, ONE input per movement per minute. Gated strictly
    // on the NEW stationMode - a legacy/unconfigured EMOM (every EMOM
    // authored before this) never sets it, so it always falls through to
    // the untouched flat branch below (the one real historical log,
    // "Min 1".."Min 10", must keep generating exactly as before).
    const iv = resolveIntervalStructure(formatId, config, movements)
    if (iv && iv.structured && iv.stationCount > 0) {
      const out = {}
      for (let r = 1; r <= iv.roundCount; r++) {
        iv.stations.forEach((st, si) => {
          out[emomStationKey(r, si + 1, st.name)] = [emptyRow()]
        })
      }
      return out
    }
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
    // INC-07 - structured per-interval Intervals: one input per station per
    // round, round-major. roundCount × stationCount inputs, ZERO for rest.
    const iv = resolveIntervalStructure(formatId, config, movements)
    if (iv && iv.structured) {
      const out = {}
      for (let r = 1; r <= iv.roundCount; r++) {
        iv.stations.forEach((st, si) => {
          out[intervalStationKey(r, si + 1, st.name)] = [emptyRow()]
        })
      }
      return out
    }
    // Legacy Intervals / Tabata - flat "Rundă i" inputs, movements decorative.
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
  // set), purtata pe rand ca `targetReps`. PERFORMED REPS SEEDING - reps-ul
  // editabil al randului e SEEDAT cu targetReps la CREAREA randului (nu doar
  // afisat ca hint "/ N reps" langa un input gol) - un athlete care doar
  // atinge campul de greutate pe seturile 2+ (targetul de reps ramanand
  // neschimbat fata de ce a fost deja logat) nu mai lasa acele randuri fara
  // reps performat salvat, care altfel excludea silentios acele seturi din
  // Total Weight Lifted (computeVolumeLoad exclude corect orice rand cu reps
  // gol - vezi owner ticket-ul respectiv). Ramane 100% editabil - athlete-ul
  // poate schimba/goli explicit valoarea, iar acea alegere se salveaza ca
  // atare (updateSetRow inlocuieste simplu campul, fara nicio restaurare).
  // NICIODATA aplicat unui rand deja existent (defaultRowsForFormat e apelat
  // DOAR cand `sets` e complet gol - FormatLogger.jsx - deci un log reschis
  // cu evidenta performata reala, inclusiv randuri intentionat goale, nu
  // trece niciodata pe aici din nou).
  if (formatId === 'Strength Sets') {
    const scheme = Array.isArray(config?.setsScheme) && config.setsScheme.length > 0 ? config.setsScheme : [null]
    const movs = (movements && movements.length > 0) ? movements : ['']
    const out = {}
    movs.forEach(m => {
      out[movementNameOf(m)] = scheme.map(targetReps => ({
        ...emptyRow(),
        reps: targetReps != null ? String(targetReps) : '',
        targetReps: targetReps ?? null,
      }))
    })
    return out
  }
  // Superset: mișcările alternante sunt configurate explicit de admin in
  // config.movements (movementList din FormatConfigEditor), separat de
  // parametrul generic `movements` (care la Skill Work e textul liber din
  // textarea, nesincronizat cu acest config) - fara ramura asta, config.movements
  // era ignorat complet si se genera un singur rand generic in loc de un rand
  // per miscare alternanta.
  if (formatId === 'Superset') {
    const targetSets = parseInt(config?.targetSets) || 0
    const movs = Array.isArray(config?.movements) && config.movements.length > 0 ? config.movements : ['']
    const out = {}
    movs.forEach(m => { out[m] = targetSets ? rowsOf(targetSets) : [] })
    return out
  }
  // Weightlifting / Build to Heavy/1RM: randuri per miscare. Fara targetSets
  // prescris (Weightlifting, Build to Heavy) pornim de la 0 randuri - membrul
  // adauga manual cate seturi a facut, ca la Skill Work Weightlifting azi
  // (nu presupunem un numar).
  const targetSets = parseInt(config?.targetSets) || 0
  const movs = (movements && movements.length > 0) ? movements : ['']
  const out = {}
  movs.forEach(m => { out[movementNameOf(m)] = targetSets ? rowsOf(targetSets) : [] })
  return out
}

// Rezolva scoringMode-ul EFECTIV al unui format family:'sets': valoarea
// persistata in config, sau (cand lipseste) default-ul DEJA DECLARAT in
// schema formatului (WORKOUT_FORMATS[formatId].config.scoringMode.default).
// Sursa unica pt computeSetsScore (mai jos) SI pt afisarea etichetei scorului
// (Clasament) - niciuna nu re-deriva propriul raspuns la "ce scoringMode e
// activ", ca sa nu poata diverge.
//
// Bug real gasit prin audit: campurile scoringMode 'required: true' (Tabata/
// Intervals) declara un 'default' in catalog, dar SelectField-ul din
// FormatConfigEditor arata vizual options[0] (nu schema.default) si NU scrie
// niciodata cheia in `config` decat daca adminul chiar atinge dropdown-ul -
// un Interval WOD lasat pe alegerea deja-corecta-vizual ramane persistat
// FARA scoringMode deloc. Rezultatul: WOD-uri reale cu 6 runde de reps
// logate corect (115/14/185/26/233/33 = 606) cadeau pe null (niciun
// fallback de greutate, pt ca nu exista greutate logata la reps pure),
// Clasamentul aratand doar "6 seturi" descriptiv, nu scorul atletic real.
// Fix: cand config-ul persistat nu are scoringMode, foloseste default-ul
// DEJA DECLARAT in schema formatului - niciun format nou, nicio migrare,
// doar rezolvarea corecta a valorii implicite pe care catalogul o promitea
// deja. Complex/EMOM raman neschimbate (scoringMode acolo e 'required:
// false', fara default - absenta ramane absenta, cad in continuare pe
// maxWeightFromSets).
//
// Bug real gasit prin audit universal de scoring (08-17): 'Death By' (varianta
// cu reps crescator, distincta de 'Death By Weight') nu are NICIUN camp
// scoringMode in schema - spre deosebire de Tabata/Intervals/EMOM. Rezultat:
// resolveSetsScoringMode intoarce mereu null pt Death By, isWeightScoredSetsFormat
// il trateaza deci ca scorat pe greutate, iar un Death By pe reps (bodyweight,
// ex. "Death By Burpees") cade pe maxWeightFromSets - care intoarce null cand
// nu exista nicio greutate logata (cazul normal pt reps pure). Clasamentul
// arata acei membri neclasati ("-"), desi reps-ul e complet logat si valid.
// Spre deosebire de EMOM/Complex (unde greutatea e o alegere reala a
// antrenorului), Death By NU are nicio interpretare legitima pe greutate -
// 'Death By Weight' e deja formatul separat pt asta. Nu exista ambiguitate de
// rezolvat cu un dropdown; scorul canonic e mereu Total Reps (suma reps-ului
// logat pe fiecare interval, inclusiv runda partiala de esec) - hardcodat aici,
// fara camp nou in schema, fara UI nou.
export function resolveSetsScoringMode(formatId, config) {
  if (formatId === 'Death By') return 'Total Reps'
  // EMOM AUTHORING + CANONICAL SCORING INTEGRITY - an EXPLICIT coach choice
  // of "No Score" (e.g. a quality/skill EMOM) must resolve identically to
  // absent scoringMode - the SAME safe "no competitive scalar" behavior
  // Complex/Weightlifting-without-scoringMode already has (descriptive
  // "N sets" only, no ranking implied). The literal string is still
  // persisted verbatim in format_config for the builder to reload
  // correctly (see resolveEmomScoringOptions/the builder) - only the
  // SCORING read normalizes it, never the saved config itself.
  if (config?.scoringMode === 'No Score') return null
  const schemaDefault = formatId ? getFormat(formatId)?.config?.scoringMode?.default : null
  return config?.scoringMode || schemaDefault || null
}

// Calculeaza scorul unui format family:'sets' cu scoringMode configurabil
// (Tabata/Intervals: Total Reps = suma tuturor randurilor, Lowest Reps = cea
// mai mica valoare dintre randuri cu reps completat; Complex: Max Weight/
// Total Weight, vezi mai jos). Intoarce null daca nu exista randuri cu date
// valide (reps sau greutate, dupa caz) sau formatul nu are scoringMode.
// EMOM STRUCTURED RESULT INTEGRITY - Oracle D. A shared-interval EMOM whose
// stations measure DIFFERENT quantities (real live example: "Calorie Row
// 12 cal" + "10 Burpee") must never have those raw numbers summed into one
// meaningless total - reps and calories are not additive. `stationMetrics`
// is the CALLER-resolved quantity metric per station (the same canonical
// reps/distance/calories resolution the performed-movement-composition
// editor already uses for cardio movements, e.g.
// `resolveMovementCapability` in prescriptionContract.js - never
// re-derived or guessed here from movement text). Returns true only when
// every station shares the SAME metric, i.e. a Total/Lowest Reps sum over
// `rowsByKey` is actually meaningful. Pure - does not touch
// computeSetsScore; the wiring layer calls this BEFORE trusting a
// structured EMOM's aggregate score.
export function isUnitHomogeneousAggregation(stationMetrics) {
  const metrics = (Array.isArray(stationMetrics) ? stationMetrics : []).filter(Boolean)
  if (metrics.length === 0) return true
  return metrics.every((m) => m === metrics[0])
}

// EMOM MIXED-UNIT AGGREGATION SAFETY - the scored quantity of ONE frozen
// `prescription_snapshot` movement entry (buildPrescriptionSnapshot's shape,
// prescriptionContract.js: `{name, reps?, load?, distance?, calories?, ...}`),
// reused verbatim - NEVER re-derived from movement text/labels ("12 cal",
// "Row", "Run"...) and never a live catalog lookup at scoring time (the
// snapshot is already frozen per-log). `reps` wins even when `load` is also
// present - a movement like "10 Clean & Jerks @ 43 kg" freezes BOTH fields
// (buildPrescriptionSnapshot line ~1306-1307: reps is seeded alongside load
// for exactly this shape), and the SCORED quantity is the reps, not the
// load - load is performed-metric context, never the counted unit. null =
// no resolvable metric on this entry, never assumed to be 'reps'.
export function scoredMetricOf(snapshotMovement) {
  if (!snapshotMovement) return null
  if (snapshotMovement.reps) return 'reps'
  if (snapshotMovement.calories) return 'calories'
  if (snapshotMovement.distance) return 'distance'
  if (snapshotMovement.load) return 'load'
  return null
}

// EMOM MIXED-UNIT AGGREGATION SAFETY - maps every rowsByKey key a structured
// EMOM's scoring touches to its canonical scored-quantity metric, resolved
// ENTIRELY from the log's own frozen `prescription_snapshot.movements` - the
// SAME shape resolveIntervalStructure already accepts for `movements` (a
// snapshot movement object passes through its station filter unchanged,
// since it already carries `.name`). Reuses resolveIntervalStructure/
// emomStationKey/intervalStationKey verbatim - no parallel station-walking
// logic, no second EMOM-specific movement/unit map. null when the
// format/config isn't a structured interval (nothing to classify) - the
// caller then omits the unitsByKey argument to computeSetsScore/
// setsDisplayScore/setsScoreText entirely, so every non-structured format
// (and a structured EMOM with no snapshot available) is completely
// unaffected - the aggregation gate below only ever activates when this
// resolves real, canonical per-station unit data.
export function resolveStationUnitsByKey(formatId, config, prescriptionMovements) {
  // EMOM MINUTE-PATTERN AUTHORING - a minute-pattern EMOM's rowsByKey keys
  // (emomStationKey per effective minute) get their units classified from
  // the SAME canonical scoredMetricOf, walking resolveEmomTimeline's
  // effective minutes instead of resolveIntervalStructure's stations.
  if (isMinutePatternEmom(config)) {
    const timeline = resolveEmomTimeline(formatId, config, prescriptionMovements)
    if (!timeline || !timeline.structured || timeline.effectiveMinutes.length === 0) return null
    const out = {}
    timeline.effectiveMinutes.forEach(({ minute, movements }) => {
      movements.forEach((m, si) => { out[emomStationKey(minute, si + 1, m.name)] = scoredMetricOf(m) })
    })
    return out
  }
  // REGRESSION BOUNDARY - deliberately scoped to EMOM's 'shared-interval'
  // shape ONLY, never Intervals/Tabata's 'per-interval' (even though both are
  // `iv.structured`). Intervals/Tabata's existing per-interval scoring is an
  // explicit regression boundary for this incident - an existing structured
  // Interval log with genuinely heterogeneous station movements (e.g. a Row
  // + Burpees alternation) must keep scoring exactly as it always has, not
  // silently start returning null the day this gate ships.
  if (config?.stationMode !== 'shared-interval') return null
  const iv = resolveIntervalStructure(formatId, config, prescriptionMovements)
  if (!iv || !iv.structured || iv.stationCount === 0) return null
  const keyFor = formatId === 'EMOM' ? emomStationKey : intervalStationKey
  const out = {}
  for (let r = 1; r <= iv.roundCount; r++) {
    iv.stations.forEach((st, si) => {
      out[keyFor(r, si + 1, st.name)] = scoredMetricOf(st)
    })
  }
  return out
}

// STRENGTH VOLUME LOAD - the movement-keyed twin of resolveStationUnitsByKey
// above, for rowMode:'movement' formats (Strength Sets, Weightlifting,
// Superset - never Build to Heavy/1RM, an explicit RM test, not a training-
// volume session; never Complex, rowMode:'round', its `sets` keys are round
// labels, not movements). A rowsByKey row for these formats is already keyed
// by the plain movement NAME (movementNameOf, defaultRowsForFormat) - no
// station-index wrapping like EMOM/Intervals needs, so this is a flat
// name -> capability map, resolved from the same canonical RX instance array
// (prescriptionMovements) every other capability-aware helper in this file
// already reads.
//
// LIVE PRODUCTION BUG (owner report, real saved Strength Sets Snatch log):
// `isLoadCapable: !!m.load` (the original signal here) conflates two
// DIFFERENT facts - "does this instance currently carry a PRESCRIBED load
// value" vs "can this movement conceptually take a load at all". A coach can
// legitimately remove ONLY a load-capable movement's Load field while
// keeping Reps (strengthSetsOptionalLoad fix, pre-dates this initiative -
// "each athlete picks their own weight", the common case for Strength Sets)
// - the frozen prescription_snapshot instance then has NO `.load` key even
// though the movement (e.g. Snatch) is genuinely load-capable, and the
// athlete's actually-performed rows carry real weight values regardless (the
// logger's own weight input is never gated on whether load was prescribed).
// The old signal silently excluded every such movement from volume - not a
// rare edge case, the NORMAL Strength Sets authoring pattern.
//
// FIX: when a `movementIndex` (buildMovementIndex(gymMovements) -
// prescriptionContract.js, the SAME index PerformedMovementPickerEdit
// already uses, canonical-id keyed, never a live re-fetch performed here)
// is supplied, resolve REAL catalog capability via the instance's own
// `canonicalMovementId` (resolveMovementCapability - the exact function the
// Coach Builder's own Load-field-removal gate already uses) - this
// correctly keeps a bodyweight-only movement (Air Squat, catalog capability
// never includes 'load') excluded regardless of any stray weight value
// (oracle F/G, unchanged), while correctly INCLUDING a load-capable
// movement whose load was simply never prescribed. `movementIndex` is
// OPTIONAL - when absent (a caller with no catalog available, or a pure
// unit test), falls back to the original `!!m.load` instance-shape signal,
// byte-identical to before - never a live catalog lookup performed BY this
// function itself, never a movement-name heuristic either way.
export function resolveMovementLoadCapabilityByKey(prescriptionMovements, movementIndex) {
  const out = {}
  ;(Array.isArray(prescriptionMovements) ? prescriptionMovements : []).forEach((m) => {
    if (typeof m === 'string') return // a plain display-line string carries no capability signal at all - leave unresolved (caller treats as not load-capable, never guesses)
    const name = movementNameOf(m)
    if (!name) return
    const movementId = m.canonicalMovementId || null
    const catalogRow = movementId && movementIndex?.byId ? movementIndex.byId.get(movementId) : null
    const isLoadCapable = catalogRow ? resolveMovementCapability(catalogRow).allowed.includes('load') : !!m.load
    out[name] = { isLoadCapable, movementId }
  })
  return out
}

// STRENGTH VOLUME LOAD - Total Weight Lifted = Σ(actual performed reps ×
// actual performed load), the owner's own literal formula. Pure - reads only
// the rowsByKey ACTUALLY entered (the member's real performed evidence,
// never `targetReps`/any programmed value - defaultRowsForFormat's
// `targetReps` is deliberately never read here). `loadCapabilityByKey`
// (resolveMovementLoadCapabilityByKey above) is REQUIRED, not optional and
// defaulted to "everything counts" - a movement absent from the map (e.g. a
// legacy log with no prescriptionMovements available) contributes nothing,
// fails closed, never assumes bodyweight-lifted-something.
//
// Per row: blank reps or blank load -> excluded entirely (no evidence, not
// even a zero-contribution row). Explicit "0" -> a real, included row
// contributing literally 0 (0 reps x load = 0 either way, but it counts as
// evidence - shows up in contributingRows, distinct from a row that was
// never touched). Different loads across sets are already handled correctly
// by construction (each row's own weight, summed independently) - no special
// case needed for the owner's own worked example.
//
// UNIT SAFETY - `row.weight` numbers carry no per-row unit column anywhere in
// this codebase (confirmed: the evaluate_movement_prs trigger's own comment
// makes the identical observation) - every row in ONE log is implicitly in
// that log's OWN frozen weight_unit context, never the athlete's CURRENT
// profile preference. This function does not guess or convert - it takes
// `weightUnit` as an explicit, caller-supplied label (the caller's
// responsibility to source from the log's own frozen context, e.g.
// prescription_snapshot / the member's weight_unit AT LOG TIME, never a live
// re-read of a possibly-since-changed profile setting) and echoes it back
// verbatim on the result, never silently assuming 'kg'. Cross-log
// aggregation (a FUTURE lifetime-volume feature, not this phase) would need
// to convertWeight() each log's own total to one canonical unit BEFORE
// summing across logs - out of scope here, a single log's own rows are
// already unit-consistent by construction, so no conversion happens within
// this function.
//
// Returns { totalWeight, weightUnit, byMovement: [{ movementIdentity,
// movementName, totalWeight, contributingRows }] } - byMovement is the
// canonical truth; totalWeight at the top level is a convenience SUM of
// byMovement's own totals, never computed independently (so the two can
// never silently disagree). `movementIdentity` is `id:<uuid>` /
// `text:<normalizedName>` - movementHistoryIdentity's own tagged-union
// convention (prescriptionContract.js is EMOM/PWA-side; this mirrors the
// exact same shape movementHistory.js already established for PR/Movement-
// History identity, so a future consumer joining volume load against that
// same identity space needs no second convention).
export function computeVolumeLoad(rowsByKey, loadCapabilityByKey, weightUnit) {
  const unit = weightUnit === 'lbs' ? 'lbs' : 'kg'
  const byMovement = []
  Object.entries(rowsByKey || {}).forEach(([movementName, rows]) => {
    const cap = loadCapabilityByKey?.[movementName]
    if (!cap || !cap.isLoadCapable) return
    let totalWeight = 0
    const contributingRows = []
    ;(rows || []).forEach((row, idx) => {
      const reps = row?.reps === '' || row?.reps == null ? null : Number(row.reps)
      const weight = row?.weight === '' || row?.weight == null ? null : Number(row.weight)
      if (reps === null || weight === null || !Number.isFinite(reps) || !Number.isFinite(weight)) return
      const rowWeight = reps * weight
      totalWeight += rowWeight
      contributingRows.push({ rowIndex: idx, reps, weight, contribution: rowWeight })
    })
    if (contributingRows.length === 0) return // nothing actually logged for this movement - omit it entirely, never a fabricated 0-weight movement entry
    byMovement.push({
      movementIdentity: cap.movementId ? `id:${cap.movementId}` : `text:${normalizeMovementKeyForVolume(movementName)}`,
      movementName,
      totalWeight,
      contributingRows,
    })
  })
  const totalWeight = byMovement.reduce((sum, m) => sum + m.totalWeight, 0)
  return { totalWeight, weightUnit: unit, byMovement }
}

// Same normalization convention as movementHistory.js's normalizeKey -
// grouping-only, never a display transform, deliberately re-declared here
// (workoutFormats.js has no existing dependency on movementHistory.js and
// this module must stay import-free of it - a one-line pure function, not
// worth a cross-module coupling for).
function normalizeMovementKeyForVolume(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// EMOM AUTHORING + CANONICAL SCORING INTEGRITY - the scoring modes FORGE can
// SAFELY offer a coach authoring/editing an EMOM with these RX movement
// instances (buildPrescriptionSnapshot/newMovementInstance shape - the same
// canonical resolution as scoredMetricOf/resolveStationUnitsByKey, never
// movement-name parsing). 'No Score' is always offered - a coach must be
// able to intentionally leave a quality/skill EMOM unscored.
//
//   homogeneous reps, single movement per interval  -> Total Reps, Lowest Reps
//   homogeneous reps, 2+ movements per interval      -> Total Reps only
//     (Lowest Reps is well-defined for a classic single-movement EMOM - the
//     worst MINUTE - but ambiguous for a shared-interval multi-station EMOM,
//     where "the lowest single value" could mean the worst station-instance
//     out of many per minute, a materially different statistic. Rather than
//     invent a semantics for that, it is never offered here - owner §13.)
//   homogeneous calories                             -> Total Calories
//     (calories carry no sub-unit to normalize, unlike distance - safe.)
//   homogeneous distance, load-only, or genuinely
//   mixed units                                      -> No Score only
//     (distance would require cross-unit m/km/ft/mi normalization FORGE
//     does not canonically support today - owner §16, OWNER DECISION
//     REQUIRED, never faked with an unsafe implicit conversion.)
export function resolveEmomScoringOptions(movementInstances) {
  const list = Array.isArray(movementInstances) ? movementInstances : []
  const stationCount = list.filter((m) => m && typeof m.name === 'string' && m.name.trim() && !isRestLine(m.name)).length
  const metrics = list.map((m) => scoredMetricOf(m)).filter(Boolean)
  const distinct = [...new Set(metrics)]
  const homogeneous = distinct.length === 1 ? distinct[0] : null
  const options = []
  if (homogeneous === 'reps') {
    options.push('Total Reps')
    if (stationCount <= 1) options.push('Lowest Reps')
  } else if (homogeneous === 'calories') {
    options.push('Total Calories')
  }
  options.push('No Score')
  return options
}

export function computeSetsScore(formatId, config, rowsByKey, unitsByKey) {
  const scoringMode = resolveSetsScoringMode(formatId, config)
  if (!scoringMode) return null
  // Total Weight: suma greutatilor logate pe fiecare runda (ex. Complex cu
  // greutate diferita per runda, gasit pe BTWB - vezi comentariul de la
  // formatul 'Complex') - Max Weight ramane identic numeric cu fallback-ul
  // maxWeightFromSets, dar il face selectabil explicit, la fel ca Lowest/
  // Total Reps mai jos.
  if (scoringMode === 'Total Weight' || scoringMode === 'Max Weight') {
    const weightValues = Object.values(rowsByKey || {})
      .flat()
      .map(r => parseFloat(r?.weight))
      .filter(n => !isNaN(n))
    if (weightValues.length === 0) return null
    return scoringMode === 'Total Weight' ? weightValues.reduce((a, b) => a + b, 0) : Math.max(...weightValues)
  }
  // EMOM MIXED-UNIT AGGREGATION SAFETY - unitsByKey (optional, only ever
  // passed for a structured EMOM via resolveStationUnitsByKey) maps rowsByKey
  // keys to their canonical scored quantity. A Total/Lowest Reps sum across
  // rows that measure DIFFERENT quantities (e.g. "12 Cal Row" + "10 Burpees")
  // is not a real number - abort to the existing null/no-score representation
  // (setsDisplayScore's own maxWeightFromSets fallback, which a structured
  // EMOM's reps-only rows never satisfy either, so this resolves to the
  // ordinary "-" every surface already shows for an unscoreable log) rather
  // than compute one. Every row with NO resolved unit (unitsByKey omitted, or
  // a key the map doesn't cover) is trusted exactly as before - this can only
  // ever narrow an existing sum to null, never invent a new one.
  if (unitsByKey) {
    const knownUnits = Object.keys(rowsByKey || {}).map((k) => unitsByKey[k]).filter(Boolean)
    if (!isUnitHomogeneousAggregation(knownUnits)) return null
  }
  const repsValues = Object.values(rowsByKey || {})
    .flat()
    .map(r => parseInt(r?.reps))
    .filter(n => !isNaN(n))
  if (repsValues.length === 0) return null
  // EMOM AUTHORING + CANONICAL SCORING INTEGRITY - 'Total Calories' is the
  // SAME sum-of-logged-values arithmetic as 'Total Reps' (a calorie EMOM's
  // structured rows carry their number in the identical `reps` input field -
  // only the coach-facing label and the display unit differ, resolved by
  // setsScoreText/isWeightScoredSetsFormat below). No new aggregation
  // algorithm; a homogeneous-calories mixed-unit fixture already summed
  // correctly under 'Total Reps' before the builder could express calories
  // explicitly - this only lets it be LABELED correctly.
  if (scoringMode === 'Total Reps' || scoringMode === 'Total Calories') return repsValues.reduce((a, b) => a + b, 0)
  return Math.min(...repsValues)
}

// Cea mai mare greutate logata intr-un log family:'sets' FARA scoringMode
// configurat (Weightlifting, Build to Heavy/1RM, Strength Sets, Death By
// Weight, Complex, Superset - toate PR-eligible, centrate pe "cat de greu ai
// mers", nu pe reps). null daca nu exista niciun rand cu greutate valida.
export function maxWeightFromSets(rowsByKey) {
  let max = null
  Object.values(rowsByKey || {}).flat().forEach(row => {
    const w = parseFloat(row?.weight)
    if (!Number.isNaN(w) && (max == null || w > max)) max = w
  })
  return max
}

// Scorul de afisat/clasat pt un log family:'sets' - incearca intai
// scoringMode-ul configurat explicit (Tabata/Intervals: Total Reps/Lowest
// Reps), altfel cade pe greutatea maxima logata. Folosit de Clasament ca sa
// nu mai arate "-" pt formate din familia 'sets' (bug raportat: 5 seturi
// reale logate la "Build to Heavy/1RM", niciunul afisat/clasat pe
// Leaderboard, pt ca acolo se citea doar time_result/result - ambele mereu
// null la aceasta familie, rezultatul real fiind in sets).
export function setsDisplayScore(formatId, config, rowsByKey, unitsByKey) {
  const configured = computeSetsScore(formatId, config, rowsByKey, unitsByKey)
  if (configured != null) return configured
  return maxWeightFromSets(rowsByKey)
}

// Adevarat daca setsDisplayScore() de mai sus intoarce o GREUTATE (kg/lbs)
// pt acest WOD, fals daca intoarce un numar de REPS (scoringMode 'Total
// Reps'/'Lowest Reps') - oglindeste exact ramurile din computeSetsScore,
// folosind ACELASI rezolvator (resolveSetsScoringMode) - altfel ar putea
// diverge de computeSetsScore chiar pt cazul care a motivat acest audit:
// fara acest fix, un Interval Total Reps cu scoringMode absent din config
// (rezolvat corect la 606 de computeSetsScore) tot ar arata GREUTATE aici
// (`!scoringMode` = true), Clasamentul afisand gresit "606kg" in loc de
// "606 reps" chiar dupa fix-ul de la computeSetsScore. formatId opțional
// (backward-compat) - omis, se comporta exact ca inainte (absenta ramane
// absenta => weight-scored, corect pt Complex/Weightlifting/EMOM fara
// scoringMode, care nu au niciun default de rezolvat oricum).
// Sursa unica pt Clasament (sortLogs in App.jsx), ca sa nu normalizeze
// kg/lbs pe un scor care de fapt nu e deloc o greutate.
export function isWeightScoredSetsFormat(config, formatId) {
  const scoringMode = formatId !== undefined ? resolveSetsScoringMode(formatId, config) : config?.scoringMode
  return !scoringMode || scoringMode === 'Total Weight' || scoringMode === 'Max Weight'
}

// EMOM AUTHORING + CANONICAL SCORING INTEGRITY - THE single unit suffix for
// a family:'sets' derived score, so a calorie-scored EMOM ("Total Calories")
// never gets mislabeled "reps" on ANY surface. Every call site (setsScoreText
// below, and the Leaderboard result badge) resolves the suffix through this
// one function - never its own inline weight/reps ternary - so a new
// scoringMode value only ever needs to be taught here once. Byte-identical
// to the previous inline ternary for every scoringMode that existed before
// this incident (Total Calories is new).
export function setsScoreUnitSuffix(config, formatId, weightUnit, repsWord = 'reps') {
  if (resolveSetsScoringMode(formatId, config) === 'Total Calories') return 'cal'
  return isWeightScoredSetsFormat(config, formatId)
    ? (weightUnit === 'lbs' ? 'lbs' : 'kg')
    : repsWord
}

// INC-06 - the ONE canonical display string for a family:'sets' log's derived
// score, so every athlete-result surface (Clasament card, Jurnal card, Skill
// Jurnal card, share card) shows the SAME value with the SAME unit. Wraps the
// existing setsDisplayScore (value) + setsScoreUnitSuffix (unit gate):
//   rep-scored  (Tabata/Intervals 'Total Reps'|'Lowest Reps', Death By)  -> "203 reps"
//   calorie-scored (EMOM 'Total Calories')                              -> "21 cal"
//   weight-scored (Complex 'Total/Max Weight'; Weightlifting/Strength/Build-to-
//                  Heavy/Superset fallback = maxWeightFromSets)          -> "142 kg"
// null when there is no derivable score (family:'sets' with neither a resolvable
// scoringMode nor any logged weight - e.g. an empty Complex). `repsWord` keeps
// i18n at the call site (t.clasamentRepsUnit); this module stays pure.
export function setsScoreText(formatId, config, rowsByKey, weightUnit, repsWord = 'reps', unitsByKey) {
  const score = setsDisplayScore(formatId, config, rowsByKey, unitsByKey)
  if (score == null) return null
  return `${score} ${setsScoreUnitSuffix(config, formatId, weightUnit, repsWord)}`
}

// INC-06 - the label for the derived family:'sets' total (logger's "score" box),
// keyed off the CANONICAL scoringMode (resolveSetsScoringMode) not raw config.
// Rep modes -> the existing rep labels; weight modes (Complex Total/Max Weight)
// -> the Weight label, not a misleading "Total reps" / "Lowest round". `t`
// optional so the module stays testable without the translation bundle.
export function setsScoreLabel(mode, t) {
  if (mode === 'Lowest Reps') return t?.fmtLowestRepsScoreLabel || 'Cea mai slabă rundă'
  if (mode === 'Total Weight' || mode === 'Max Weight') return t?.logWodWeightLabel || 'Weight'
  return t?.fmtTotalRepsScoreLabel || 'Total reps'
}

// Conversie NEROTUNJITA kg<->lbs, doar pt COMPARATIE/sortare interna -
// convertWeight() din utils.js rotunjeste la 0.5 (corect pt afisare pe
// disc de bara, gresit pt clasament: 220lbs rotunjit ar cadea exact pe
// 100.0kg, la egalitate falsa cu un 100kg real, desi 220lbs < 220.462lbs =
// echivalentul real al 100kg). Valoarea intoarsa aici nu se afiseaza
// niciodata, doar se compara.
const KG_TO_LBS_RANKING = 2.20462
export function toKgForRanking(value, unit) {
  if (value == null) return null
  return unit === 'lbs' ? value / KG_TO_LBS_RANKING : value
}

// Layer 2b - Universal Scoring Architecture, Phase 1B. Comparatorul canonic
// de clasament (fostul `sortLogs` din App.jsx/Clasament, un closure peste
// wodZiFormat/wodZiData ale INTREGULUI WOD), acum o functie PURA
// parametrizata cu formatul/config-ul UNEI SINGURE Sectiuni scorate
// independent (primara sau nu). Fiecare Sectiune isi are propriul clasament,
// comparat cu PROPRIUL comparator - o Sectiune LOAD nu se compara niciodata
// cu logica unei Sectiuni TIME doar pt ca sunt in acelasi Workout. Aceeasi
// functie serveste atat Sectiunea primara (Metcon) cat si oricare Sectiune
// suplimentara (Skill/Skill2/orice sectiune noua) - identitatea sursei
// (wod_logs vs skill_logs) e irelevanta aici, ambele tabele au aceleasi
// campuri de scor (result/time_result/sets/log_meta/completion_state).
// Deduplicarea "un singur log per membru" e per apelare (adica per
// Sectiune) - un membru care a logat atat Sectiunea A cat si B trebuie sa
// apara in AMBELE clasamente, nu sa fie stins de un dedup global care ar
// pastra doar cel mai recent log al lui (bug identificat in timpul
// investigatiei Layer 2b: fostul dedupLogsGlobal rula PESTE toate
// Sectiunile odata, inainte de orice grupare pe Sectiune).
export function parseTimeResult(str) {
  if (!str) return Infinity
  const parts = str.trim().split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return (parseFloat(str) || Infinity) * 60
}
export function parseRoundsScore(str) {
  if (!str) return null
  const match = str.match(/(\d+(\.\d+)?)/)
  return match ? parseFloat(match[1]) : null
}
// Suma reps-urilor din runda partiala/neterminata - vezi comentariul
// original din App.jsx (istoricul git al acestui fisier / Layer 2b report)
// pt motivatia completa a formatului "facut/prescris Miscare".
export function partialRepsOfLog(log, isSequential) {
  const str = log.result || ''
  let segment
  if (isSequential) {
    segment = str
  } else {
    const plusIdx = str.indexOf('+')
    if (plusIdx === -1) return 0
    segment = str.slice(plusIdx + 1)
  }
  return segment.split(',').reduce((sum, seg) => {
    const match = seg.trim().match(/^(\d+(\.\d+)?)/)
    return match ? sum + parseFloat(match[1]) : sum
  }, 0)
}
export function sortSectionLogs(arr, formatId, formatConfig) {
  const format = formatId ? getFormat(formatId) : null
  if (format?.family === 'sets') {
    const weightScored = isWeightScoredSetsFormat(formatConfig, formatId)
    const withScore = arr.map(log => {
      // EMOM MIXED-UNIT AGGREGATION SAFETY - resolved from THIS log's own
      // frozen prescription_snapshot (historical truth, never the current
      // `wods` row) - null for every non-structured format/log, which
      // computeSetsScore treats as "no unit info, trust the sum" (unchanged).
      const unitsByKey = resolveStationUnitsByKey(formatId, formatConfig, log.prescription_snapshot?.movements)
      const score = setsDisplayScore(formatId, formatConfig, log.sets, unitsByKey)
      const rankScore = (weightScored && score != null) ? toKgForRanking(score, log.profile?.weight_unit || 'kg') : score
      return { ...log, _setsScore: score, _setsRankScore: rankScore }
    })
    const comparaSets = (a, b) => {
      if (a._setsRankScore == null && b._setsRankScore == null) return new Date(a.logged_at) - new Date(b.logged_at)
      if (a._setsRankScore == null) return 1
      if (b._setsRankScore == null) return -1
      if (a._setsRankScore !== b._setsRankScore) return b._setsRankScore - a._setsRankScore
      return new Date(a.logged_at) - new Date(b.logged_at)
    }
    const byMemberSets = {}
    withScore.forEach(log => {
      const id = log.member_id
      if (!byMemberSets[id] || comparaSets(log, byMemberSets[id]) < 0) byMemberSets[id] = log
    })
    return Object.values(byMemberSets).sort(comparaSets)
  }
  if (format?.family === 'chained') {
    const comparaChained = (a, b) => {
      const sa = a.log_meta?.totalReps, sb = b.log_meta?.totalReps
      if (sa == null && sb == null) return new Date(a.logged_at) - new Date(b.logged_at)
      if (sa == null) return 1
      if (sb == null) return -1
      if (sa !== sb) return sb - sa
      return new Date(a.logged_at) - new Date(b.logged_at)
    }
    const byMemberChained = {}
    arr.forEach(log => {
      const id = log.member_id
      if (!byMemberChained[id] || comparaChained(log, byMemberChained[id]) < 0) byMemberChained[id] = log
    })
    return Object.values(byMemberChained).sort(comparaChained)
  }
  // SCORING_MODEL_ARCHITECTURE_VNEXT.md sectiunea 11/19 - logurile noi
  // (post-Faza 0) au completion_state scris explicit la salvare, citit
  // direct aici; logurile vechi (completion_state NULL) cad pe inferenta
  // veche (!!time_result), byte-identic cu comportamentul de dinainte.
  const finished = (log) => log.completion_state != null ? log.completion_state === 'completed' : !!log.time_result
  const isSequential = isSequentialFormat(formatId, formatConfig)
  const compara = (a, b) => {
    const fa = finished(a), fb = finished(b)
    if (fa !== fb) return fa ? -1 : 1
    if (fa) {
      const diffTime = parseTimeResult(a.time_result) - parseTimeResult(b.time_result)
      if (diffTime !== 0 && !Number.isNaN(diffTime)) return diffTime
      return new Date(a.logged_at) - new Date(b.logged_at)
    }
    if (!isSequential) {
      const diffRunde = (parseRoundsScore(b.result) || 0) - (parseRoundsScore(a.result) || 0)
      if (diffRunde !== 0) return diffRunde
    }
    const diffPartial = partialRepsOfLog(b, isSequential) - partialRepsOfLog(a, isSequential)
    if (diffPartial !== 0) return diffPartial
    return new Date(a.logged_at) - new Date(b.logged_at)
  }
  const byMember = {}
  arr.forEach(log => {
    const id = log.member_id
    if (!byMember[id] || compara(log, byMember[id]) < 0) byMember[id] = log
  })
  return Object.values(byMember).sort(compara)
}

// Pentru fiecare numar de reps logat, ia cea mai mare greutate introdusa si o
// compara cu cel mai mare PR existent la aceeasi miscare + acelasi numar
// exact de reps (PR-urile se tin separat pe numar de reps). Returneaza doar
// candidatii care bat recordul - generalizarea computeSkillPrCandidates() din
// App.jsx, acum reutilizabila pentru orice log family:'sets' (nu doar Skill
// Weightlifting).
// Cheile din rowsByKey NU sunt mereu nume de miscari - la EMOM/Tabata/Complex
// sunt etichete de interval/runda ("Min 1", "Rundă 1"), deci PR-ul trebuie
// atribuit lui `fallbackMovement` (nume unic, pasat de apelant). Doar la
// Superset (movementKeyed=true) cheile chiar sunt nume de miscari distincte -
// fara acest flag, PR-urile de la miscari diferite se amestecau sub un
// singur nume generic (skill_name).
export function computeSetsPrCandidates(fallbackMovement, rowsByKey, weightUnit, prDate, movementKeyed = false) {
  const out = []
  Object.entries(rowsByKey || {}).forEach(([cheie, rows]) => {
    const movement = (movementKeyed && cheie && cheie.trim()) ? cheie : fallbackMovement
    if (!movement) return
    const bestByReps = {}
    ;(rows || []).forEach(r => {
      const reps = parseInt(r.reps), weight = parseFloat(r.weight)
      if (!reps || !weight) return
      if (!bestByReps[reps] || weight > bestByReps[reps]) bestByReps[reps] = weight
    })
    Object.entries(bestByReps).forEach(([repsStr, weight]) => {
      const reps = parseInt(repsStr)
      const existingKg = (prDate || [])
        .filter(r => r.movement === movement && (r.reps || 1) === reps && (r.unit === 'kg' || r.unit === 'lbs'))
        .map(r => convertWeight(parseFloat(r.value), r.unit, weightUnit))
      const bestExisting = existingKg.length ? Math.max(...existingKg) : null
      out.push({ movement, reps, weight, unit: weightUnit, isNewPr: bestExisting == null || weight > bestExisting })
    })
  })
  return out.filter(c => c.isNewPr).sort((a, b) => a.reps - b.reps)
}
