// Faza 6 - Native Workout Section Editor. Vezi discutia de arhitectura din
// aceeasi sesiune: tabela legacy `wods` are DOAR 4 sloturi fixe (warmup/
// skill/skill2/o singura sectiune "primara" cu variante de scalare) - Member
// View si Logging (FormatLogger) citesc STRICT acel slot primar, nu o lista.
// Editorul (App.jsx, SectionCard/PrimarySectionBody) permite oricate
// sectiuni (persistate integral in Workout Engine V2 prin
// sync_workout_engine_v2, Faza 5B), dar SALVAREA in `wods` (deci si
// vizibilitatea in Member View) e blocata (validateSectionsForLegacy) daca
// lista curenta nu poate fi reprezentata fidel in modelul legacy (exact 1
// sectiune primara, maxim 3 sectiuni non-primare) - decizie explicita a
// userului: fara "publish partial vizibil", fara badge-uri de avertizare, un
// gate dur pana apare noul Member View (cand aceasta validare se poate
// elimina complet).
//
// Functii pure, separate de App.jsx (acelasi tipar ca workoutEngine.js/
// workoutFormats.js) ca sa poata fi testate direct, fara sa importe intreaga
// componenta React.

import { VARIANTE_WEIGHT_BASE, AUTO_DURATION_FORMAT_IDS, estimateTotalDurationSec } from './workoutFormats'
import {
  buildLegacyArtifactsForVariant,
  parsePastedMovementLine,
  validatePrescriptionsForPublish,
  emptyPrescriptions,
} from './prescriptionContract.js'

// Extrage greutatea dintr-o linie de miscare deja normalizata (ex. "21
// Thrusters @ 43kg" sau "21 Thrusters @ 61/43kg") - "X/Y" e conventia RX
// barbati/femei (mai greu/mai usor), o singura valoare se aplica ambelor
// genuri (majoritatea miscarilor scalate n-au greutate diferentiata pe gen
// scrisa explicit in text).
export const extractGreutateDinMiscare = (text) => {
  const m = text.match(/@\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(kg|lbs)/i)
  if (!m) return null
  const unit = m[3].toLowerCase()
  const male = `${m[1]}${unit}`
  const female = m[2] ? `${m[2]}${unit}` : male
  return { male, female }
}

export const parseLiniiWod = (text) => text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

// Nivelele de scalare ale sectiunii PRIMARE (singura care poarta variante) -
// acelasi 4 nivele ca VARIANTE_WEIGHT_BASE (workoutFormats.js), plus stilul
// vizual folosit deja de editor (LevelDot/culori) inainte de Faza 6.
export const VARIANT_LEVELS = [
  { key: 'onramp', label: 'OnRamp', nivel: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB' },
  { key: 'beginner', label: 'Beginner', nivel: 'Beginner', culoare: '#0E0E0E', bg: '#f0f0f0' },
  { key: 'intermediate', label: 'Intermediate', nivel: 'Intermediate', culoare: '#633806', bg: '#FAEEDA' },
  { key: 'rx', label: 'RX', nivel: 'RX', culoare: '#791F1F', bg: '#FCEBEB' },
]

let sectionIdSeq = 0
export const newSectionId = () => `sec-${Date.now()}-${sectionIdSeq++}`

export const emptySectionVariants = () => Object.fromEntries(
  VARIANTE_WEIGHT_BASE.map(v => [v.key, { instances: [], movements: [], quickAdd: '', paste: '', weight: { male: '', female: '' }, note: '' }])
)

// Per-Movement Prescription Engine (P5') - hydrate a legacy variant's editable
// instance list from its `movements_{k}` text lines + optional shared
// `{k}_weight_{male,female}` global pair. Same contract + shared parser as
// forge-admin-web's sectionEditing.ts (hydrateInstancesFromLegacy). Pure,
// best-effort, never persisted until the coach saves (architecture doc C.9.1).
const LOADED_NAME_RE_PWA = /\b(snatch|clean|jerk|deadlift|thruster|squat|press|swing|lunge|carry|wall ?ball|barbell|dumbbell|kettlebell|db|kb|complex|shrug|curl|good morning|high pull|overhead)\b/i
export const hydrateInstancesFromLegacy = (lines, globalWeight) => {
  const instances = []
  for (const line of lines || []) {
    const parsed = parsePastedMovementLine(line)
    if (parsed) instances.push(parsed.instance)
  }
  const gm = parseWeightTextPwa(globalWeight?.male)
  const gf = parseWeightTextPwa(globalWeight?.female)
  const anyInlineLoad = instances.some(i => i.load)
  // Only apply the shared global weight pair when NO line already carried an
  // inline `@ x/y` load - a coach uses one convention or the other, not both.
  if ((gm.value != null || gf.value != null) && !anyInlineLoad) {
    const unit = gm.unit || gf.unit || 'kg'
    const spec = { mode: 'sex_specific', male: gm.value, female: gf.value, unit }
    let target = instances.find(i => !i.load && !i.distance && !i.calories && LOADED_NAME_RE_PWA.test(i.name))
    if (!target) target = instances.find(i => !i.load && !i.distance && !i.calories)
    if (target) target.load = spec
  }
  return instances
}
const parseWeightTextPwa = (raw) => {
  const m = (raw || '').trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?/i)
  if (!m) return { value: null, unit: null }
  return { value: parseFloat(m[1]), unit: m[2] ? (/lb/i.test(m[2]) ? 'lb' : 'kg') : null }
}

// O sectiune "primara" (isPrimary) e singura care poate purta variante de
// scalare + durata + nume WOD - restul (non-primare) sunt format+o singura
// miscare+text liber (identic cu WARM-UP/SKILL/SKILL 2 dinainte de Faza 6).
// typeKey === 'warmup' + format === null => card de text liber (fara
// FormatConfigEditor), exact UI-ul WARM-UP de dinainte - orice alt tip
// implicit primeste un format (Weightlifting), la fel ca SKILL dinainte.
// Phase 1B (multi-section scoring) - `scored` is independent of `isPrimary`.
// The primary section is always scored (isPrimary implies scored, enforced
// at read/write time below, not stored redundantly). A non-primary section
// (warmup/skill/skill2) can now ALSO be marked independently scored -
// `warmup`-typed sections are excluded from the toggle in the UI (see
// SectionCard) since Warm-up has no equivalent legacy column to persist it
// (skill_scored/skill2_scored only, Phase 1B migration) and stays
// permanently non-scoreable, unchanged from before this phase.
// Layer 2a.5 (SCORING_PHASE1B_LAYER2A5_SECTION_IDENTITY_INTEGRITY_REPORT.md) -
// `legacySlot` e sursa de adevar pt "carui slot legacy (warmup/skill/
// skill2) apartine sectiunea asta", INDEPENDENT de pozitia ei curenta in
// lista. null pt o sectiune noua, niciodata inca salvata - vezi
// legacyPayloadFromSections mai jos pt de ce distinctia asta conteaza acum
// (inainte de Layer 2a nu conta, continutul "urma pozitia" era inofensiv).
export const createSection = (typeKey, isPrimary = false) => ({
  id: newSectionId(),
  typeKey,
  isPrimary,
  scored: isPrimary,
  legacySlot: null,
  visible: true,
  open: false,
  title: '',
  format: isPrimary ? 'AMRAP' : (typeKey === 'warmup' ? null : 'Weightlifting'),
  formatConfig: {},
  movementName: '',
  text: '',
  durationMin: '20',
  durationSec: '0',
  name: '',
  variants: emptySectionVariants(),
})

// Sectiunile implicite la crearea unui WOD nou - familiare coach-ului
// (Warm-up/Skill/Workout, exact structura de dinainte de Faza 6), dar acum
// simple valori initiale intr-o lista libera, nu sloturi fixe - coach-ul
// poate adauga/sterge/reordona oricare din ele.
export const DEFAULT_NEW_WOD_SECTIONS = () => [
  createSection('warmup', false),
  createSection('skill', false),
  createSection('metcon', true),
]

// Reconstruieste lista de sectiuni dintr-un rand `wods` (legacy) - folosita
// la editare. WARM-UP/SKILL/SKILL 2 apar ca sectiuni DOAR daca au continut
// real sau vizibilitate explicit dezactivata (altfel formularul ar arata
// carduri goale "fantoma" pt sloturi niciodata folosite) - sectiunea primara
// e mereu prezenta (orice WOD salvat are un workout de baza).
//
// DATORIE DE MIGRATIE CUNOSCUTA (acceptata deliberat, Faza 6, discutata cu
// userul dupa livrarea Fazei 6): typeKey pt sectiunile non-primare e
// HARDCODAT aici ('warmup'/'skill'), NU citit din `wods` (care n-are nicio
// coloana pt asta) - un tip custom ales de coach (ex. 'cooldown') salvat
// corect in workout_sections.section_type_id la primul save e "uitat" la
// urmatoarea editare, fiindca formularul se re-hidrateaza din randul legacy,
// nu din V2. Impact ASTAZI: zero - nimic nu citeste inca section_type_id din
// V2 (Member View citeste doar coloanele `wods`). Decizie: NU se repara
// izolat (ar insemna fie sa umflam schema `wods` pt un model pe cale de
// disparitie, fie sa mutam prematur doar o felie din read-path-ul spre V2).
//
// CRITERIU DE ACCEPTARE EXPLICIT pt urmatoarea migratie a read-path-ului spre
// Workout Engine V2 (editor si/sau Member View - orice faza care incepe sa
// citeasca native din workout_sections in loc sa reconstruiasca din `wods`):
// tipurile de sectiune TREBUIE hidratate din Workout Engine V2
// (workout_sections.section_type_id), NICIODATA reconstruite din coloanele
// legacy `wods`. Aceasta functie (sectionsFromLegacyWod) ramane calea de
// fallback DOAR pt WOD-uri fara randuri V2 inca - nu trebuie sa devina si ea
// sursa de tip odata ce V2 exista pt un WOD dat.
export const sectionsFromLegacyWod = (w, opts = {}) => {
  if (!w) return DEFAULT_NEW_WOD_SECTIONS()
  const open = !!opts.open
  const sections = []
  if ((w.warmup || []).length > 0 || w.warmup_visible === false) {
    sections.push({
      id: newSectionId(), typeKey: 'warmup', isPrimary: false, scored: false, legacySlot: 'warmup', visible: w.warmup_visible !== false, open,
      title: '', format: null, formatConfig: {}, movementName: '', text: (w.warmup || []).join('\n'),
      durationMin: '20', durationSec: '0', name: '', variants: emptySectionVariants(),
    })
  }
  if ((w.skill || []).length > 0 || w.skill_name || w.skill_visible === false) {
    sections.push({
      id: newSectionId(), typeKey: 'skill', isPrimary: false, scored: !!w.skill_scored, legacySlot: 'skill', visible: w.skill_visible !== false, open,
      title: '', format: w.skill_type || 'Weightlifting', formatConfig: w.skill_format_config || {},
      movementName: w.skill_name || '', text: (w.skill || []).join('\n'),
      durationMin: '20', durationSec: '0', name: '', variants: emptySectionVariants(),
    })
  }
  if ((w.skill2 || []).length > 0 || w.skill2_name || w.skill2_visible === false) {
    sections.push({
      id: newSectionId(), typeKey: 'skill', isPrimary: false, scored: !!w.skill2_scored, legacySlot: 'skill2', visible: w.skill2_visible !== false, open,
      title: '', format: w.skill2_type || 'Weightlifting', formatConfig: w.skill2_format_config || {},
      movementName: w.skill2_name || '', text: (w.skill2 || []).join('\n'),
      durationMin: '20', durationSec: '0', name: '', variants: emptySectionVariants(),
    })
  }
  const [dMin, dSec] = (w.duration || '20:0').split(':')
  sections.push({
    id: newSectionId(), typeKey: 'metcon', isPrimary: true, scored: true, visible: true, open,
    title: '', format: w.type || 'AMRAP', formatConfig: w.format_config || {},
    movementName: '', text: '', durationMin: dMin || '20', durationSec: dSec || '0', name: w.name || '',
    variants: Object.fromEntries(VARIANTE_WEIGHT_BASE.map(v => {
      const legacyLines = w[`movements_${v.key}`] || []
      const weight = { male: w[`${v.key}_weight_male`] || '', female: w[`${v.key}_weight_female`] || '' }
      const structuredMovements = w.movement_prescriptions?.variants?.[v.key]?.movements
      const instances = Array.isArray(structuredMovements) && structuredMovements.length > 0
        ? structuredMovements.map(m => ({ ...m }))
        : hydrateInstancesFromLegacy(legacyLines, weight)
      return [v.key, { instances, movements: legacyLines, quickAdd: '', paste: '', weight, note: w[`notes_${v.key}`] || '' }]
    })),
  })
  return sections
}

// Inversul de mai sus - mapeaza lista de sectiuni (oricate) pe cele 4 sloturi
// fixe din `wods`. Sectiunea primara -> coloanele principale + variante de
// scalare.
//
// Layer 2a.5 fix (SCORING_PHASE1B_LAYER2A5_SECTION_IDENTITY_INTEGRITY_REPORT.md) -
// pana la Faza 6, mapare-a non-primarelor era STRICT POZITIONALA (primele 3
// din lista, in ordinea curenta -> warmup/skill/skill2, "continutul urmeaza
// pozitia") - inofensiv atunci, fiindca nimic nu citea `workout_sections`
// pt scoring. Layer 2a a facut `workout_section_id` identitate de scoring
// (wod_logs.workout_section_id) - de-atunci, o simpla reordonare/adaugare/
// stergere putea muta CONTINUTUL unei sectiuni deja logate intr-o alta
// coloana legacy (deci alt slot_key, alt workout_sections.id de facto -
// bug real gasit si reprodus live la finalul Layer 2a: continutul "Back
// Squat" a ajuns in coloana warmup dupa adaugarea unei sectiuni noi).
//
// Fix: fiecare sectiune deja existenta (incarcata prin sectionsFromLegacyWod,
// deci deja salvata cel putin o data) poarta legacySlot - ISI PASTREAZA
// slotul, indiferent unde ajunge in lista. DOAR sectiunile cu adevarat noi
// (legacySlot null - niciodata inca salvate, deci fara identitate anterioara
// de protejat) ocupa sloturile ramase libere, in ordinea lor curenta din
// lista - acelasi comportament pozitional de dinainte, dar acum limitat
// STRICT la cazul in care chiar nu exista nimic de stricat.
// Layer 2b.1 (PROGRAMMING_SKILL_SECTION_FORMAT_INHERITANCE_FIX_REPORT.md) -
// extras din fostul corp al legacyPayloadFromSections, ca ambele "directii"
// (ce se scrie in payload ACUM, si ce legacySlot ar trebui sa poarte
// sectiunile in memorie DUPA un salvare reusit) sa foloseasca EXACT acelasi
// calcul, o singura data - niciodata doua implementari separate care ar
// putea diverge intre ele.
// Bug real gasit + reprodus (raport Fix SKILL Sections Rendering as
// WARM-UP): o sectiune noua tastata explicit "Skill" (sau orice alt tip
// non-warmup) de coach, NESCORATA, ajungea in slotul legacy `warmup` doar
// pt ca `warmup` era primul verificat in bucla pozitionala de mai jos -
// typeKey-ul ales de coach nu era consultat DELOC la alegerea slotului.
// Pe Member View, slotul `warmup` are mereu titlul hardcodat "WARM-UP"
// (App.jsx, indiferent de typeKey), deci sectiunea aparea gresit ca
// Warm-up. Fix: candidatii se impart intai dupa typeKey (warmup vs
// non-warmup) - un candidat non-warmup nu mai concureaza NICIODATA pe
// slotul warmup, si invers. `validateSectionsForLegacy` (mai jos in fisier)
// garanteaza dinainte de salvare ca exista loc (max 1 warmup + max 2
// non-warmup) - fara acea garantie, un candidat ramas fara slot ar fi
// disparut silentios din payload, nu doar mislabeled.
export const assignNonPrimarySlots = (sections) => {
  const nonPrimary = sections.filter(s => !s.isPrimary)
  const bySlot = { warmup: null, skill: null, skill2: null }
  const unassigned = []
  for (const s of nonPrimary) {
    // legacySlot-ul existent e onorat DOAR daca ramane compatibil cu
    // typeKey-ul CURENT al sectiunii - slotul warmup n-are nicio coloana de
    // format/nume (nonPrimaryFields mai jos), deci o sectiune re-tastata
    // intre warmup <-> non-warmup nu-si mai poate pastra slotul vechi (bug
    // real gasit separat: re-tastarea unui WARM-UP existent ca SKILL
    // continua sa scrie in coloanele warmup, pierzand continutul, fiindca
    // legacySlot ramanea "warmup" dupa schimbarea typeKey-ului).
    const slotStillCompatible = s.legacySlot && ((s.legacySlot === 'warmup') === (s.typeKey === 'warmup'))
    if (slotStillCompatible && !bySlot[s.legacySlot]) bySlot[s.legacySlot] = s
    else unassigned.push(s)
  }
  const warmupCandidati = unassigned.filter(s => s.typeKey === 'warmup')
  const otherCandidati = unassigned.filter(s => s.typeKey !== 'warmup')

  // Un candidat NOU marcat `scored` primeste prioritate pe skill/skill2 -
  // coloana warmup n-are NICIUN camp de format/scored (nonPrimaryFields mai
  // jos scrie doar warmup/warmup_visible pt ea), deci o sectiune scorata
  // ajunsa acolo si-ar pierde silentios formatul si flagul `scored`. Restul
  // candidatilor non-warmup (nescorati) raman POZITIONALI intre ei
  // (skill/skill2, in ordinea lor din lista) - comportament neschimbat pt
  // cazul fara nimic de pierdut, doar nu mai concureaza cu warmup.
  const scoredCandidati = otherCandidati.filter(s => s.scored)
  const restCandidati = otherCandidati.filter(s => !s.scored)
  for (const slot of ['skill', 'skill2']) {
    if (!bySlot[slot] && scoredCandidati.length > 0) bySlot[slot] = scoredCandidati.shift()
  }
  for (const slot of ['skill', 'skill2']) {
    if (!bySlot[slot] && restCandidati.length > 0) bySlot[slot] = restCandidati.shift()
  }
  if (!bySlot.warmup && warmupCandidati.length > 0) bySlot.warmup = warmupCandidati.shift()
  return bySlot
}

// Sectiunile deja existente cu un legacySlot inca COMPATIBIL isi pastreaza
// slotul prin constructie (assignNonPrimarySlots de mai sus le respecta
// primele) - dar doua categorii de sectiuni au nevoie sa fie "stampilate"
// (sau re-stampilate) dupa un salvare reusit: cele INCA null (niciodata
// salvate) SI cele al caror slot vechi a devenit incompatibil cu typeKey-ul
// lor curent (re-tastate intre warmup <-> non-warmup - vezi comentariul din
// assignNonPrimarySlots). Fara actualizarea si pt a doua categorie, starea
// locala din editor ar continua sa creada ca sectiunea e inca in vechiul ei
// slot pana la un reload complet, desi salvarea in DB s-a facut deja corect
// in noul slot. Returneaza un Map id->slot, aplicat de apelant (App.jsx)
// peste starea locala dupa succesul salvarii.
export const legacySlotAssignmentAfterSave = (sections) => {
  const bySlot = assignNonPrimarySlots(sections)
  const map = new Map()
  for (const slot of ['warmup', 'skill', 'skill2']) {
    const s = bySlot[slot]
    if (s && s.legacySlot !== slot) map.set(s.id, slot)
  }
  return map
}

export const legacyPayloadFromSections = (sections) => {
  const primary = sections.find(s => s.isPrimary) || sections[0] || createSection('metcon', true)
  const { warmup: warmupS, skill: skillS, skill2: skill2S } = assignNonPrimarySlots(sections)

  const nonPrimaryFields = (prefix, s) => {
    if (prefix === 'warmup') return { warmup: s ? parseLiniiWod(s.text) : [], warmup_visible: s ? s.visible : true }
    return {
      [prefix]: s ? parseLiniiWod(s.text) : [],
      [`${prefix}_name`]: s ? (s.movementName.trim() || null) : null,
      [`${prefix}_type`]: s ? (s.format || 'Weightlifting') : 'Weightlifting',
      [`${prefix}_format_config`]: s && Object.keys(s.formatConfig || {}).length > 0 ? s.formatConfig : null,
      [`${prefix}_visible`]: s ? s.visible : true,
      // Phase 1B - independently-scored flag for this slot (loggingMode
      // 'required' at the Workout Engine V2 sync boundary, see
      // mapLegacyWodToWorkout). false when the slot is empty, matching
      // every other field here.
      [`${prefix}_scored`]: s ? !!s.scored : false,
    }
  }

  const autoDurationSec = AUTO_DURATION_FORMAT_IDS.includes(primary.format)
    ? estimateTotalDurationSec(primary.format, primary.formatConfig) : null
  const durationStr = autoDurationSec != null
    ? `${Math.floor(autoDurationSec / 60)}:${String(autoDurationSec % 60).padStart(2, '0')}`
    : `${parseInt(primary.durationMin) || 0}:${String(parseInt(primary.durationSec) || 0).padStart(2, '0')}`

  // Per-Movement Prescription Engine (P5') - `instances` is canonical. For each
  // variant with instances: emit the structured prescription AND regenerate the
  // legacy movements_{k} lines + lossy {k}_weight_{male,female} mirror from that
  // same structure (identical to forge-admin-web's legacyPayloadFromSections).
  const variantFields = {}
  const prescriptions = emptyPrescriptions()
  for (const v of VARIANTE_WEIGHT_BASE) {
    const sv = primary.variants?.[v.key] || { instances: [], movements: [], weight: { male: '', female: '' }, note: '' }
    const instances = sv.instances || []
    if (instances.length > 0) {
      prescriptions.variants[v.key] = { movements: instances }
      const art = buildLegacyArtifactsForVariant(instances)
      variantFields[`movements_${v.key}`] = art.lines
      variantFields[`${v.key}_weight_male`] = art.weightMale
      variantFields[`${v.key}_weight_female`] = art.weightFemale
    } else {
      variantFields[`movements_${v.key}`] = sv.movements || []
      variantFields[`${v.key}_weight_male`] = (sv.weight?.male || '').trim() || null
      variantFields[`${v.key}_weight_female`] = (sv.weight?.female || '').trim() || null
    }
    variantFields[`notes_${v.key}`] = (sv.note || '').trim() || null
  }

  return {
    type: primary.format || 'AMRAP',
    duration: durationStr,
    format_config: Object.keys(primary.formatConfig || {}).length > 0 ? primary.formatConfig : null,
    name: primary.name.trim() || null,
    movement_prescriptions: prescriptions,
    ...nonPrimaryFields('warmup', warmupS),
    ...nonPrimaryFields('skill', skillS),
    ...nonPrimaryFields('skill2', skill2S),
    ...variantFields,
  }
}

// Member Performance, Faza 4 (Completitudine Metadata Programming) - un gol
// real, confirmat pe date de productie, nu ipotetic: doua Sectiuni
// Strength Sets reale au fost salvate cu format_config:{} (fara
// setsScheme), desi schema din workoutFormats.js declara deja
// `setsScheme: { required: true }` de la introducerea campului
// (2026-07-05) - nimic, niciodata, nu a validat efectiv acel `required`
// (nici acest gate, nici editorul de format). Vezi
// MEMBER_PERFORMANCE_PHASE4_PROGRAMMING_METADATA_COMPLETENESS_
// IMPLEMENTATION_REPORT.md pt evidenta completa (Quick Create + manual,
// ambele salveaza prin acelasi gate, deci un singur fix aici acopera
// ambele cai de autoring).
//
// Scop deliberat ingust - NU un validator generic pt orice camp
// `required:true` din intreg catalogul (AMRAP durationSec, EMOM
// totalRounds etc. - acelea au deja `default` si sunt pre-completate de
// editor, deci nu au acelasi gol real). Doar cele doua formate
// movement-performance de care depinde rezolvatorul Fazei 3
// (movementHistory.js): Strength Sets.setsScheme si
// Superset.movements/targetSets. Complex.complexMovements e in afara
// scopului (nu e citit de rezolvator, e o preocupare generala de
// Programming/catalog); Build to Heavy/1RM.targetLabel are deja default
// ('1RM') si acoperire reala 100% (Faza 3) - nimic de reparat acolo.
const MOVEMENT_PERFORMANCE_REQUIRED_FIELDS = {
  'Strength Sets': ['setsScheme'],
  'Superset': ['movements', 'targetSets'],
}

function isRequiredFieldMissing(fieldKey, value) {
  if (fieldKey === 'targetSets') return !(Number(value) > 0)
  return !Array.isArray(value) || value.length === 0
}

export function validateMovementPerformanceMetadata(sections, t) {
  const errors = []
  sections.forEach((s) => {
    const requiredFields = MOVEMENT_PERFORMANCE_REQUIRED_FIELDS[s.format]
    if (!requiredFields) return
    const config = s.formatConfig || {}
    const missing = requiredFields.filter((key) => isRequiredFieldMissing(key, config[key]))
    if (missing.length > 0) errors.push(t.wodSectionsErrorMissingFormatFields(s.format))
  })
  return errors
}

// Gate de validare (decizia userului, Faza 6 - nu badge/vizibilitate
// partiala) - salvarea e blocata complet daca lista curenta de sectiuni nu
// poate fi reprezentata fidel in modelul legacy (Member View + Logging
// citesc STRICT acel model). Se elimina cand noul Member View (viitoare
// faza) nu mai depinde de coloanele fixe din `wods`.
export const validateSectionsForLegacy = (sections, t) => {
  const errors = []
  const primaryCount = sections.filter(s => s.isPrimary).length
  const nonPrimary = sections.filter(s => !s.isPrimary)
  const nonPrimaryCount = nonPrimary.length
  if (primaryCount !== 1) errors.push(t.wodSectionsErrorPrimaryCount(primaryCount))
  if (nonPrimaryCount > 3) {
    errors.push(t.wodSectionsErrorTooMany(nonPrimaryCount))
  } else {
    // Fix SKILL Sections Rendering as WARM-UP - "<=3 total" singur nu
    // garanta ca fiecare sectiune are un slot legacy compatibil: modelul
    // are DOAR 1 slot warmup si 2 sloturi non-warmup (skill/skill2), nu
    // "3 oricare". 3 sectiuni typeKey=skill (fara niciun warmup) treceau
    // validarea veche dar una din ele ar fi ramas fara slot compatibil -
    // assignNonPrimarySlots ar fi facut-o sa dispara silentios din payload
    // in loc doar sa fie mislabeled. Verificat separat, dupa gate-ul de
    // total, ca sa nu dubleze eroarea cand oricum sunt prea multe in total.
    const warmupCount = nonPrimary.filter(s => s.typeKey === 'warmup').length
    const otherCount = nonPrimaryCount - warmupCount
    if (warmupCount > 1) errors.push(t.wodSectionsErrorTooManyWarmup(warmupCount))
    if (otherCount > 2) errors.push(t.wodSectionsErrorTooManyOther(otherCount))
  }
  errors.push(...validateMovementPerformanceMetadata(sections, t))
  errors.push(...validatePrescriptionCompleteness(sections))
  return { valid: errors.length === 0, errors }
}

// Per-Movement Prescription Engine save gate (P5') - `wods` has no draft state,
// so completeness is enforced at save (architecture doc C.9.2): a load /
// distance / calories the coach started must be fully filled; a blank reps
// never blocks (it is workout structure, the scheme may carry the count). Only
// variants with structured instances are checked. Same rules as
// forge-admin-web's validatePrescriptionCompleteness (shared contract).
export const validatePrescriptionCompleteness = (sections) => {
  const primary = sections.find(s => s.isPrimary)
  if (!primary) return []
  const doc = emptyPrescriptions()
  for (const v of VARIANTE_WEIGHT_BASE) {
    const inst = primary.variants?.[v.key]?.instances || []
    if (inst.length > 0) doc.variants[v.key] = { movements: inst }
  }
  if (Object.keys(doc.variants).length === 0) return []
  return validatePrescriptionsForPublish(doc).errors
}
