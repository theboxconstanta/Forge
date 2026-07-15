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
    },
  },
  'Chipper': {
    family: 'scored', scoreMode: 'fortime',
    config: { timeCapSec: { type: 'duration', required: false, labelKey: 'fmtTimeCapOptional' } },
  },
  'Ladder': {
    // La fel ca "For Time": o schema 21-15-9 e tot o secventa, nu runde
    // repetate - sequentialPartial: daca nu termini, loghezi direct
    // repetarile facute la fiecare treapta a scarii.
    family: 'scored', scoreMode: 'fortime_or_amrap', sequentialPartial: true,
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
    if (simplu) { const idx = movements.indexOf(simplu[2].trim()); if (idx !== -1) partialArr[idx] = simplu[1] }
  })
  return partialArr
}

export function composeAmrapResult(roundsCompleted, partialArr, movements) {
  if (!(roundsCompleted || '').toString().trim()) return ''
  const partialStr = composePartialText(partialArr, movements)
  return `${roundsCompleted.toString().trim()} runde${partialStr ? ' + ' + partialStr : ' complete'}`
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
export function weightKeyForVariant(nivel, gender) {
  const v = VARIANTE_WEIGHT_BASE.find(v => v.nivel === nivel)
  if (!v) return null
  return `${v.key}_weight_${gender === 'feminin' ? 'female' : 'male'}`
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
export function isSequentialFormat(formatId, config) {
  if (formatId === 'For Time') return config?.structure !== 'Repeated Rounds'
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

// "Not RXd" = greutatea logata difera de cea prescrisa a variantei (vezi
// weightMatches), SAU miscarile logate difera de cele prescrise (vezi
// movementsChanged), SAU (la formatele cu time cap real - For Time/RFT/
// Ladder, scoreMode 'fortime_or_amrap') nu s-a terminat in time cap (fara
// time_result). AMRAP nu are concept de "neterminat" (scorul e mereu cat ai
// facut in timp), deci nu intra la a treia conditie. loggedMovements/
// prescribedMovements sunt optionale - apelantii care nu le au inca (ex.
// inainte de refactorul Mixed Categories) primesc acelasi rezultat ca
// inainte, fara sa strice apelurile existente. Derivat la citire, nu stocat -
// daca adminul corecteaza greutatea/miscarile prescrise ulterior, eticheta
// ramane consistenta cu valoarea curenta, fara o a doua sursa de adevar care
// poate desincroniza. Acelasi semnal e folosit peste tot (Jurnal, Clasament,
// pop-up-ul de felicitare) - un membru care a schimbat doar o miscare (nu
// greutatea) trebuie sa apara la fel de "Not RXd" oriunde, nu doar in
// gruparea Mixed Categories de pe Clasament.
export function isNotRxd(log, prescribedWeight, formatId, config, loggedMovements, prescribedMovements) {
  const greutateDiferita = !!prescribedWeight?.trim() && !!log?.weight_logged?.trim() && !weightMatches(log.weight_logged, prescribedWeight)
  const neterminatInTimp = effectiveScoreMode(formatId, config) === 'fortime_or_amrap' && !log?.time_result
  const miscariSchimbate = movementsChanged(loggedMovements, prescribedMovements)
  return greutateDiferita || neterminatInTimp || miscariSchimbate
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

// "Mixed Categories" (Clasament) = compozitia antrenamentului difera de cea
// prescrisa variantei - greutate diferita SAU miscari schimbate. Diferit de
// isNotRxd (care include si "neterminat in time cap" - o chestiune de
// performanta, nu de compozitie): cineva care a facut EXACT miscarile si
// greutatea prescrisa dar n-a terminat in time cap ramane in categoria lui
// normala (doar cu badge-ul "Not RXd"), nu e mutat la Mixed Categories.
export function isMixedCategory(weightLogged, prescribedWeight, loggedMovements, prescribedMovements) {
  const greutateDiferita = !!prescribedWeight?.trim() && !!weightLogged?.trim() && !weightMatches(weightLogged, prescribedWeight)
  return greutateDiferita || movementsChanged(loggedMovements, prescribedMovements)
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
  movs.forEach(m => { out[m] = targetSets ? rowsOf(targetSets) : [] })
  return out
}

// Calculeaza scorul unui format family:'sets' cu scoringMode configurabil
// (Tabata/Intervals: Total Reps = suma tuturor randurilor, Lowest Reps = cea
// mai mica valoare dintre randuri cu reps completat; Complex: Max Weight/
// Total Weight, vezi mai jos). Intoarce null daca nu exista randuri cu date
// valide (reps sau greutate, dupa caz) sau formatul nu are scoringMode.
export function computeSetsScore(formatId, config, rowsByKey) {
  const scoringMode = config?.scoringMode
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
  const repsValues = Object.values(rowsByKey || {})
    .flat()
    .map(r => parseInt(r?.reps))
    .filter(n => !isNaN(n))
  if (repsValues.length === 0) return null
  if (scoringMode === 'Total Reps') return repsValues.reduce((a, b) => a + b, 0)
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
export function setsDisplayScore(formatId, config, rowsByKey) {
  const configured = computeSetsScore(formatId, config, rowsByKey)
  if (configured != null) return configured
  return maxWeightFromSets(rowsByKey)
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
