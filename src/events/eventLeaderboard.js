// FORGE EVENTS - leaderboard = the best NON-deleted attempt per member, per
// division, ordered by FORGE's canonical comparator sortSectionLogs
// (workoutFormats.js) UNCHANGED. sortSectionLogs already keeps "the better of
// a member's logs" (its byMember reduction uses the same comparator), which is
// exactly the approved best-attempt model - this file only adapts attempts to
// the log shape it reads and never decides an order itself.
//
// Adapter rules:
//   - logged_at := scored_at (event_update_attempt moves scored_at only when
//     the score changes, so an edited score loses its earlier tie position -
//     sortSectionLogs' logged_at tie-break, unchanged).
//   - format/config := the attempt's FROZEN format_snapshot /
//     format_config_snapshot (P10: never reinterpret with the live config).
//   - Max Effort: LOAD converted to kg with toKgForRanking, DISTANCE (km) to
//     metres - see eventScoring.maxEffortRankValue. LOAD: converted to kg with
//     the existing toKgForRanking BEFORE ranking, the same convention
//     sortSectionLogs' sets branch and componentLeaderboard's Max Effort
//     branch use; the displayed value stays the member's own entry + unit.
//   - Gender filter: members.gender via resolveAthleteGenderKey. Unknown
//     gender is NEVER guessed - such members only appear under "All".

import { sortSectionLogs } from '../workoutFormats'
import { resolveAthleteGenderKey } from '../rxEngine'
import { maxEffortUnit, maxEffortRankValue } from './eventScoring'
import { EVENT_DIVISIONS } from './eventModel'

function scoringContext(event, attempts) {
  const first = attempts.find((a) => a.format_snapshot)
  return {
    formatId: first?.format_snapshot || event.workout_format,
    config: (first ? first.format_config_snapshot : event.workout_format_config) || {},
  }
}

// Max Effort: compare in ONE unit (load -> kg via toKgForRanking, distance -> metres).
function rankableResult(attempt, maxEffortScoreUnit) {
  if (!maxEffortScoreUnit) return attempt.result
  const v = maxEffortRankValue(maxEffortScoreUnit, attempt.result, attempt.weight_unit)
  return v == null ? null : String(v)
}

/**
 * @param event     the event row (divisions, workout_format, workout_format_config)
 * @param attempts  every attempt the member can see (own incl. deleted; others' non-deleted)
 * @param membersById Map/obj id -> { full_name, gender, avatar_url, ... }
 * @param opts      { division, gender: 'all' | 'male' | 'female' }
 * @returns [{ rank, attempt, member, attemptCount }] best first
 */
export function rankEventLeaderboard(event, attempts, membersById, { division, gender = 'all' } = {}) {
  const get = (id) => (membersById instanceof Map ? membersById.get(id) : membersById?.[id]) || null
  const live = (attempts || []).filter((a) => !a.deleted_at && (!division || a.division === division))
  const filtered = gender === 'all'
    ? live
    : live.filter((a) => resolveAthleteGenderKey(get(a.member_id)?.gender) === gender)
  const { formatId, config } = scoringContext(event, filtered)
  const maxEffortScoreUnit = formatId === 'Max Effort' ? maxEffortUnit(config) : null

  const counts = new Map()
  for (const a of filtered) counts.set(a.member_id, (counts.get(a.member_id) || 0) + 1)

  const logs = filtered.map((a) => ({
    id: a.id,
    member_id: a.member_id,
    result: rankableResult(a, maxEffortScoreUnit),
    time_result: a.time_result,
    completion_state: a.completion_state,
    sets: a.sets,
    log_meta: a.log_meta,
    logged_at: a.scored_at,
    _attempt: a,
  }))
  const ranked = sortSectionLogs(logs, formatId, config)
  return ranked.map((log, i) => ({
    rank: i + 1,
    attempt: log._attempt,
    member: get(log.member_id),
    attemptCount: counts.get(log.member_id) || 1,
  }))
}

/** The member's own best non-deleted attempt in their division (same comparator). */
export function bestAttemptId(event, myAttempts) {
  const live = (myAttempts || []).filter((a) => !a.deleted_at)
  if (live.length === 0) return null
  const [best] = rankEventLeaderboard(event, live, {}, {})
  return best?.attempt?.id ?? null
}

/** Divisions to show as leaderboard tabs: the event's, in canonical order. */
export function leaderboardDivisions(event) {
  const set = new Set(event.divisions || [])
  return EVENT_DIVISIONS.filter((d) => set.has(d))
}
