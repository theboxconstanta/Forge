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
export function isSequentialFormat(formatId, config) {
  if (formatId === 'For Time') return config?.structure !== 'Repeated Rounds'
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

// "Not RXd" = greutatea logata e SUB standardul prescris al variantei (vezi
// greutateEsteSubStandard - Faza 3, regula enteredWeight >= standard, nu mai
// egalitate exacta), SAU miscarile logate difera de cele prescrise (vezi
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
  const greutateDiferita = greutateEsteSubStandard(log?.weight_logged, prescribedWeight)
  const neterminatInTimp = effectiveScoreMode(formatId, config) === 'fortime_or_amrap' && !log?.time_result
  const miscariSchimbate = movementsChanged(loggedMovements, prescribedMovements)
  // P9.5.2 - a non-null performed_prescription is the athlete's own explicit
  // record that they performed a MODIFIED / scaled version (per-movement load /
  // distance / calories, or a movement substitution). The save path only writes
  // it when the performed overlay materially differs from the programmed
  // prescription (performedIsModified), so its mere presence is authoritative:
  // the result is Modified / Not RX regardless of the legacy single-weight
  // comparison above. The variant itself is unchanged (RX stays RX) - only the
  // RX/Modified classification flips.
  const performedModificat = log?.performed_prescription != null
  return greutateDiferita || neterminatInTimp || miscariSchimbate || performedModificat
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
// prescrisa variantei - greutate sub standard (vezi greutateEsteSubStandard)
// SAU miscari schimbate. Diferit de
// isNotRxd (care include si "neterminat in time cap" - o chestiune de
// performanta, nu de compozitie): cineva care a facut EXACT miscarile si
// greutatea prescrisa dar n-a terminat in time cap ramane in categoria lui
// normala (doar cu badge-ul "Not RXd"), nu e mutat la Mixed Categories.
export function isMixedCategory(weightLogged, prescribedWeight, loggedMovements, prescribedMovements) {
  const greutateDiferita = greutateEsteSubStandard(weightLogged, prescribedWeight)
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
const TIME_CAP_LABEL_FORMAT_IDS = ['For Time', 'Chipper', 'Ladder', 'RFT', 'Partner WOD']

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
const MEMBER_ROUNDS_KEYS = ['rounds', 'totalRounds']
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
const MEMBER_SUPPRESSED_FIELDS = new Set(['structure'])
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

  const roundsKey = MEMBER_ROUNDS_KEYS.find(k => fields[k] && cfg[k] != null && cfg[k] !== '' && !consumed.has(k))
  if (roundsKey) {
    prescriptionLines.push(`${cfg[roundsKey]} ${t?.memberWodRoundsLabel || 'Rounds'}`)
    consumed.add(roundsKey)
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
  const schemaDefault = formatId ? getFormat(formatId)?.config?.scoringMode?.default : null
  return config?.scoringMode || schemaDefault || null
}

// Calculeaza scorul unui format family:'sets' cu scoringMode configurabil
// (Tabata/Intervals: Total Reps = suma tuturor randurilor, Lowest Reps = cea
// mai mica valoare dintre randuri cu reps completat; Complex: Max Weight/
// Total Weight, vezi mai jos). Intoarce null daca nu exista randuri cu date
// valide (reps sau greutate, dupa caz) sau formatul nu are scoringMode.
export function computeSetsScore(formatId, config, rowsByKey) {
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
      const score = setsDisplayScore(formatId, formatConfig, log.sets)
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
