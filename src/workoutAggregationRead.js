// Workout Aggregation, Phase A - Piece 3: minimal derived-read integration.
// Deliberately NOT wired into Clasament/Member View (WORKOUT_AGGREGATION_
// ARCHITECTURE.md S46 scopes live display to a later phase; this mission's
// own S28/S29 explicitly defer it) - this module exists so the derived
// result is a real, callable, tested function for production acceptance
// verification, without any coach-authoring or member-facing UI existing
// yet. Does I/O (unlike workoutAggregation.js, which stays pure) - this is
// the one place that's allowed to, per the mission's own "integration"
// framing (S1 item 5).
//
// Reuses Layer 2b's own normalization (sortSectionLogs) and result-source
// polymorphism (wod_logs/skill_logs -> one shape) rather than duplicating
// either - see mission S13/S53. skill_logs -> WodLogRow-shape mapping
// mirrors forge-admin-web's own already-extracted skillLogToWodLogShape
// (sectionLeaderboard.ts) field-for-field; WOD-SIMPLE's own equivalent has
// only ever existed inline inside App.jsx's Clasament closure, so it is
// re-extracted here as its own small pure function rather than re-inlined
// a second time.
//
// Batches all participant Sections into 3 total queries (workout_sections,
// wod_logs, skill_logs, each `.in(...)` over every participant Section at
// once) rather than one round trip per Section, per mission S48's explicit
// "no N-query-per-Section pattern" instruction.

import { sortSectionLogs, toKgForRanking } from './workoutFormats'
import { classifySectionMetric, sectionValueForMember, deriveWorkoutAggregate, VALUE_COMBINE_FUNCTIONS } from './workoutAggregation'

export function normalizeSkillLogToWodLogShape(sl) {
  return {
    id: sl.id, member_id: sl.member_id, wod_id: sl.wod_id, variant_level: 'RX',
    result: sl.result, time_result: null, completion_state: null,
    notes: sl.notes, logged_at: sl.logged_at, sets: sl.sets, log_meta: sl.log_meta,
    weight_logged: null, gym_id: sl.gym_id, workout_section_id: sl.workout_section_id,
    _source: 'skill_logs', _setsScore: undefined,
  }
}

const UNAVAILABLE_NO_DEFINITION = {
  status: 'unavailable', reason: 'no-definition', value: null, metric: null,
  unit: null, comparator: null, participatingSectionIds: [], classifiedTier: null,
}

// `supabase`: an already-authenticated client (RLS-scoped, same as every
// other read in this codebase - no service-role bypass here). Returns the
// same DerivedAggregateResult shape workoutAggregation.js's own
// deriveWorkoutAggregate produces - this function is a thin I/O wrapper
// around it, never a second engine.
export async function fetchWorkoutAggregateForMember(supabase, { workoutId, memberId }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts').select('id, aggregate_definition').eq('id', workoutId).maybeSingle()
  if (workoutError) throw workoutError
  if (!workout?.aggregate_definition) return UNAVAILABLE_NO_DEFINITION

  const def = workout.aggregate_definition
  const sectionIds = def.participantSectionIds

  const [{ data: sections, error: sectionsError }, { data: wodLogs, error: wodLogsError }, { data: skillLogs, error: skillLogsError }] = await Promise.all([
    supabase.from('workout_sections').select('id, format, format_config, workout_id, gym_id, logging_mode').in('id', sectionIds),
    supabase.from('wod_logs').select('*').in('workout_section_id', sectionIds),
    supabase.from('skill_logs').select('*').in('workout_section_id', sectionIds),
  ])
  if (sectionsError) throw sectionsError
  if (wodLogsError) throw wodLogsError
  if (skillLogsError) throw skillLogsError

  const sectionsById = new Map((sections || []).map(s => [s.id, s]))
  const allLogs = [...(wodLogs || []), ...(skillLogs || []).map(normalizeSkillLogToWodLogShape)]
  const logsBySection = new Map(sectionIds.map(id => [id, []]))
  for (const log of allLogs) {
    if (logsBySection.has(log.workout_section_id)) logsBySection.get(log.workout_section_id).push(log)
  }

  const participantInputs = {}
  for (const sectionId of sectionIds) {
    const sec = sectionsById.get(sectionId)
    if (!sec) { participantInputs[sectionId] = undefined; continue }
    const sorted = sortSectionLogs(logsBySection.get(sectionId) || [], sec.format, sec.format_config)
    const idx = sorted.findIndex(l => l.member_id === memberId)
    const memberLog = idx >= 0 ? sorted[idx] : null

    if (VALUE_COMBINE_FUNCTIONS.includes(def.combineFunction)) {
      const metric = classifySectionMetric(sec.format, sec.format_config)
      const value = memberLog && metric ? sectionValueForMember(memberLog, metric, toKgForRanking, memberLog.profile?.weight_unit) : null
      participantInputs[sectionId] = metric
        ? { value, metric: metric.kind, unit: metric.unit, direction: metric.direction, classifiedTier: memberLog?.variant_level || null }
        : undefined
    } else {
      participantInputs[sectionId] = memberLog ? { rank: idx + 1, classifiedTier: memberLog.variant_level || null } : undefined
    }
  }

  return deriveWorkoutAggregate(def, participantInputs)
}
