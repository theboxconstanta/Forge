import { describe, it, expect } from 'vitest'
import { mapLegacyWodToWorkout, mapV2WorkoutRow, mapV2SectionRow } from './workoutEngine'

// Fixture-uri REALE, extrase direct din productie (WOD "NED", 2026-07-03,
// CrossFit C15) - nu date inventate. wodFixture e randul `wods` brut;
// v2WorkoutFixture/v2SectionRowsFixture sunt randurile `workouts`/
// `workout_sections` create pt ACELASI WOD de backfill-ul din Faza 2 -
// permite un test de comparatie directa intre cele doua cai de incarcare,
// pe date reale, nu doar pe fixture-uri simetrice construite manual.
const wodFixture = {
  id: '7316f19f-60c0-4373-a106-e4b12e716b19',
  gym_id: 'c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716',
  date: '2026-07-03',
  name: 'NED',
  type: 'For Time',
  format_config: { structure: 'Repeated Rounds' },
  warmup: null,
  skill: null,
  skill2: null,
  movements_rx: ['7 rounds for time of:', '11 Back Squats', '1000m Row', '– Use bodyweight for the back squats.'],
  movements_intermediate: ['7 rounds for time of:', '11 Back Squats', '800m Row', '– Use 3/4 bodyweight for the back squats.'],
  movements_beginner: ['5 rounds for time of:', '11 Back Squats (15/20 kg)', '400m Row'],
  movements_onramp: ['5 rounds for time of:', '11 AIR Squats (15/20 kg)', '200m row'],
  notes_rx: null, notes_intermediate: null, notes_beginner: null, notes_onramp: null,
  rx_weight_male: null, rx_weight_female: null,
  intermediate_weight_male: null, intermediate_weight_female: null,
  beginner_weight_male: null, beginner_weight_female: null,
  onramp_weight_male: null, onramp_weight_female: null,
}

const v2WorkoutFixture = {
  id: '770e48ad-d76d-4aa0-9c82-df10d131ec74',
  gym_id: 'c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716',
  date: '2026-07-03',
  title: 'NED',
  notes: null,
}

const v2SectionRowsFixture = [
  {
    id: 'fa5378a2-0928-464a-996e-7d62d6c14aeb',
    type_key: 'metcon',
    slot_key: 'metcon',
    title: null,
    description: null,
    order_index: 0,
    format: 'For Time',
    format_config: { structure: 'Repeated Rounds' },
    movements: [
      { name: '7 rounds for time of:', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
      { name: '11 Back Squats', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
      { name: '1000m Row', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
      { name: '– Use bodyweight for the back squats.', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
    ],
    scaling_versions: [
      { level: 'intermediate', notes: null, movements: [
        { name: '7 rounds for time of:', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '11 Back Squats', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '800m Row', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '– Use 3/4 bodyweight for the back squats.', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
      ] },
      { level: 'beginner', notes: null, movements: [
        { name: '5 rounds for time of:', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '11 Back Squats (15/20 kg)', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '400m Row', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
      ] },
      { level: 'on_ramp', notes: null, movements: [
        { name: '5 rounds for time of:', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '11 AIR Squats (15/20 kg)', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
        { name: '200m row', canonicalName: null, reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
      ] },
    ],
    logging_mode: 'required',
    score_type: 'Time',
    duration_minutes: null,
    benchmark_metadata: {},
    metadata: {
      legacyWodId: '7316f19f-60c0-4373-a106-e4b12e716b19',
      legacyWeights: {
        rx: { male: null, female: null }, intermediate: { male: null, female: null },
        beginner: { male: null, female: null }, on_ramp: { male: null, female: null },
      },
    },
  },
]

// Campuri UNDE se asteapta o diferenta intre cele doua cai, si DE CE - nu
// sunt bug-uri, sunt diferente REALE si EXPLICABILE intre cele doua surse:
// - id: `wods` n-are randuri de sectiune reale, id-urile pe calea veche
//   sunt sintetizate (`legacy:<wodId>:<type>:<order>`), nu UUID-uri DB.
// - benchmarkMetadata: {} (gol) pe calea V2 vs shape complet cu null-uri pe
//   calea veche - ambele inseamna "fara benchmark", doar reprezentate
//   diferit (backfill-ul SQL a scris jsonb gol, mapper-ul JS completeaza
//   explicit toate cheile) - normalizate identic mai jos.
// - metadata.legacyWodId: prezent DOAR pe randul V2, pus acolo de migratia
//   de backfill (Faza 2) ca "stampila de provenienta" (din ce `wods` row a
//   fost generat acest Workout) - o incarcare LIVE prin loadFromLegacyWods
//   n-are de ce sa adauge asta, nu e o migratie, doar un citit direct.
//   Diferenta e REALA (nu un artefact de normalizare) - documentata aici,
//   nu ascunsa.
function normalizeForComparison(workout) {
  return {
    ...workout,
    id: undefined, source: undefined,
    sections: workout.sections.map((s) => {
      const { legacyWodId, ...metadataRest } = s.metadata || {}
      return {
        ...s,
        id: undefined,
        benchmarkMetadata: s.benchmarkMetadata?.isBenchmark
          ? s.benchmarkMetadata
          : { name: null, isBenchmark: false, isHero: false },
        metadata: metadataRest,
      }
    }),
  }
}

describe('mapLegacyWodToWorkout', () => {
  it('WOD fara warmup/skill/skill2 -> o singura sectiune (metcon)', () => {
    const w = mapLegacyWodToWorkout(wodFixture)
    expect(w.sections).toHaveLength(1)
    expect(w.sections[0].type).toBe('metcon')
  })

  it('pastreaza textul brut al miscarilor, inclusiv liniile care nu sunt miscari - nu incearca sa le filtreze/parseze', () => {
    const w = mapLegacyWodToWorkout(wodFixture)
    const names = w.sections[0].movements.map((m) => m.name)
    expect(names).toContain('– Use bodyweight for the back squats.')
    expect(names).toContain('11 Back Squats')
  })

  it('scalingVersions contine doar nivelele cu continut real (intermediate/beginner/on_ramp), niciodata rx (e deja baza)', () => {
    const w = mapLegacyWodToWorkout(wodFixture)
    const levels = w.sections[0].scalingVersions.map((sv) => sv.level)
    expect(levels).toEqual(['intermediate', 'beginner', 'on_ramp'])
  })

  it('scoreType e derivat din format prin acelasi tabel folosit si de migratia SQL/prompt.ts', () => {
    const w = mapLegacyWodToWorkout(wodFixture)
    expect(w.sections[0].scoreType).toBe('Time')
  })

  it('warmup/skill/skill2 devin sectiuni separate DOAR daca au continut real', () => {
    const withSkill = { ...wodFixture, skill: ['Practice handstand holds'], skill_name: 'Skill', skill_type: 'Not For Time' }
    const w = mapLegacyWodToWorkout(withSkill)
    expect(w.sections).toHaveLength(2)
    expect(w.sections[0].type).toBe('skill')
    expect(w.sections[1].type).toBe('metcon')
  })

  it('null pt un wod null (nu arunca)', () => {
    expect(mapLegacyWodToWorkout(null)).toBeNull()
  })

  it('Faza 5B: slotKey e stabil pe ROL, nu pe pozitie - metcon primeste mereu slotKey "metcon"', () => {
    const w = mapLegacyWodToWorkout(wodFixture)
    expect(w.sections[0].slotKey).toBe('metcon')
  })

  it('Faza 5B: skill si skill2 primesc slotKey distincte ("skill"/"skill2"), desi ambele au type "skill"', () => {
    const withBoth = {
      ...wodFixture,
      skill: ['Practice handstand holds'], skill_name: 'Skill', skill_type: 'Not For Time',
      skill2: ['Practice pistol squats'], skill2_name: 'Skill 2', skill2_type: 'Not For Time',
    }
    const w = mapLegacyWodToWorkout(withBoth)
    const skillSection = w.sections.find((s) => s.slotKey === 'skill')
    const skill2Section = w.sections.find((s) => s.slotKey === 'skill2')
    expect(skillSection.type).toBe('skill')
    expect(skill2Section.type).toBe('skill')
    expect(skillSection.movements[0].name).toBe('Practice handstand holds')
    expect(skill2Section.movements[0].name).toBe('Practice pistol squats')
  })

  it('Faza 5B: id-ul sintetic depinde de slotKey, nu de pozitie - stabil chiar daca ordinea s-ar schimba', () => {
    const w = mapLegacyWodToWorkout(wodFixture)
    expect(w.sections[0].id).toBe(`legacy:${wodFixture.id}:metcon`)
  })
})

describe('mapV2WorkoutRow / mapV2SectionRow', () => {
  it('rezolva type_key (din join-ul cu workout_section_types) ca `type` pe sectiune', () => {
    const w = mapV2WorkoutRow(v2WorkoutFixture, v2SectionRowsFixture)
    expect(w.sections[0].type).toBe('metcon')
  })

  it('sorteaza sectiunile dupa order_index, indiferent de ordinea randurilor primite', () => {
    const shuffled = [{ ...v2SectionRowsFixture[0], id: 'b', order_index: 1 }, { ...v2SectionRowsFixture[0], id: 'a', order_index: 0 }]
    const w = mapV2WorkoutRow(v2WorkoutFixture, shuffled)
    expect(w.sections.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('null pt un workout null (nu arunca)', () => {
    expect(mapV2WorkoutRow(null, [])).toBeNull()
  })
})

describe('comparatie legacy vs Workout Engine V2 - acelasi WOD real (NED, 2026-07-03)', () => {
  it('produc acelasi model de domeniu, cu exceptia id-urilor (sintetice pe calea veche) si a formei benchmarkMetadata goale', () => {
    const legacy = mapLegacyWodToWorkout(wodFixture)
    const v2 = mapV2WorkoutRow(v2WorkoutFixture, v2SectionRowsFixture)

    expect(legacy.gymId).toBe(v2.gymId)
    expect(legacy.date).toBe(v2.date)
    expect(legacy.title).toBe(v2.title)
    expect(legacy.sections).toHaveLength(v2.sections.length)

    expect(normalizeForComparison(legacy)).toEqual(normalizeForComparison(v2))
  })
})
