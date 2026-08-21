import { describe, it, expect } from 'vitest'
import {
  createSection, DEFAULT_NEW_WOD_SECTIONS, sectionsFromLegacyWod,
  legacyPayloadFromSections, validateSectionsForLegacy, validateMovementPerformanceMetadata,
  assignNonPrimarySlots, legacySlotAssignmentAfterSave,
} from './wodSections'

// Traduceri fake, doar functiile folosite de validateSectionsForLegacy.
const t = {
  wodSectionsErrorPrimaryCount: (n) => `PRIMARY_COUNT:${n}`,
  wodSectionsErrorTooMany: (n) => `TOO_MANY:${n}`,
  wodSectionsErrorTooManyWarmup: (n) => `TOO_MANY_WARMUP:${n}`,
  wodSectionsErrorTooManyOther: (n) => `TOO_MANY_OTHER:${n}`,
  wodSectionsErrorMissingFormatFields: (format) => `MISSING_FIELDS:${format}`,
}

// Fixture REAL, acelasi WOD "NED" (2026-07-03, CrossFit C15) folosit si de
// workoutEngine.test.js - fara warmup/skill/skill2, doar metcon.
const wodFixtureNoExtras = {
  id: '7316f19f-60c0-4373-a106-e4b12e716b19',
  gym_id: 'c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716',
  date: '2026-07-03',
  name: 'NED',
  type: 'For Time',
  duration: '40:0',
  format_config: { structure: 'Repeated Rounds' },
  warmup: null, warmup_visible: true,
  skill: null, skill_name: null, skill_type: null, skill_format_config: null, skill_visible: true,
  skill2: null, skill2_name: null, skill2_type: null, skill2_format_config: null, skill2_visible: true,
  movements_rx: ['7 rounds for time of:', '11 Back Squats', '1000m Row'],
  movements_intermediate: ['7 rounds for time of:', '11 Back Squats', '800m Row'],
  movements_beginner: ['5 rounds for time of:', '11 Back Squats (15/20 kg)', '400m Row'],
  movements_onramp: ['5 rounds for time of:', '11 AIR Squats (15/20 kg)', '200m row'],
  notes_rx: null, notes_intermediate: null, notes_beginner: null, notes_onramp: null,
  rx_weight_male: null, rx_weight_female: null,
  intermediate_weight_male: null, intermediate_weight_female: null,
  beginner_weight_male: null, beginner_weight_female: null,
  onramp_weight_male: null, onramp_weight_female: null,
}

const wodFixtureWithExtras = {
  ...wodFixtureNoExtras,
  warmup: ['400m Run', '10 Air Squats'], warmup_visible: true,
  skill: ['5x3 Back Squat @ 70%'], skill_name: 'Back Squat', skill_type: 'Weightlifting', skill_format_config: null, skill_visible: true, skill_scored: false,
  skill2: ['Practice pistol squats'], skill2_name: 'Pistol Squat', skill2_type: 'Weightlifting', skill2_format_config: null, skill2_visible: false, skill2_scored: false,
}

describe('DEFAULT_NEW_WOD_SECTIONS', () => {
  it('creeaza 3 sectiuni: warmup+skill (non-primare) si metcon (primara)', () => {
    const sections = DEFAULT_NEW_WOD_SECTIONS()
    expect(sections).toHaveLength(3)
    expect(sections.map(s => s.typeKey)).toEqual(['warmup', 'skill', 'metcon'])
    expect(sections.map(s => s.isPrimary)).toEqual([false, false, true])
  })

  it('warmup incepe fara format (text liber) - restul primesc Weightlifting/AMRAP', () => {
    const [warmup, skill, metcon] = DEFAULT_NEW_WOD_SECTIONS()
    expect(warmup.format).toBeNull()
    expect(skill.format).toBe('Weightlifting')
    expect(metcon.format).toBe('AMRAP')
  })

  it('id-urile create sunt unice intre sectiuni', () => {
    const sections = DEFAULT_NEW_WOD_SECTIONS()
    expect(new Set(sections.map(s => s.id)).size).toBe(3)
  })
})

describe('sectionsFromLegacyWod', () => {
  it('wod null -> aceleasi 3 sectiuni implicite ca la crearea unui WOD nou', () => {
    const sections = sectionsFromLegacyWod(null)
    expect(sections.map(s => s.typeKey)).toEqual(['warmup', 'skill', 'metcon'])
  })

  it('WOD fara warmup/skill/skill2 -> o singura sectiune (metcon, primara)', () => {
    const sections = sectionsFromLegacyWod(wodFixtureNoExtras)
    expect(sections).toHaveLength(1)
    expect(sections[0].isPrimary).toBe(true)
    expect(sections[0].variants.rx.movements).toEqual(wodFixtureNoExtras.movements_rx)
  })

  it('WOD cu warmup+skill+skill2 -> 4 sectiuni, in ordinea warmup/skill/skill2/metcon(primara)', () => {
    const sections = sectionsFromLegacyWod(wodFixtureWithExtras)
    expect(sections.map(s => s.typeKey)).toEqual(['warmup', 'skill', 'skill', 'metcon'])
    expect(sections.map(s => s.isPrimary)).toEqual([false, false, false, true])
    expect(sections[0].text).toBe('400m Run\n10 Air Squats')
    expect(sections[1].movementName).toBe('Back Squat')
    expect(sections[2].movementName).toBe('Pistol Squat')
    expect(sections[2].visible).toBe(false)
  })

  it('opts.open controleaza starea initiala expand/collapse a tuturor sectiunilor reconstruite', () => {
    const closed = sectionsFromLegacyWod(wodFixtureWithExtras)
    const opened = sectionsFromLegacyWod(wodFixtureWithExtras, { open: true })
    expect(closed.every(s => s.open === false)).toBe(true)
    expect(opened.every(s => s.open === true)).toBe(true)
  })

  // Phase 1B (multi-section scoring)
  it('sectiunea primara e mereu scored:true; skill/skill2 citesc skill_scored/skill2_scored (implicit false)', () => {
    const sections = sectionsFromLegacyWod(wodFixtureWithExtras)
    const [warmup, skill, skill2, metcon] = sections
    expect(metcon.scored).toBe(true)
    expect(skill.scored).toBe(false)
    expect(skill2.scored).toBe(false)
    expect(warmup.scored).toBe(false) // warmup ramane permanent nescorabil - niciun toggle in UI, niciun camp legacy skill_scored-equivalent
  })

  it('skill_scored:true/skill2_scored:true se reflecta corect in sections[i].scored', () => {
    const sections = sectionsFromLegacyWod({ ...wodFixtureWithExtras, skill_scored: true, skill2_scored: true })
    const [, skill, skill2] = sections
    expect(skill.scored).toBe(true)
    expect(skill2.scored).toBe(true)
  })
})

describe('legacyPayloadFromSections', () => {
  it('sectiunea primara scrie type/duration/format_config/name/variante - un WOD nou (1 sectiune) goleste warmup/skill/skill2', () => {
    const sections = sectionsFromLegacyWod(wodFixtureNoExtras)
    const payload = legacyPayloadFromSections(sections)
    expect(payload.type).toBe('For Time')
    expect(payload.name).toBe('NED')
    expect(payload.movements_rx).toEqual(wodFixtureNoExtras.movements_rx)
    expect(payload.warmup).toEqual([])
    expect(payload.skill).toEqual([])
    expect(payload.skill2).toEqual([])
  })

  it('round-trip: sectionsFromLegacyWod -> legacyPayloadFromSections reproduce fidel campurile legacy originale', () => {
    const sections = sectionsFromLegacyWod(wodFixtureWithExtras)
    const payload = legacyPayloadFromSections(sections)
    expect(payload.warmup).toEqual(wodFixtureWithExtras.warmup)
    expect(payload.skill).toEqual(wodFixtureWithExtras.skill)
    expect(payload.skill_name).toBe(wodFixtureWithExtras.skill_name)
    expect(payload.skill2).toEqual(wodFixtureWithExtras.skill2)
    expect(payload.skill2_name).toBe(wodFixtureWithExtras.skill2_name)
    expect(payload.skill2_visible).toBe(false)
    expect(payload.movements_rx).toEqual(wodFixtureWithExtras.movements_rx)
  })

  // Fix SKILL Sections Rendering as WARM-UP - mapare-a NU mai e strict
  // pozitionala pt slotul warmup: doar o sectiune typeKey==='warmup' poate
  // ajunge acolo, indiferent de pozitia ei in lista. O sectiune 'cooldown'/
  // 'mobility'/'skill'/etc, chiar nescorata, concureaza DOAR pe skill/skill2
  // (pozitional intre ele, ca inainte) - niciodata pe warmup, unde si-ar
  // pierde silentios continutul (coloana warmup n-are camp de nume/format).
  it('sectiuni non-warmup (cooldown, mobility) NU ajung niciodata pe warmup, indiferent de ordine - concureaza doar pe skill/skill2', () => {
    const sections = [
      { ...createSection('cooldown', false), text: 'linia unu' },
      { ...createSection('mobility', false), movementName: 'Hip openers', format: 'Weightlifting', text: '' },
      createSection('metcon', true),
    ]
    const payload = legacyPayloadFromSections(sections)
    expect(payload.warmup).toEqual([])
    // prima sectiune non-warmup (typeKey 'cooldown') -> coloana skill
    expect(payload.skill).toEqual(['linia unu'])
    // a doua sectiune non-warmup (typeKey 'mobility') -> coloana skill2
    expect(payload.skill2_name).toBe('Hip openers')
  })

  it('o sectiune typeKey warmup ajunge NUMAI pe warmup, chiar daca skill/skill2 sunt deja ocupate', () => {
    const skill = { ...createSection('skill', false), movementName: 'A' }
    const skill2 = { ...createSection('skill', false), movementName: 'B' }
    const warmup = { ...createSection('warmup', false), text: 'usor 10 min' }
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([skill, skill2, warmup, primary])
    expect(payload.warmup).toEqual(['usor 10 min'])
    expect(payload.skill_name).toBe('A')
    expect(payload.skill2_name).toBe('B')
  })

  it('THE FIX (bug real raportat): o sectiune NOUA, nescorata, tastata explicit SKILL nu mai ajunge pe warmup cand e singura sectiune non-primara', () => {
    const skillSection = { ...createSection('skill', false), scored: false, movementName: '10/10 Bulgarian Split Squats' }
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([skillSection, primary])
    expect(payload.warmup).toEqual([])
    expect(payload.skill_name).toBe('10/10 Bulgarian Split Squats')
  })

  it('WITHOUT the fix, the same case WOULD have landed in warmup - proves the test above is meaningful, not vacuous', () => {
    // Reproduce the OLD assignNonPrimarySlots behavior directly (inline, not
    // imported - the real function is already fixed) to document exactly
    // what the bug looked like before this patch.
    const oldAssignNonPrimarySlots = (sections) => {
      const nonPrimary = sections.filter(s => !s.isPrimary)
      const bySlot = { warmup: null, skill: null, skill2: null }
      const unassigned = nonPrimary.filter(s => !(s.legacySlot && !bySlot[s.legacySlot]))
      const scoredCandidati = unassigned.filter(s => s.scored)
      const restCandidati = unassigned.filter(s => !s.scored)
      for (const slot of ['skill', 'skill2']) {
        if (!bySlot[slot] && scoredCandidati.length > 0) bySlot[slot] = scoredCandidati.shift()
      }
      for (const slot of ['warmup', 'skill', 'skill2']) {
        if (!bySlot[slot] && restCandidati.length > 0) bySlot[slot] = restCandidati.shift()
      }
      return bySlot
    }
    const skillSection = { ...createSection('skill', false), scored: false, movementName: '10/10 Bulgarian Split Squats' }
    const primary = createSection('metcon', true)
    expect(oldAssignNonPrimarySlots([skillSection, primary]).warmup).toBe(skillSection)
  })

  it('re-tastarea unei sectiuni EXISTENTE (WARM-UP -> SKILL) nu-si mai pastreaza slotul incompatibil - Test 6 din raport', () => {
    const existingWarmup = { ...createSection('warmup', false), legacySlot: 'warmup', text: 'usor' }
    const retyped = { ...existingWarmup, typeKey: 'skill', text: '', movementName: '10/10 Bulgarian Split Squats' }
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([retyped, primary])
    expect(payload.warmup).toEqual([])
    expect(payload.skill_name).toBe('10/10 Bulgarian Split Squats')
    // legacySlotAssignmentAfterSave trebuie sa re-stampileze noul slot -
    // nu doar sectiunile cu legacySlot inca null.
    const map = legacySlotAssignmentAfterSave([retyped, primary])
    expect(map.get(retyped.id)).toBe('skill')
  })

  it('reordonarea a doua sectiuni non-primare schimba CE ajunge in care coloana legacy', () => {
    const warmup = createSection('warmup', false)
    const a = { ...createSection('skill', false), movementName: 'A' }
    const b = { ...createSection('skill', false), movementName: 'B' }
    const primary = createSection('metcon', true)
    const payloadOrig = legacyPayloadFromSections([warmup, a, b, primary])
    const payloadSwapped = legacyPayloadFromSections([warmup, b, a, primary])
    expect(payloadOrig.skill_name).toBe('A')
    expect(payloadOrig.skill2_name).toBe('B')
    expect(payloadSwapped.skill_name).toBe('B')
    expect(payloadSwapped.skill2_name).toBe('A')
  })

  it('mai putin de 3 sectiuni non-primare goleste explicit coloanele legacy nefolosite (asa se propaga o stergere din UI)', () => {
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([primary])
    expect(payload.warmup).toEqual([])
    expect(payload.warmup_visible).toBe(true)
    expect(payload.skill).toEqual([])
    expect(payload.skill_name).toBeNull()
    expect(payload.skill2).toEqual([])
  })

  it('fara nicio sectiune primara, foloseste prima sectiune din lista ca fallback (nu arunca)', () => {
    const onlyNonPrimary = [createSection('warmup', false)]
    expect(() => legacyPayloadFromSections(onlyNonPrimary)).not.toThrow()
  })

  it('durata AUTO (format EMOM etc.) se deriva din format_config, nu din durationMin/Sec manual', () => {
    const primary = { ...createSection('metcon', true), format: 'EMOM', formatConfig: { totalRounds: 10, intervalSec: 60 }, durationMin: '99', durationSec: '99' }
    const payload = legacyPayloadFromSections([primary])
    expect(payload.duration).toBe('10:00')
  })

  // Phase 1B (multi-section scoring)
  it('scrie skill_scored/skill2_scored dupa sections[i].scored (implicit false, POZITIONAL ca restul campurilor skill/skill2)', () => {
    const warmup = createSection('warmup', false)
    const skill = { ...createSection('skill', false), scored: true }
    const skill2 = { ...createSection('skill', false), scored: false }
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([warmup, skill, skill2, primary])
    expect(payload.skill_scored).toBe(true)
    expect(payload.skill2_scored).toBe(false)
  })

  it('mai putin de 3 sectiuni non-primare goleste explicit skill_scored/skill2_scored (false), la fel ca restul coloanelor', () => {
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([primary])
    expect(payload.skill_scored).toBe(false)
    expect(payload.skill2_scored).toBe(false)
  })

  it('round-trip: sectionsFromLegacyWod -> legacyPayloadFromSections reproduce fidel skill_scored/skill2_scored', () => {
    const sections = sectionsFromLegacyWod({ ...wodFixtureWithExtras, skill_scored: true, skill2_scored: false })
    const payload = legacyPayloadFromSections(sections)
    expect(payload.skill_scored).toBe(true)
    expect(payload.skill2_scored).toBe(false)
  })

  // Layer 2a.5 (SCORING_PHASE1B_LAYER2A5_SECTION_IDENTITY_INTEGRITY_REPORT.md) -
  // legacySlot identity fix. Bug real, reprodus live la finalul Layer 2a:
  // continutul unei sectiuni deja SALVATE (deci deja legata de un
  // workout_sections.id real, posibil deja logata) putea "sari" intr-o alta
  // coloana legacy doar prin adaugarea/stergerea/reordonarea altor sectiuni,
  // fiindca mapare-a era STRICT pozitionala. Testele urmatoare dovedesc ca o
  // sectiune deja incarcata (legacySlot != null) isi pastreaza slotul,
  // indiferent de pozitie - doar sectiunile cu adevarat noi (legacySlot
  // null) mai raman pozitionale (testat deja mai sus, neschimbat).
  it('sectiune EXISTENTA isi pastreaza coloana legacy la reordonare (nu mai e pozitional)', () => {
    const sections = sectionsFromLegacyWod(wodFixtureWithExtras) // [warmup, skill, skill2, metcon]
    const [warmup, skill, skill2, metcon] = sections
    const reordered = [skill2, skill, warmup, metcon]
    const payload = legacyPayloadFromSections(reordered)
    expect(payload.warmup).toEqual(wodFixtureWithExtras.warmup)
    expect(payload.skill).toEqual(wodFixtureWithExtras.skill)
    expect(payload.skill_name).toBe(wodFixtureWithExtras.skill_name)
    expect(payload.skill2).toEqual(wodFixtureWithExtras.skill2)
    expect(payload.skill2_name).toBe(wodFixtureWithExtras.skill2_name)
  })

  it('inserarea unei sectiuni NOI SCORATE inaintea uneia EXISTENTE nu fura slotul celei existente si nu ajunge in warmup (unde si-ar pierde formatul)', () => {
    // wodFixtureNoExtras + doar skill populat -> skill2 ramane liber pt noua sectiune.
    const wodCuUnSlotLiber = { ...wodFixtureNoExtras, skill: ['5x3 Back Squat @ 70%'], skill_name: 'Back Squat', skill_type: 'Weightlifting' }
    const sections = sectionsFromLegacyWod(wodCuUnSlotLiber) // [skill, metcon]
    const [skill, metcon] = sections
    const newSection = { ...createSection('strength', false), movementName: 'Nou adaugat', scored: true }
    const withInsert = [newSection, skill, metcon]
    const payload = legacyPayloadFromSections(withInsert)
    // sectiunea existenta isi pastreaza coloana...
    expect(payload.skill_name).toBe('Back Squat')
    // ...noua sectiune SCORATA ocupa singurul slot ramas liber (skill2) -
    // niciodata warmup, care n-are camp de format/scored deloc.
    expect(payload.warmup).toEqual([])
    expect(payload.skill2_name).toBe('Nou adaugat')
    expect(payload.skill2_scored).toBe(true)
  })

  it('stergerea unei sectiuni EXISTENTE elibereaza coloana ei, nu e mostenita de alta sectiune', () => {
    const sections = sectionsFromLegacyWod(wodFixtureWithExtras) // [warmup, skill, skill2, metcon]
    const [, skill, skill2, metcon] = sections // warmup eliminat din lista
    const payload = legacyPayloadFromSections([skill, skill2, metcon])
    expect(payload.warmup).toEqual([])
    expect(payload.skill).toEqual(wodFixtureWithExtras.skill)
    expect(payload.skill_name).toBe(wodFixtureWithExtras.skill_name)
    expect(payload.skill2_name).toBe(wodFixtureWithExtras.skill2_name)
  })

  it('save -> reload -> save: identitatea supravietuieste unui ciclu complet de editare (adauga apoi sterge o sectiune noua)', () => {
    // Simuleaza exact scenariul reprodus live: WOD salvat cu warmup gol +
    // skill (Back Squat) + metcon, apoi coach-ul adauga o sectiune noua.
    const wodDupaPrimulSave = { ...wodFixtureNoExtras, skill: ['5x5 Back Squat @ 60kg'], skill_name: 'Back Squat', skill_scored: true }
    const sections1 = sectionsFromLegacyWod(wodDupaPrimulSave) // [skill(legacySlot='skill'), metcon] - warmup gol, omis
    const withNewSkill2 = [...sections1.slice(0, -1), { ...createSection('skill', false), movementName: 'Deadlift', scored: true }, sections1[sections1.length - 1]]
    const payload = legacyPayloadFromSections(withNewSkill2)
    // Back Squat ramane in coloana `skill` (identitatea lui originala),
    // NU aluneca in `warmup` doar pentru ca lista are acum un element in plus.
    expect(payload.skill_name).toBe('Back Squat')
    expect(payload.skill_scored).toBe(true)
    expect(payload.warmup).toEqual([])
    expect(payload.skill2_name).toBe('Deadlift')
  })
})

describe('validateSectionsForLegacy', () => {
  it('valid: exact 1 sectiune primara, maxim 3 non-primare', () => {
    const sections = sectionsFromLegacyWod(wodFixtureWithExtras)
    expect(validateSectionsForLegacy(sections, t)).toEqual({ valid: true, errors: [] })
  })

  it('invalid: 0 sectiuni primare', () => {
    const sections = [createSection('warmup', false), createSection('skill', false)]
    const result = validateSectionsForLegacy(sections, t)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('PRIMARY_COUNT:0')
  })

  it('invalid: 2 sectiuni primare', () => {
    const sections = [createSection('metcon', true), createSection('strength', true)]
    const result = validateSectionsForLegacy(sections, t)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('PRIMARY_COUNT:2')
  })

  // Fix SKILL Sections Rendering as WARM-UP - "<=3 total" singur nu garanta
  // ca fiecare sectiune are un slot compatibil (doar 1 slot warmup exista).
  it('invalid: 2 sectiuni typeKey warmup (modelul are un singur slot warmup)', () => {
    const sections = [createSection('warmup', false), createSection('warmup', false), createSection('metcon', true)]
    const result = validateSectionsForLegacy(sections, t)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('TOO_MANY_WARMUP:2')
  })

  it('invalid: 3 sectiuni non-warmup (modelul are doar 2 sloturi skill/skill2)', () => {
    const sections = [
      createSection('skill', false), createSection('strength', false), createSection('cooldown', false),
      createSection('metcon', true),
    ]
    const result = validateSectionsForLegacy(sections, t)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('TOO_MANY_OTHER:3')
  })

  it('valid: exact 1 warmup + 2 non-warmup (Test 4 din raport - WARM-UP/SKILL/STRENGTH/WORKOUT)', () => {
    const sections = [
      createSection('warmup', false), createSection('skill', false), createSection('strength', false),
      createSection('metcon', true),
    ]
    expect(validateSectionsForLegacy(sections, t)).toEqual({ valid: true, errors: [] })
  })

  it('invalid: mai mult de 3 sectiuni non-primare', () => {
    const sections = [
      createSection('warmup', false), createSection('skill', false),
      createSection('cooldown', false), createSection('mobility', false),
      createSection('metcon', true),
    ]
    const result = validateSectionsForLegacy(sections, t)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('TOO_MANY:4')
  })

  it('poate acumula ambele erori simultan (0 primare SI prea multe non-primare)', () => {
    const sections = [
      createSection('warmup', false), createSection('skill', false),
      createSection('cooldown', false), createSection('mobility', false),
    ]
    const result = validateSectionsForLegacy(sections, t)
    expect(result.errors).toEqual(['PRIMARY_COUNT:0', 'TOO_MANY:4'])
  })
})

// Layer 2b.1 (PROGRAMMING_SKILL_SECTION_FORMAT_INHERITANCE_FIX_REPORT.md) -
// the originally-reported "Skill Section silently inherits the primary's
// format" symptom was investigated and found NOT reproducible (5 direct
// live-production attempts, all correct) - but the investigation found a
// real, narrower gap: a brand-new section's legacySlot stays null until the
// EDITOR IS RELOADED (only sectionsFromLegacyWod sets it), even after that
// section has already been saved successfully once. These tests cover the
// hardening that closes that gap - legacySlot is now also stamped onto
// in-memory sections immediately after their first successful save (see
// legacySlotAssignmentAfterSave, wired into saveWod's success handler).
describe('assignNonPrimarySlots / legacySlotAssignmentAfterSave (Layer 2b.1 hardening)', () => {
  it('a brand-new scored section (legacySlot null) resolves to skill and appears in the post-save map', () => {
    const primary = createSection('metcon', true)
    const skill = { ...createSection('skill', false), scored: true, movementName: 'Squat Clean' }
    const sections = [skill, primary]
    expect(assignNonPrimarySlots(sections).skill).toBe(skill)
    const map = legacySlotAssignmentAfterSave(sections)
    expect(map.get(skill.id)).toBe('skill')
  })

  it('two brand-new scored sections get distinct slots (skill, skill2), both appear in the map', () => {
    const primary = createSection('metcon', true)
    const a = { ...createSection('skill', false), scored: true, movementName: 'A' }
    const b = { ...createSection('skill', false), scored: true, movementName: 'B' }
    const map = legacySlotAssignmentAfterSave([a, b, primary])
    expect(map.get(a.id)).toBe('skill')
    expect(map.get(b.id)).toBe('skill2')
  })

  it('a section that already has legacySlot is NOT re-added to the map (already stamped, nothing to do)', () => {
    const primary = createSection('metcon', true)
    const already = { ...createSection('skill', false), scored: true, legacySlot: 'skill' }
    const map = legacySlotAssignmentAfterSave([already, primary])
    expect(map.size).toBe(0)
  })

  it('an unscored brand-new section still gets stamped (positional fallback among non-warmup slots), not just scored ones', () => {
    const primary = createSection('metcon', true)
    const plain = { ...createSection('skill', false), scored: false, movementName: 'Plain' }
    const map = legacySlotAssignmentAfterSave([plain, primary])
    expect(map.get(plain.id)).toBe('skill')
  })

  it('THE FIX: stamping legacySlot after the first save prevents a later in-session reorder (no reload) from swapping content between slots', () => {
    const primary = createSection('metcon', true)
    const squatClean = { ...createSection('skill', false), scored: true, movementName: 'Squat Clean' }
    const amrapSkill = { ...createSection('skill', false), scored: true, movementName: '' }
    // First save: both still legacySlot:null -> positional (squatClean first -> skill, amrapSkill second -> skill2).
    let sections = [squatClean, amrapSkill, primary]
    const payload1 = legacyPayloadFromSections(sections)
    expect(payload1.skill_name).toBe('Squat Clean')
    expect(payload1.skill2_name).toBe(null)
    // Hardening: stamp legacySlot onto the in-memory sections, exactly as saveWod's success handler now does.
    const map = legacySlotAssignmentAfterSave(sections)
    sections = sections.map(s => (map.has(s.id) ? { ...s, legacySlot: map.get(s.id) } : s))
    expect(sections.find(s => s.id === squatClean.id).legacySlot).toBe('skill')
    expect(sections.find(s => s.id === amrapSkill.id).legacySlot).toBe('skill2')
    // Reorder WITHOUT any reload (swap array position) and save again.
    const reordered = [
      sections.find(s => s.id === amrapSkill.id),
      sections.find(s => s.id === squatClean.id),
      primary,
    ]
    const payload2 = legacyPayloadFromSections(reordered)
    // Content must stay bound to identity, not position - Squat Clean is STILL skill, not skill2.
    expect(payload2.skill_name).toBe('Squat Clean')
    expect(payload2.skill2_name).toBe(null)
  })

  it('WITHOUT the fix (legacySlot never stamped), the same in-session reorder WOULD swap content - proves the test above is meaningful, not vacuous', () => {
    const primary = createSection('metcon', true)
    const squatClean = { ...createSection('skill', false), scored: true, movementName: 'Squat Clean' }
    const amrapSkill = { ...createSection('skill', false), scored: true, movementName: '' }
    const sections = [squatClean, amrapSkill, primary] // legacySlot never stamped, deliberately
    const reordered = [amrapSkill, squatClean, primary]
    const payload = legacyPayloadFromSections(reordered)
    // Without the hardening, position alone decides - amrapSkill (now first) claims 'skill'.
    expect(payload.skill_name).toBe(null)
    expect(payload.skill2_name).toBe('Squat Clean')
  })
})

// Member Performance, Faza 4 (Completitudine Metadata Programming) - real
// production bug found: two live Strength Sets Sections were saved with
// format_config:{} (setsScheme missing) despite the schema declaring it
// required:true since before either Section was authored - nothing ever
// validated that. Fix: extend the existing hard save-gate
// (validateSectionsForLegacy) with the same "block, don't warn" pattern
// already used for section-count validation. Scope deliberately narrow -
// only the two movement-performance formats the Phase 3 rep-scheme
// resolver depends on (Strength Sets, Superset), not a generic
// required-field validator for the whole catalog.
describe('validateMovementPerformanceMetadata (Phase 4)', () => {
  it('blocks a Strength Sets section with no setsScheme at all (the real production bug)', () => {
    const s = { ...createSection('metcon', true), format: 'Strength Sets', formatConfig: {} }
    const errors = validateMovementPerformanceMetadata([s], t)
    expect(errors).toEqual(['MISSING_FIELDS:Strength Sets'])
  })

  it('blocks a Strength Sets section with an empty setsScheme array', () => {
    const s = { ...createSection('metcon', true), format: 'Strength Sets', formatConfig: { setsScheme: [] } }
    expect(validateMovementPerformanceMetadata([s], t)).toHaveLength(1)
  })

  it('allows a Strength Sets section with a real setsScheme', () => {
    const s = { ...createSection('metcon', true), format: 'Strength Sets', formatConfig: { setsScheme: [5, 5, 5, 5, 5] } }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual([])
  })

  it('blocks a Superset section missing movements', () => {
    const s = { ...createSection('metcon', true), format: 'Superset', formatConfig: { targetSets: 3 } }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual(['MISSING_FIELDS:Superset'])
  })

  it('blocks a Superset section missing targetSets', () => {
    const s = { ...createSection('metcon', true), format: 'Superset', formatConfig: { movements: ['Back Squat'] } }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual(['MISSING_FIELDS:Superset'])
  })

  it('blocks a Superset section with targetSets:0 (falsy-but-present is still missing)', () => {
    const s = { ...createSection('metcon', true), format: 'Superset', formatConfig: { movements: ['Back Squat'], targetSets: 0 } }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual(['MISSING_FIELDS:Superset'])
  })

  it('allows a Superset section with both movements and targetSets', () => {
    const s = { ...createSection('metcon', true), format: 'Superset', formatConfig: { movements: ['Back Squat'], targetSets: 3 } }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual([])
  })

  it('does NOT block Build to Heavy/1RM even with an empty config - targetLabel already has a safe schema default', () => {
    const s = { ...createSection('metcon', true), format: 'Build to Heavy/1RM', formatConfig: {} }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual([])
  })

  it('does NOT block Weightlifting - format has zero config fields, nothing to require', () => {
    const s = { ...createSection('metcon', true), format: 'Weightlifting', formatConfig: {} }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual([])
  })

  it('does NOT block Complex even with no complexMovements - out of this fix\'s scope (not read by the Phase 3 resolver, general Programming concern, deferred deliberately)', () => {
    const s = { ...createSection('metcon', true), format: 'Complex', formatConfig: {} }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual([])
  })

  it('does NOT block unrelated formats (For Time, AMRAP, etc.) regardless of their own required fields - scope is intentionally narrow', () => {
    const s = { ...createSection('metcon', true), format: 'AMRAP', formatConfig: {} }
    expect(validateMovementPerformanceMetadata([s], t)).toEqual([])
  })

  it('is wired into validateSectionsForLegacy - the real save gate rejects a bad Strength Sets section even when section counts are otherwise valid', () => {
    const primary = { ...createSection('metcon', true), format: 'Strength Sets', formatConfig: {} }
    const result = validateSectionsForLegacy([primary], t)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('MISSING_FIELDS:Strength Sets')
  })

  it('validateSectionsForLegacy stays valid when movement-performance metadata is complete', () => {
    const primary = { ...createSection('metcon', true), format: 'Strength Sets', formatConfig: { setsScheme: [5, 5, 5] } }
    expect(validateSectionsForLegacy([primary], t).valid).toBe(true)
  })
})
