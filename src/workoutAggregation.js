// Workout Aggregation, Phase A - Piece 2: the pure aggregation engine.
// Ports the two-family taxonomy from WORKOUT_AGGREGATION_ARCHITECTURE.md
// S8 exactly - no eighth combine function, no custom formula, no
// coercion. Pure: no Supabase calls, no React state, no network, no LLM.
// Given the same structured inputs, output is always identical (mission
// S14). Never mutates a Section Result - Section Results remain atomic
// truth (mission's own Final Principle); this module only ever COMBINES
// already-computed per-Section values/ranks, never re-derives them (that
// remains sortSectionLogs'/setsDisplayScore's job, unmodified, called by
// the caller before this module ever runs - S26's dependency direction:
// Section Results -> Section Leaderboards -> Section Ranks -> Rank
// Aggregate, never reversed).

import { getFormat, isWeightScoredSetsFormat } from './workoutFormats'

export const VALUE_COMBINE_FUNCTIONS = ['sum', 'best-of', 'average', 'max', 'min']
export const RANK_COMBINE_FUNCTIONS = ['placement-sum', 'points-sum']
export const COMBINE_FUNCTIONS = [...VALUE_COMBINE_FUNCTIONS, ...RANK_COMBINE_FUNCTIONS]

// Family-A metric classification for one Section's format. Deliberately
// narrow for Phase A (S9/S13 of the architecture doc require "same metric
// kind/unit/direction" but do not enumerate which kinds are in scope) -
// LOAD and REPS (family:'sets', per isWeightScoredSetsFormat) and TIME
// (family:'scored', scoreMode:'fortime_or_amrap', member-instance-
// dependent - see sectionValueForMember) are supported; ROUNDS_REPS
// (Composite, scoreMode:'amrap') and mixed/nft/chained are NOT offered
// for Family A in Phase A (no acceptance case demands them, and summing
// two Composites is only well-defined when both share the same
// reps-per-round denominator, which this phase does not attempt to
// verify) - excluded structurally (returns null), never guessed. Family B
// (rank-combine) remains available for any format regardless.
export function classifySectionMetric(formatId, formatConfig) {
  if (!formatId) return null
  const format = getFormat(formatId)
  if (format.family === 'sets') {
    return isWeightScoredSetsFormat(formatConfig, formatId)
      ? { kind: 'LOAD', unit: 'kg', direction: 'higher' }
      : { kind: 'REPS', unit: 'count', direction: 'higher' }
  }
  if (format.family === 'scored' && format.scoreMode === 'fortime_or_amrap') {
    return { kind: 'TIME', unit: 'seconds', direction: 'lower' }
  }
  return null
}

// Coach-authoring UX helper (Phase 3, S17): given 2+ candidate Sections'
// {format, formatConfig} the coach has selected (or is considering), which
// of the 7 approved combine functions are legal choices right now? Family B
// (placement-sum/points-sum) is unit-agnostic (S8) and therefore always
// offered once there are 2+ candidates - Family A is only offered when
// every candidate classifies to the same metric kind/unit/direction (the
// same rule validateAggregateDefinition enforces after the fact; this
// function answers the same question BEFORE a choice is made, so the
// editor can show Family A as an absent option rather than a validation
// error surfaced later, per S17's own explicit instruction). Pure, no
// Section-count-of-1 case (returns []) since an aggregate always needs 2+.
export function getCompatibleCombineFunctions(sections) {
  if (!Array.isArray(sections) || sections.length < 2) return []
  const metrics = sections.map(s => classifySectionMetric(s.format, s.formatConfig))
  const valueCompatible = metrics.every(m => m != null) &&
    metrics.every(m => m.kind === metrics[0].kind && m.unit === metrics[0].unit && m.direction === metrics[0].direction)
  return valueCompatible ? COMBINE_FUNCTIONS : RANK_COMBINE_FUNCTIONS
}

// Structural + Family-A compatibility validation, mirroring the DB
// trigger's structural checks (20260822100000_workout_aggregation_
// phase_a.sql) plus the one check that trigger deliberately does NOT do
// (metric-kind/unit/direction compatibility, which needs format/
// formatConfig semantics already modeled here in JS, not duplicated into
// SQL - the documented trust-boundary split mission S42 explicitly
// permits). `sections` = the exact Sections
// aggregateDefinition.participantSectionIds resolves to, already fetched
// by the caller ({ id, format, formatConfig, workoutId, gymId,
// loggingMode }[]).
export function validateAggregateDefinition(aggregateDefinition, sections) {
  const errors = []
  if (!aggregateDefinition) return { valid: true, errors: [] }

  const { participantSectionIds, combineFunction, pointsTable } = aggregateDefinition

  if (!COMBINE_FUNCTIONS.includes(combineFunction)) {
    errors.push(`combineFunction must be one of ${COMBINE_FUNCTIONS.join(', ')}, got: ${combineFunction}`)
  }
  if (!Array.isArray(participantSectionIds) || participantSectionIds.length < 2) {
    errors.push('participantSectionIds must reference at least 2 Sections')
  } else if (new Set(participantSectionIds).size !== participantSectionIds.length) {
    errors.push('participantSectionIds must not contain duplicates')
  }
  if (combineFunction === 'points-sum' && (!Array.isArray(pointsTable) || pointsTable.length === 0)) {
    errors.push('pointsTable is required and must be non-empty when combineFunction is points-sum')
  }
  if (errors.length > 0) return { valid: false, errors }

  const byId = new Map(sections.map(s => [s.id, s]))
  const resolved = participantSectionIds.map(id => byId.get(id))
  const missing = participantSectionIds.filter((id, i) => !resolved[i])
  if (missing.length > 0) {
    errors.push(`participantSectionIds references Sections not found or not required: ${missing.join(', ')}`)
    return { valid: false, errors }
  }
  const workoutIds = new Set(resolved.map(s => s.workoutId))
  if (workoutIds.size > 1) errors.push('participantSectionIds must all belong to the same Workout')
  const notRequired = resolved.filter(s => s.loggingMode !== 'required').map(s => s.id)
  if (notRequired.length > 0) errors.push(`participantSectionIds must all be logging_mode:'required': ${notRequired.join(', ')}`)

  if (VALUE_COMBINE_FUNCTIONS.includes(combineFunction)) {
    const metrics = resolved.map(s => classifySectionMetric(s.format, s.formatConfig))
    if (metrics.some(m => m == null)) {
      errors.push('every participant Section must have a Family-A-compatible format (LOAD, REPS, or TIME) for a value-combine function')
    } else {
      const first = metrics[0]
      const incompatible = metrics.some(m => m.kind !== first.kind || m.unit !== first.unit || m.direction !== first.direction)
      if (incompatible) errors.push('participant Sections must share the same metric kind, canonical unit, and comparator direction for a value-combine function (S13/S14) - use a rank-combine function instead')
    }
  }

  return { valid: errors.length === 0, errors }
}

// Given a normalized Section-result log (wod_logs shape, or skill_logs
// already normalized into that shape upstream - result-source identity is
// irrelevant here exactly as it already is in sortSectionLogs, S13/S53 of
// the mission) and that Section's metric classification, returns the
// member's canonical numeric value for Family-A purposes, or null if this
// specific log cannot supply one (e.g. a TIME-metric Section whose log
// never finished - capped/DNF - has no valid Duration to sum, distinct
// from the Section being metric-incompatible at the definition level).
export function sectionValueForMember(log, metric, toKgForRankingFn, weightUnit) {
  if (!log || !metric) return null
  if (metric.kind === 'LOAD') {
    const raw = typeof log._setsScore === 'number' ? log._setsScore : null
    return raw == null ? null : toKgForRankingFn(raw, weightUnit || 'kg')
  }
  if (metric.kind === 'REPS') {
    return typeof log._setsScore === 'number' ? log._setsScore : null
  }
  if (metric.kind === 'TIME') {
    const finished = log.completion_state != null ? log.completion_state === 'completed' : !!log.time_result
    if (!finished) return null
    const parts = (log.time_result || '').trim().split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return null
  }
  return null
}

const combine = (values, fn) => {
  if (fn === 'sum') return values.reduce((a, b) => a + b, 0)
  if (fn === 'average') return values.reduce((a, b) => a + b, 0) / values.length
  if (fn === 'max') return Math.max(...values)
  if (fn === 'min') return Math.min(...values)
  if (fn === 'best-of') return null // resolved by caller via direction (see deriveWorkoutAggregate)
  return null
}

// The pure combination step (mission S14: deriveWorkoutAggregate). Never
// fetches, never mutates. `participantInputs` is a plain object keyed by
// sectionId, already fully resolved by the caller BEFORE this runs:
//   Family A: { value: number|null, metric, unit, direction, classifiedTier: string|null }
//     (metric/unit/direction = classifySectionMetric's own output for that
//     Section - already validated identical across participants by
//     validateAggregateDefinition, so this function trusts inputs[0]'s
//     copy rather than re-deriving/re-checking it)
//   Family B: { rank: number|null, classifiedTier: string|null }
// `options.missingPolicy` - 'unavailable' (default, both families) or
// 'worst-placement' (Family B only, S22 - not implemented as a numeric
// substitution here on purpose: Phase A does not have a real ranked-field
// size to compute "worst" from without a caller-supplied section size, so
// this policy is validated-but-rejected in Phase A, disclosed explicitly
// in the implementation report rather than approximated).
export function deriveWorkoutAggregate(aggregateDefinition, participantInputs, options = {}) {
  if (!aggregateDefinition) {
    return { status: 'unavailable', reason: 'no-definition', value: null, metric: null, unit: null, comparator: null, participatingSectionIds: [], classifiedTier: null }
  }
  const { participantSectionIds, combineFunction, pointsTable } = aggregateDefinition
  const missingPolicy = options.missingPolicy || 'unavailable'
  if (missingPolicy === 'worst-placement' && !RANK_COMBINE_FUNCTIONS.includes(combineFunction)) {
    return { status: 'unavailable', reason: 'invalid-definition', value: null, metric: null, unit: null, comparator: null, participatingSectionIds: participantSectionIds, classifiedTier: null }
  }

  const inputs = participantSectionIds.map(id => participantInputs[id])

  // Missing-input check first (S22) - uniform, never a guess.
  if (VALUE_COMBINE_FUNCTIONS.includes(combineFunction)) {
    if (inputs.some(i => i == null || i.value == null)) {
      return { status: 'unavailable', reason: 'missing-result', value: null, metric: null, unit: null, comparator: null, participatingSectionIds: participantSectionIds, classifiedTier: null }
    }
  } else {
    const anyMissing = inputs.some(i => i == null || i.rank == null)
    if (anyMissing && missingPolicy === 'unavailable') {
      return { status: 'unavailable', reason: 'missing-result', value: null, metric: null, unit: null, comparator: null, participatingSectionIds: participantSectionIds, classifiedTier: null }
    }
  }

  // Mixed-tier check (S24/S25) - an aggregate requires every participant's
  // Result to share the same classifiedTier; never a new "Mixed aggregate"
  // concept, just another missing-data-equivalent path.
  const tiers = new Set(inputs.map(i => i?.classifiedTier).filter(t => t != null))
  if (tiers.size > 1) {
    return { status: 'unavailable', reason: 'mixed-tier', value: null, metric: null, unit: null, comparator: null, participatingSectionIds: participantSectionIds, classifiedTier: null }
  }
  const classifiedTier = tiers.size === 1 ? [...tiers][0] : null

  if (VALUE_COMBINE_FUNCTIONS.includes(combineFunction)) {
    const values = inputs.map(i => i.value)
    const direction = inputs[0]?.direction || 'higher'
    let value
    if (combineFunction === 'best-of') value = direction === 'higher' ? Math.max(...values) : Math.min(...values)
    else value = combine(values, combineFunction)
    return {
      status: 'available', reason: null, value, metric: inputs[0]?.metric || null, unit: inputs[0]?.unit || null,
      comparator: direction, participatingSectionIds: participantSectionIds, classifiedTier,
    }
  }

  // Family B - rank-combine. Section ranks are pre-computed by the caller
  // via the existing, unmodified sortSectionLogs engine - this function
  // only sums/maps them, never re-derives a rank itself (S26's dependency
  // direction, enforced by this module simply never reading raw logs).
  const ranks = inputs.map(i => (i && i.rank != null ? i.rank : null))
  if (combineFunction === 'placement-sum') {
    const usable = ranks.filter(r => r != null)
    const value = usable.reduce((a, b) => a + b, 0)
    return { status: 'available', reason: null, value, metric: 'RANK_SUM', unit: 'placement', comparator: 'lower', participatingSectionIds: participantSectionIds, classifiedTier }
  }
  // points-sum
  const rankToPoints = new Map((pointsTable || []).map(row => [row.rank, row.points]))
  const points = ranks.map(r => (r != null ? (rankToPoints.get(r) ?? 0) : 0))
  const value = points.reduce((a, b) => a + b, 0)
  return { status: 'available', reason: null, value, metric: 'POINTS_SUM', unit: 'points', comparator: 'higher', participatingSectionIds: participantSectionIds, classifiedTier }
}
