// Workout Engine V2, Faza 4 - stratul de date unificat pt incarcarea unui
// antrenament. Singura responsabilitate: dat un gym_id+date, intoarce UN
// singur model de domeniu (Workout, cu sections[]) - apelantul nu trebuie
// sa stie NICIODATA daca datele vin din tabelele vechi (`wods`) sau din
// Workout Engine V2 (`workouts`/`workout_sections`).
//
// NIMIC din aplicatie nu importa/foloseste inca acest fisier (vezi discutia
// de arhitectura Workout Engine V2, Faza 4 - "This service is preparation
// for future phases") - Member View si Workout Editor continua sa
// citeasca/scrie exact ca azi, direct din `wods`/`wod_logs`. Vite nu
// bundleaza acest fisier in aplicatia deployata cata vreme nimic nu-l
// importa (zero impact de performanta/marime azi).
//
// Functiile de MAPARE (mapV2SectionRow, mapLegacyWodToWorkout etc) sunt
// PURE - fara I/O - separate deliberat de functiile ASYNC care fac
// interogarea (loadFromWorkoutEngineV2, loadFromLegacyWods) - acelasi tipar
// ca restul codebase-ului (composeAmrapResult etc in workoutFormats.js),
// testabile direct cu fixture-uri, fara mock pe supabase.
import { supabase } from './supabase.js'

// ============================================================
// Derivarea score_type din format - SINGURA sursa "vie" e catalogul
// WORKOUT_FORMATS (workoutFormats.js); tabelul de mai jos e o copie
// deliberata, folosita si de migratia Faza 2 (SQL) si de prompt.ts
// (Edge Function) - trei locuri, trei limbaje diferite (SQL/Deno TS/
// browser JS), care nu pot fi unificate intr-un singur modul importat fara
// o schimbare mai mare de infrastructura (build cross-runtime). Merita
// stiut - daca se schimba maparea vreodata, toate trei trebuie actualizate.
// ============================================================
const SCORE_TYPE_BY_FORMAT = {
  'AMRAP': 'Rounds + Reps', 'Ascending AMRAP': 'Rounds + Reps', 'AMRAP with Buy-In': 'Rounds + Reps',
  'For Time': 'Time', 'RFT': 'Time', 'Chipper': 'Time', 'Ladder': 'Time', 'Partner WOD': 'Time',
  'EMOM': 'Reps', 'Tabata': 'Reps', 'Intervals': 'Reps', 'Death By': 'Reps',
  'Death By Weight': 'Weight', 'Complex': 'Weight', 'Strength Sets': 'Weight',
  'Build to Heavy/1RM': 'Weight', 'Weightlifting': 'Weight', 'Max Effort': 'Weight',
  'Superset': 'Sets', 'Chained AMRAP': 'Reps', 'Not For Time': 'Completion',
}

function deriveScoreType(format) {
  return SCORE_TYPE_BY_FORMAT[format] || 'Unknown'
}

// ============================================================
// Mapare PURA: un rand miscare-ca-text (movements_rx etc, wods) intr-o
// forma minimala consistenta cu shape-ul DetectedMovement folosit peste tot
// in proiect - text brut neinterpretat, acelasi motiv ca in migratia Faza 2
// (movements_rx contine uneori linii care nu sunt miscari, parsarea ar
// insemna ghicit date).
// ============================================================
function legacyMovementText(text) {
  return {
    name: text, canonicalName: null, reps: null, weight: null, distance: null,
    calories: null, equipment: [], notes: null,
  }
}

function legacyScalingVersion(level, movements, notes) {
  return { level, movements: (movements || []).map(legacyMovementText), notes: notes ?? null }
}

/** O sectiune sintetizata dintr-o coloana array a lui `wods` (warmup/skill/
 * skill2) - id STABIL dar sintetic (nu un UUID real, `wods` n-are randuri
 * de sectiune separate) - semnaleaza clar "randul asta nu exista ca atare
 * in DB, e derivat". */
function legacySectionFromArray(wodId, type, order, movementsArr, title, format, formatConfig) {
  return {
    id: `legacy:${wodId}:${type}:${order}`,
    type, title: title ?? null, description: null, order,
    format: format ?? null, formatConfig: formatConfig ?? {},
    movements: (movementsArr || []).map(legacyMovementText),
    scalingVersions: [], loggingMode: 'none', scoreType: null,
    duration: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false },
    metadata: {},
  }
}

/** Sectiunea principala (metcon) sintetizata din coloanele "de baza" ale
 * lui `wods` (type/format_config/movements_rx/notes_rx) + scalingVersions
 * din movements_intermediate/beginner/onramp - acelasi tipar de mapare ca
 * migratia SQL din Faza 2 (backfill), doar reimplementat in JS pt calea de
 * incarcare live (WOD-uri create dupa backfill, care n-au trecut prin
 * migratie). */
function legacyMetconSection(wod, order) {
  const scalingVersions = []
  if ((wod.movements_intermediate && wod.movements_intermediate.length) || wod.notes_intermediate) {
    scalingVersions.push(legacyScalingVersion('intermediate', wod.movements_intermediate, wod.notes_intermediate))
  }
  if ((wod.movements_beginner && wod.movements_beginner.length) || wod.notes_beginner) {
    scalingVersions.push(legacyScalingVersion('beginner', wod.movements_beginner, wod.notes_beginner))
  }
  if ((wod.movements_onramp && wod.movements_onramp.length) || wod.notes_onramp) {
    scalingVersions.push(legacyScalingVersion('on_ramp', wod.movements_onramp, wod.notes_onramp))
  }
  return {
    id: `legacy:${wod.id}:metcon:${order}`,
    type: 'metcon', title: null, description: wod.notes_rx ?? null, order,
    format: wod.type ?? null, formatConfig: wod.format_config ?? {},
    movements: (wod.movements_rx || []).map(legacyMovementText),
    scalingVersions,
    loggingMode: 'required',
    scoreType: wod.type ? deriveScoreType(wod.type) : null,
    duration: null,
    benchmarkMetadata: { name: null, isBenchmark: false, isHero: false },
    metadata: {
      legacyWeights: {
        rx: { male: wod.rx_weight_male ?? null, female: wod.rx_weight_female ?? null },
        intermediate: { male: wod.intermediate_weight_male ?? null, female: wod.intermediate_weight_female ?? null },
        beginner: { male: wod.beginner_weight_male ?? null, female: wod.beginner_weight_female ?? null },
        on_ramp: { male: wod.onramp_weight_male ?? null, female: wod.onramp_weight_female ?? null },
      },
    },
  }
}

/** Mapare PURA: un rand `wods` -> modelul de domeniu Workout complet.
 * Exportata separat de loadFromLegacyWods ca sa poata fi testata cu
 * fixture-uri, fara supabase. */
export function mapLegacyWodToWorkout(wod) {
  if (!wod) return null
  const sections = []
  let order = 0
  if (wod.warmup && wod.warmup.length) {
    sections.push(legacySectionFromArray(wod.id, 'warmup', order++, wod.warmup))
  }
  if (wod.skill && wod.skill.length) {
    sections.push(legacySectionFromArray(wod.id, 'skill', order++, wod.skill, wod.skill_name, wod.skill_type, wod.skill_format_config))
  }
  if (wod.skill2 && wod.skill2.length) {
    sections.push(legacySectionFromArray(wod.id, 'skill', order++, wod.skill2, wod.skill2_name || 'Skill 2', wod.skill2_type, wod.skill2_format_config))
  }
  sections.push(legacyMetconSection(wod, order++))

  return {
    id: wod.id, gymId: wod.gym_id, date: wod.date, title: wod.name ?? null, notes: null,
    sections, source: 'legacy',
  }
}

/** Mapare PURA: un rand `workout_sections` (+ cheia tipului, rezolvata din
 * join-ul cu workout_section_types) -> Section domeniu. */
export function mapV2SectionRow(row) {
  return {
    id: row.id,
    type: row.type_key ?? row.section_type_id,
    title: row.title ?? null,
    description: row.description ?? null,
    order: row.order_index,
    format: row.format ?? null,
    formatConfig: row.format_config ?? {},
    movements: row.movements ?? [],
    scalingVersions: row.scaling_versions ?? [],
    loggingMode: row.logging_mode ?? 'none',
    scoreType: row.score_type ?? null,
    duration: row.duration_minutes ?? null,
    benchmarkMetadata: row.benchmark_metadata ?? { name: null, isBenchmark: false, isHero: false },
    metadata: row.metadata ?? {},
  }
}

/** Mapare PURA: un rand `workouts` + sectiunile lui deja mapate -> Workout
 * domeniu. */
export function mapV2WorkoutRow(workout, sectionRows) {
  if (!workout) return null
  return {
    id: workout.id, gymId: workout.gym_id, date: workout.date,
    title: workout.title ?? null, notes: workout.notes ?? null,
    sections: (sectionRows || []).map(mapV2SectionRow).sort((a, b) => a.order - b.order),
    source: 'v2',
  }
}

// ============================================================
// Incarcare (async, I/O) - foloseste functiile PURE de mai sus. Nimic din
// aplicatie nu apeleaza inca aceste functii (Faza 4 e pregatire, nu
// integrare - vezi comentariul de la inceputul fisierului).
// ============================================================

/** Incearca sa incarce din Workout Engine V2 (workouts + workout_sections,
 * cu tipul sectiunii rezolvat prin join). null daca nu exista inca un
 * Workout pt acest gym+data (WOD creat dupa backfill, prin editorul vechi
 * care inca scrie doar in `wods` - normal si asteptat pana la Faza 5). */
export async function loadFromWorkoutEngineV2(gymId, date) {
  const { data: workout, error: workoutErr } = await supabase
    .from('workouts').select('*').eq('gym_id', gymId).eq('date', date).maybeSingle()
  if (workoutErr) throw workoutErr
  if (!workout) return null

  const { data: sectionRows, error: sectionsErr } = await supabase
    .from('workout_sections')
    .select('*, workout_section_types(key)')
    .eq('workout_id', workout.id)
    .order('order_index')
  if (sectionsErr) throw sectionsErr

  const flatSections = (sectionRows || []).map((s) => ({ ...s, type_key: s.workout_section_types?.key }))
  return mapV2WorkoutRow(workout, flatSections)
}

/** Fallback pe modelul vechi - un singur `wods` row -> Workout domeniu,
 * cu sectiuni sintetizate din coloanele lui array (vezi mapLegacyWodToWorkout). */
export async function loadFromLegacyWods(gymId, date) {
  const { data: wod, error } = await supabase
    .from('wods').select('*').eq('gym_id', gymId).eq('date', date).maybeSingle()
  if (error) throw error
  if (!wod) return null
  return mapLegacyWodToWorkout(wod)
}

/** Punctul unic de intrare - Workout Engine V2 daca exista, altfel `wods`.
 * Apelantul primeste MEREU aceeasi forma (Workout cu sections[]),
 * indiferent de sursa - `source` ('v2'|'legacy') e informativ/pt debug, nu
 * ceva de care UI-ul ar trebui sa depinda. */
export async function loadWorkout(gymId, date) {
  const v2 = await loadFromWorkoutEngineV2(gymId, date)
  if (v2) return v2
  return await loadFromLegacyWods(gymId, date)
}
