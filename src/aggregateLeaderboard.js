// Workout Aggregation, Leaderboard piece - pure leaderboard-ASSEMBLY logic
// built on top of workoutAggregation.js's raw engine, exactly mirroring
// how Layer 2b already separates sectionLeaderboard.ts (assembly) from
// ranking.ts (raw per-Section comparator) in forge-admin-web -
// workoutAggregation.js stays a pure "engine" (per its own header
// comment), this module is the "assemble a ranked list of members" layer
// one step up, matching this codebase's own established split.
//
// No I/O here either - `sortSectionLogs`/`toKgForRanking` are pure data
// transforms (no Supabase calls), safe to import directly, matching
// classifySectionMetric's own existing style in workoutAggregation.js.

import { sortSectionLogs, toKgForRanking } from './workoutFormats'
import {
  VALUE_COMBINE_FUNCTIONS, classifySectionMetric, sectionValueForMember, deriveWorkoutAggregate,
} from './workoutAggregation'

// Deterministic combineFunction -> generic display label. NEVER derived
// from workout/movement names ("Snatch + Clean & Jerk" -> "Total" would
// be a content heuristic the mission explicitly forbids) - purely a
// function of which of the seven approved combine functions was chosen,
// identical in both repos.
export const COMBINE_FUNCTION_LABELS = {
  sum: 'Total',
  'best-of': 'Best',
  average: 'Average',
  max: 'Max',
  min: 'Min',
  'placement-sum': 'Overall (Placement)',
  'points-sum': 'Overall (Points)',
}

/**
 * Assembles the ranked Aggregate leaderboard for one Workout, entirely
 * from already-fetched, already-in-memory Section data - zero additional
 * queries (mission S7/S37). `sectionsById`: {[sectionId]: {format,
 * format_config}}. `logsBySectionId`: {[sectionId]: normalizedLog[]}
 * (wod_logs/skill_logs already merged into one shape upstream, exactly as
 * Clasament already does before this is called).
 *
 * Candidate member set (mission S8) = the union of every member appearing
 * in ANY participant Section's own ranked list - never assumed to be
 * "everyone in Section A." A member is included in the RETURNED,
 * displayable leaderboard only when their aggregate is `available`
 * (mission S25): an unavailable member is simply omitted from this ranked
 * list, never shown with a fake/partial value - they remain fully visible
 * in each individual Section's own leaderboard, unaffected, since this
 * function never touches those.
 */
export function buildAggregateLeaderboard(aggregateDefinition, sectionsById, logsBySectionId) {
  if (!aggregateDefinition) return null
  const { participantSectionIds, combineFunction } = aggregateDefinition
  const isValue = VALUE_COMBINE_FUNCTIONS.includes(combineFunction)

  const rankedBySection = {}
  for (const id of participantSectionIds) {
    const sec = sectionsById[id]
    if (!sec) continue
    rankedBySection[id] = sortSectionLogs(logsBySectionId[id] || [], sec.format, sec.format_config)
  }

  const memberIds = new Set()
  Object.values(rankedBySection).forEach(arr => arr.forEach(l => memberIds.add(l.member_id)))

  const entries = []
  for (const memberId of memberIds) {
    const participantInputs = {}
    let profile = null
    for (const id of participantSectionIds) {
      const ranked = rankedBySection[id] || []
      const idx = ranked.findIndex(l => l.member_id === memberId)
      const log = idx >= 0 ? ranked[idx] : null
      if (log?.profile && !profile) profile = log.profile

      if (isValue) {
        const metric = classifySectionMetric(sectionsById[id]?.format, sectionsById[id]?.format_config)
        const value = log && metric ? sectionValueForMember(log, metric, toKgForRanking, log.profile?.weight_unit) : null
        participantInputs[id] = metric
          ? { value, metric: metric.kind, unit: metric.unit, direction: metric.direction, classifiedTier: log?.variant_level ?? null }
          : undefined
      } else {
        participantInputs[id] = log ? { rank: idx + 1, classifiedTier: log?.variant_level ?? null } : undefined
      }
    }
    const result = deriveWorkoutAggregate(aggregateDefinition, participantInputs)
    if (result.status === 'available') entries.push({ memberId, profile, result })
  }

  entries.sort((a, b) => (a.result.comparator === 'higher' ? b.result.value - a.result.value : a.result.value - b.result.value))

  return {
    combineFunction,
    label: COMBINE_FUNCTION_LABELS[combineFunction] || 'Overall',
    comparator: entries[0]?.result.comparator ?? null,
    entries,
  }
}
