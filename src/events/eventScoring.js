// FORGE EVENTS - score input + composition, built ONLY from FORGE's existing
// scoring primitives. No new scoring engine, no new comparison rules:
//   - INPUT: scoreDefinitionFor (scoreDefinition.js) drives the existing
//     <UniversalScoreInput>, whose value shape is FormatLogger's
//     ({ time, roundsCompleted, additionalReps, partialReps, result, ... }).
//   - COMPOSITION: the same pure helpers App.jsx's composeWodLogFieldsInner
//     calls on its primary "Log WOD" path (logWodPrimaryPath), in the same
//     order, followed by the same normalizeCompletionState write boundary:
//       ROUNDS_REPS (AMRAP / Ascending AMRAP)  -> composeCappedRoundsResult
//       non-sequential fortime_or_amrap         -> composeFortimeOrAmrapFields
//       sequential For Time, finished           -> time + deriveDurationCompletionState(false)
//       sequential For Time, capped             -> composePartialText(repsEfectiveSecvential(...))
//                                                  + deriveDurationCompletionState(true)
//       Max Effort (single_value)               -> result verbatim, completion_state null
//   - RANKING: eventLeaderboard.js -> sortSectionLogs, unchanged.
//
// ONE disclosed adaptation: an event's workout is free text (events has no
// structured movement list), so the per-movement partial-rep rows the WOD
// logger shows for a capped SEQUENTIAL workout (For Time "Sequence",
// Chipper, Ladder, Once) and a Sequence AMRAP have no movements to render.
// Those capture a single "total reps" number instead, composed through the
// SAME composePartialText with one canonical row label ('reps'):
// "N reps". sortSectionLogs' sequential path (partialRepsOfLog(log, true))
// sums the leading number of each segment -> N, so ordering is exactly the
// existing sequential ordering (golden tests in eventScoring.test.js).

import { scoreDefinitionFor } from '../scoreDefinition'
import {
  getFormat, effectiveScoreMode, isSequentialFormat, isSequentialAmrap,
  composeCappedRoundsResult, parseCappedRoundsResult, composeFortimeOrAmrapFields,
  composePartialText, repsEfectiveSecvential, deriveDurationCompletionState, normalizeCompletionState, toKgForRanking,
} from '../workoutFormats'

/** The migration's events_scoring_v1_formats CHECK - nothing else is scorable. */
export const EVENT_SCORING_FORMATS = [
  'AMRAP', 'Ascending AMRAP', 'For Time', 'RFT', 'Chipper', 'Ladder', 'Partner WOD', 'Once', 'Max Effort',
]

/**
 * Max Effort score type (owner-approved 2026-10-14, Phase 3.1): the existing
 * events.workout_format_config jsonb carries `scoreUnit` - no schema change.
 * The Admin event editor REQUIRES it whenever Max Effort scoring is on.
 *   load        - kg/lb (the member's own unit, stored in event_attempts.weight_unit;
 *                 normalised to kg for ranking with toKgForRanking)
 *   reps        - integer reps
 *   calories    - integer calories
 *   distance_m  - metres          } explicit distance unit, fixed per event
 *   distance_km - kilometres      } (normalised to metres for ranking)
 * Missing / unknown (legacy or incomplete config, incl. a bare 'distance') is
 * NOT guessed: scoring refuses with MISCONFIGURED and a clear message - never
 * an unranked free-text fallback.
 * Keep in sync with forge-admin-web/src/features/events/types.ts
 * (MAX_EFFORT_SCORE_UNITS) - both repos pin the same list in tests.
 */
export const MAX_EFFORT_UNIT_KEY = 'scoreUnit'
export const MAX_EFFORT_UNITS = ['load', 'reps', 'calories', 'distance_m', 'distance_km']

/** Canonical label of the single "total reps" row (stored in the result text). */
export const TOTAL_REPS_ROW = 'reps'

export function maxEffortUnit(config) {
  const u = config?.[MAX_EFFORT_UNIT_KEY]
  return MAX_EFFORT_UNITS.includes(u) ? u : null
}

/** Distance score type -> its explicit unit ('m' | 'km'), else null. */
export function maxEffortDistanceUnit(unit) {
  return unit === 'distance_m' ? 'm' : unit === 'distance_km' ? 'km' : null
}

/** A Max Effort value in its ranking unit: load -> kg, distance -> metres, else unchanged. */
export function maxEffortRankValue(unit, value, weightUnit) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return null
  if (unit === 'load') return toKgForRanking(n, weightUnit === 'lb' ? 'lbs' : 'kg')
  if (unit === 'distance_km') return n * 1000
  return n
}

/** The format/config an attempt is scored under: the event's (frozen once the first attempt exists). */
export function eventScoringFormat(event) {
  return { formatId: event.workout_format, config: event.workout_format_config || {} }
}

/**
 * ScoreDefinition for an event, via scoreDefinitionFor. `memberWeightUnit` is
 * the member's own profile unit ('kg' | 'lbs') for a LOAD input.
 * Returns { kind: 'UNSUPPORTED' } for anything outside the v1 matrix - the
 * UI must never offer a SETS / STAGES / MIXED / Composer input here.
 */
export function eventScoreDefinition(event, memberWeightUnit = 'kg') {
  const { formatId, config } = eventScoringFormat(event)
  if (!EVENT_SCORING_FORMATS.includes(formatId)) return { kind: 'UNSUPPORTED' }
  const unit = maxEffortUnit(config)
  // Fail safe: a Max Effort event without a valid score type is never scored as free text.
  if (formatId === 'Max Effort' && !unit) return { kind: 'MISCONFIGURED' }
  const distanceUnit = maxEffortDistanceUnit(unit)
  const def = scoreDefinitionFor(formatId, config, {
    singleValueUnit: distanceUnit ? 'distance' : unit,
    unit: unit === 'load' ? (memberWeightUnit === 'lbs' ? 'lb' : 'kg') : distanceUnit || undefined,
  })
  if (['SETS', 'STAGES', 'MIXED', 'NONE'].includes(def.kind)) return { kind: 'UNSUPPORTED' }
  // Sequence AMRAP without structured stations: the existing definition falls
  // back to ROUNDS_REPS, but this format RANKS sequentially (total reps) -
  // capture the total directly so input and ranking agree (see header).
  if (isSequentialAmrap(formatId, config)) return { kind: 'REPS', integer: true, eventsTotalReps: true }
  return def
}

const s = (v) => (v == null ? '' : String(v)).trim()

/**
 * Editor value (UniversalScoreInput shape) -> the score fields
 * event_submit_attempt / event_update_attempt accept (forge_events_clean_score
 * keys). `memberWeightUnit` is stored with a LOAD result so the leaderboard can
 * normalise kg/lb.
 */
export function composeEventScoreFields(event, value, memberWeightUnit = 'kg') {
  const v = value || {}
  const { formatId, config } = eventScoringFormat(event)
  const def = eventScoreDefinition(event, memberWeightUnit)
  const notes = s(v.notes) || null
  const base = { sets: null, log_meta: null, weight_logged: null, weight_unit: null, notes }

  if (def.kind === 'UNSUPPORTED' || def.kind === 'MISCONFIGURED') throw new Error('invalid_fields')

  if (def.eventsTotalReps) {
    // Sequence AMRAP (adaptation, see header): AMRAP never has a "capped" state.
    const result = composePartialText([s(v.result)], [TOTAL_REPS_ROW])
    return { ...base, result: result || null, time_result: null, completion_state: null }
  }

  const format = getFormat(formatId)
  const mode = effectiveScoreMode(formatId, config) || format.scoreMode

  if (mode === 'amrap') {
    // composeWodLogFieldsInner, logWodPrimaryPath branch: rounds + one "additional reps" number.
    const result = composeCappedRoundsResult(v.roundsCompleted, v.additionalReps)
    return normalizeCompletionState({ ...base, result: result || null, time_result: null, completion_state: null })
  }

  if (mode === 'single_value') {
    const result = s(v.result) || null
    const isLoad = def.kind === 'LOAD'
    return normalizeCompletionState({
      ...base,
      result,
      time_result: null,
      completion_state: null,
      weight_unit: isLoad && result ? (memberWeightUnit === 'lbs' ? 'lb' : 'kg') : null,
    })
  }

  // fortime_or_amrap
  if (!isSequentialFormat(formatId, config)) {
    const { result, time_result, completionState } = composeFortimeOrAmrapFields({
      wodTime: isPositiveTime(v.time) ? s(v.time) : '',
      wodRoundsCompleted: v.roundsCompleted || '',
      wodPartialReps: [],
      movements: [],
      rounds: config.rounds,
      wodResult: '',
      wodAdditionalReps: v.additionalReps ?? '',
    })
    return normalizeCompletionState({ ...base, result, time_result, completion_state: completionState })
  }

  // Sequential (For Time Sequence / Chipper / Ladder / Once).
  if (isPositiveTime(v.time)) {
    return normalizeCompletionState({ ...base, result: null, time_result: s(v.time), completion_state: deriveDurationCompletionState(false) })
  }
  const totalReps = s((v.partialReps || [])[0])
  const result = totalReps ? composePartialText(repsEfectiveSecvential([totalReps], [TOTAL_REPS_ROW]), [TOTAL_REPS_ROW]) : ''
  return normalizeCompletionState({ ...base, result: result || null, time_result: null, completion_state: result ? deriveDurationCompletionState(true) : null })
}

/** A TimeRow value ("mm:ss", either part possibly blank) that is a real, positive time. */
export function isPositiveTime(time) {
  const m = s(time).match(/^(\d*):(\d*)$/)
  if (!m || (m[1] === '' && m[2] === '')) return false
  return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0) > 0
}

const positiveNumber = (x) => s(x) !== '' && Number(s(x)) > 0

/**
 * Has the member actually ENTERED a score for this definition? Checked BEFORE
 * composing: composeFortimeOrAmrapFields fills "N runde complete" from the
 * configured rounds even for an untouched draft, which must never be
 * submitted as a score.
 */
export function eventScoreReady(event, value, memberWeightUnit = 'kg') {
  const v = value || {}
  const def = eventScoreDefinition(event, memberWeightUnit)
  switch (def.kind) {
    case 'UNSUPPORTED': case 'MISCONFIGURED': return false
    case 'ROUNDS_REPS': return s(v.roundsCompleted) !== ''
    // Same rule as the server (Phase 3.2 trigger): a plain positive decimal; whole for reps/calories.
    case 'REPS': case 'LOAD': case 'CALORIES': case 'DISTANCE':
      return /^[0-9]+(\.[0-9]+)?$/.test(s(v.result)) && positiveNumber(v.result) && (!def.integer || Number.isInteger(Number(s(v.result))))
    case 'FREE': return s(v.result) !== ''
    case 'TIME': case 'TIME_CAPPED': {
      if (isPositiveTime(v.time)) return true
      if (def.kind !== 'TIME_CAPPED') return false
      return def.sequential ? positiveNumber((v.partialReps || [])[0]) : s(v.roundsCompleted) !== ''
    }
    default: return false
  }
}

/** True when the composed fields carry a score (forge_events_clean_score's empty_score rule). */
export function hasScore(fields) {
  return !!(s(fields?.result) || s(fields?.time_result))
}

/** Stored attempt -> editor value, for the edit flow (inverse of composeEventScoreFields). */
export function attemptToEditorValue(event, attempt) {
  const { formatId, config } = eventScoringFormat(event)
  const def = eventScoreDefinition(event)
  const notes = attempt.notes || ''
  if (def.eventsTotalReps) return { result: (attempt.result || '').match(/^(\d+(\.\d+)?)/)?.[1] || '', notes }
  const mode = effectiveScoreMode(formatId, config) || getFormat(formatId).scoreMode
  if (mode === 'amrap') {
    const { rounds, additional } = parseCappedRoundsResult(attempt.result)
    return { roundsCompleted: rounds, additionalReps: additional, notes }
  }
  if (mode === 'single_value') return { result: attempt.result || '', notes }
  if (attempt.time_result) return { time: attempt.time_result, notes }
  if (!isSequentialFormat(formatId, config)) {
    const { rounds, additional } = parseCappedRoundsResult(attempt.result)
    return { roundsCompleted: rounds, additionalReps: additional, notes }
  }
  return { partialReps: [(attempt.result || '').match(/^(\d+(\.\d+)?)/)?.[1] || ''], notes }
}

/**
 * Movement rows the existing capped-sequential input renders: one row, the
 * localized "Total reps" label (the stored text always uses TOTAL_REPS_ROW).
 */
export function eventInputMovements(event, s_) {
  const { formatId, config } = eventScoringFormat(event)
  return isSequentialFormat(formatId, config) ? [s_.totalReps] : []
}
