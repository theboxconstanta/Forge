import { describe, it, expect } from 'vitest'
import {
  createSection, DEFAULT_NEW_WOD_SECTIONS, sectionsFromLegacyWod,
  legacyPayloadFromSections, validateSectionsForLegacy,
} from './wodSections'

// Traduceri fake, doar cele 2 functii folosite de validateSectionsForLegacy.
const t = {
  wodSectionsErrorPrimaryCount: (n) => `PRIMARY_COUNT:${n}`,
  wodSectionsErrorTooMany: (n) => `TOO_MANY:${n}`,
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
  skill: ['5x3 Back Squat @ 70%'], skill_name: 'Back Squat', skill_type: 'Weightlifting', skill_format_config: null, skill_visible: true,
  skill2: ['Practice pistol squats'], skill2_name: 'Pistol Squat', skill2_type: 'Weightlifting', skill2_format_config: null, skill2_visible: false,
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

  it('mapare POZITIONALA, nu pe typeKey - primele 3 sectiuni non-primare merg pe warmup/skill/skill2 in ordinea din lista, indiferent de tipul lor', () => {
    const sections = [
      { ...createSection('cooldown', false), text: 'linia unu' },
      { ...createSection('mobility', false), movementName: 'Hip openers', format: 'Weightlifting', text: '' },
      createSection('metcon', true),
    ]
    const payload = legacyPayloadFromSections(sections)
    // prima sectiune non-primara (typeKey 'cooldown') -> coloana warmup
    expect(payload.warmup).toEqual(['linia unu'])
    // a doua sectiune non-primara (typeKey 'mobility') -> coloana skill
    expect(payload.skill_name).toBe('Hip openers')
    expect(payload.skill2).toEqual([])
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
