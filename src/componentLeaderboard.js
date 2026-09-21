// FORGE WORKOUT COMPOSER - MULTI-PART SCORING TICKET, Parts 8/9/10/11/12/13
// (leaderboard root fix + per-component ranking + Overall aggregation).
//
// ROOT CAUSE (confirmed by reading the real code, this session):
// sortSectionLogs (workoutFormats.js) reads ONLY the legacy scalar fields
// (result/time_result/completion_state/sets) - it never looks at
// log_meta.componentResults. Every Composer log with 2+ scorers (and, per
// componentContract.js's own additive fix alongside this file, a solo
// Max Effort/Load scorer too - Part 5 has no legacy scalar slot for a load
// value) always has NULL scalars, so it silently ranks as an unfinished
// DNF, ordered only by submission time. This file is the ADDITIVE fix:
// it never edits sortSectionLogs' own branches (every existing format's
// single-score ranking stays byte-identical, reused directly for the new
// per-component pipeline wherever its exact engine already applies) - it
// only adds a NEW read path for logs that actually carry componentResults.
//
// COMPETITION RANKING (1,1,3,4 - never dense 1,1,2,3) is the placement
// convention for every NEW ranking this file produces (per-component AND
// Overall) - the pre-existing single-score sortSectionLogs comparator is
// never touched and keeps its own strict logged_at tiebreak unchanged.
//
// OVERALL AGGREGATION reuses workoutAggregation.js's deriveWorkoutAggregate
// (the EXISTING, already-shipped, already-tested placement-sum engine)
// completely unmodified - this file is the "thinnest safe adapter" the
// ticket asks for: Composer component ids stand in for
// aggregateDefinition.participantSectionIds, and this file's own
// competition-rank-per-component output supplies each participant's
// {rank, classifiedTier} input. deriveWorkoutAggregate's own missingPolicy
// default ('unavailable') is EXACTLY the ticket's required INCOMPLETE
// semantics - a member missing a rank for any required component gets
// status:'unavailable' there, mapped to INCOMPLETE (no fake placement) here.

import {
  getFormat, isSequentialFormat, isWeightScoredSetsFormat, setsDisplayScore,
  toKgForRanking, parseTimeResult, parseRoundsScore, partialRepsOfLog,
} from './workoutFormats'
import { getComponentResultsFromLog } from './componentContract'
import { deriveWorkoutAggregate } from './workoutAggregation'

/** True when a log's score lives in the NEW componentResults shape (2+
 * scorers, OR a solo Max Effort/Load scorer - componentContract.js's own
 * additive fix) rather than the legacy scalar fields. The ONE switch this
 * whole leaderboard fix hinges on - a log for which this is false must be
 * ranked by the EXISTING sortSectionLogs pipeline, completely untouched. */
export function logHasComponentResults(log) {
  const cr = log?.log_meta?.componentResults
  return !!(cr && typeof cr === 'object' && Object.keys(cr).length > 0)
}

/** ticket §14 - "do NOT hardcode 'Part A'/'Part B' strings if components
 * have canonical labels — derive from component order/label as fallback";
 * stable identity stays the component's own id (scorer.id), this label is
 * display-only. Pure (no React), so it lives alongside the rest of this
 * file's data layer rather than the UI component module. */
export function partTabLabel(scorer, index) {
  return scorer?.label || `Part ${String.fromCharCode(65 + index)}`
}

/** Competition ranking (1,1,3,4) over an array already sorted best-to-worst
 * (ties adjacent). `tiesWith(a,b)` decides whether consecutive entries are
 * a genuine tie - never a hidden logged_at tiebreak (ticket §11). Returns a
 * NEW array of `{...entry, rank}`. */
function assignCompetitionRanks(sortedEntries, tiesWith) {
  let place = 1
  return sortedEntries.map((entry, i) => {
    if (i > 0 && !tiesWith(sortedEntries[i - 1], entry)) place = i + 1
    return { ...entry, rank: place }
  })
}

// --- Per-component ranking (Part 9/10/11) -----------------------------------

function genericRankKey(entry, isSequential) {
  const finished = entry.completion_state != null ? entry.completion_state === 'completed' : !!entry.time_result
  if (finished) return { finished: true, time: parseTimeResult(entry.time_result) }
  const rounds = isSequential ? null : (parseRoundsScore(entry.result) || 0)
  const partial = partialRepsOfLog({ result: entry.result || '' }, isSequential)
  return { finished: false, rounds, partial }
}

// Mirrors sortSectionLogs' own generic comparator exactly (finished-outranks-
// DNF, then time ascending / rounds+partial descending) - reused logic, not
// reimplemented; this is only the tie-aware variant (no logged_at fallback).
function compareGenericKeys(ka, kb) {
  if (ka.finished !== kb.finished) return ka.finished ? -1 : 1
  if (ka.finished) return ka.time - kb.time
  if (ka.rounds !== kb.rounds) return (kb.rounds ?? 0) - (ka.rounds ?? 0)
  return kb.partial - ka.partial
}

function hasAnyGenericResult(entry) {
  return !!(entry && (entry.result != null || entry.time_result != null || entry.completion_state != null))
}

/** Ranks ONE scored Composer component across a set of members' logs, tie-
 * aware, competition placement (ticket §9/§11). `scorer` = the component's
 * own `{id, format, config}` (from componentsSnapshot / getOrderedScoreEnvelopes).
 * `logsByMember` = `[{memberId, log, profile}]`, already ONE log per member
 * (latest-submission dedup is the caller's job, exactly like sortSectionLogs
 * already assumes). Reuses each native format's EXISTING score semantics -
 * For Time/RFT/AMRAP via the same finished/time/rounds/partial primitives
 * sortSectionLogs itself uses (never a second DNF algorithm), family:'sets'
 * via the EXISTING setsDisplayScore, LOAD (Max Effort) via a new - because
 * no prior format ever needed one - simple higher-wins numeric comparator.
 * Returns every member, ranked ones first (`rank` ascending, ties share a
 * rank) then unranked ones (`rank: null` - never logged this component at
 * all, distinct from a DNF/capped result which IS rankable). */
export function rankComponentAcrossLogs(scorer, logsByMember) {
  const format = scorer.format
  const fmt = getFormat(format)
  const rows = (logsByMember || []).map(({ memberId, log, profile }) => {
    const entry = (getComponentResultsFromLog(log) || []).find(r => r.componentId === scorer.id) || null
    return { memberId, log, profile: profile ?? log?.profile ?? null, entry }
  })

  if (fmt.scoreMode === 'single_value' && format === 'Max Effort') {
    // Cross-member LOAD comparison, so every member's own profile.weight_unit
    // must normalize to ONE canonical unit before comparing raw numbers -
    // the exact same toKgForRanking convention sectionValueForMember/
    // sortSectionLogs' own family:'sets' LOAD branch already relies on
    // (neither one stores a per-result unit tag either; both infer it from
    // the poster's profile), never a bespoke kg/lb rule for this format.
    const scored = rows.map(r => ({
      ...r, _rankKg: r.entry && r.entry.load_result != null ? toKgForRanking(r.entry.load_result, r.profile?.weight_unit || 'kg') : null,
    }))
    const withValue = scored.filter(r => r._rankKg != null)
    const missing = scored.filter(r => r._rankKg == null)
    withValue.sort((a, b) => b._rankKg - a._rankKg)
    const ranked = assignCompetitionRanks(withValue, (a, b) => a._rankKg === b._rankKg)
    return [...ranked, ...missing.map(r => ({ ...r, rank: null }))]
  }

  if (fmt.family === 'sets') {
    // Reuses the EXISTING sets scoring engine (setsDisplayScore/
    // isWeightScoredSetsFormat/toKgForRanking) unchanged. unitsByKey is
    // deliberately null here (resolveStationUnitsByKey's own documented
    // "no unit info, trust the sum" fallback) - a per-Composer-component
    // EMOM mixed-unit prescription snapshot isn't threaded through this
    // adapter; that stays the SAME pre-existing, disclosed backlog gap
    // sortSectionLogs itself already carries for mixed-unit stations, not
    // a new limitation introduced here.
    const weightScored = isWeightScoredSetsFormat(scorer.config, format)
    const scored = rows.map(r => {
      const score = r.entry ? setsDisplayScore(format, scorer.config, r.entry.sets, null) : null
      const rankScore = (weightScored && score != null) ? toKgForRanking(score, r.profile?.weight_unit || 'kg') : score
      return { ...r, _rankScore: rankScore }
    })
    const withValue = scored.filter(r => r._rankScore != null)
    const missing = scored.filter(r => r._rankScore == null)
    withValue.sort((a, b) => b._rankScore - a._rankScore)
    const ranked = assignCompetitionRanks(withValue, (a, b) => a._rankScore === b._rankScore)
    return [...ranked, ...missing.map(r => ({ ...r, rank: null }))]
  }

  // Generic: For Time / RFT / AMRAP / Partner WOD / Chipper / Ladder, etc -
  // the exact same finished/time/rounds/partial semantics sortSectionLogs'
  // own generic branch already uses, reused via the primitives it itself
  // calls (parseTimeResult/parseRoundsScore/partialRepsOfLog), never a
  // second parser.
  const isSequential = isSequentialFormat(format, scorer.config)
  const withValue = rows.filter(r => hasAnyGenericResult(r.entry))
  const missing = rows.filter(r => !hasAnyGenericResult(r.entry))
  const keyed = withValue.map(r => ({ ...r, _key: genericRankKey(r.entry, isSequential) }))
  keyed.sort((a, b) => compareGenericKeys(a._key, b._key))
  const ranked = assignCompetitionRanks(keyed, (a, b) => compareGenericKeys(a._key, b._key) === 0)
  return [...ranked, ...missing.map(r => ({ ...r, rank: null }))]
}

// --- Overall aggregation (Part 12/13) ---------------------------------------

/** One tier's (Rx/Intermediate/Beginner/Mixed - already pre-filtered by the
 * caller, exactly matching buildBlocksForPrimary's existing per-NIVEL split;
 * ticket §13 - Overall NEVER mixes tiers) Overall placements, for 2+ scored
 * Composer components. `scorers` = the canonical-order scored components
 * (getOrderedScoreEnvelopes' own `.scorer` entries, or componentsSnapshot
 * filtered to producesScore:true, in canonical order - identity is the
 * component's own stable id, never its display label). `logsByMember` =
 * `[{memberId, log, profile}]`, one (latest) log per member for this tier.
 *
 * Reuses workoutAggregation.js's deriveWorkoutAggregate UNCHANGED for the
 * actual placement-sum math (Part 12 - "do not reimplement this math").
 * Its own default missingPolicy:'unavailable' IS the ticket's INCOMPLETE
 * semantics: any member missing a rank for any scored component never gets
 * an Overall placement, full stop - never a fake last-place/zero/DNF value.
 * Overall ties use the SAME competition-ranking convention as every other
 * NEW ranking in this file. Returns `{ranked, incomplete}` -
 * `ranked[i] = {memberId, profile, points, rank}` (lowest points win,
 * competition placement), `incomplete[i] = {memberId, profile}` (no rank,
 * ticket's own "— Name Incomplete" UI convention). */
export function computeOverallPlacements(scorers, logsByMember) {
  const componentIds = (scorers || []).map(s => s.id)
  const ranksByComponent = {}
  ;(scorers || []).forEach(scorer => {
    const ranked = rankComponentAcrossLogs(scorer, logsByMember)
    ranksByComponent[scorer.id] = new Map(ranked.map(r => [r.memberId, r]))
  })

  const aggregateDefinition = { participantSectionIds: componentIds, combineFunction: 'placement-sum' }
  const results = (logsByMember || []).map(({ memberId, log, profile }) => {
    const participantInputs = {}
    componentIds.forEach(id => {
      const r = ranksByComponent[id]?.get(memberId)
      participantInputs[id] = r && r.rank != null ? { rank: r.rank, classifiedTier: log?.variant_level ?? null } : undefined
    })
    const result = deriveWorkoutAggregate(aggregateDefinition, participantInputs)
    return { memberId, profile: profile ?? log?.profile ?? null, logId: log?.id ?? null, result }
  })

  const available = results.filter(r => r.result.status === 'available')
    .sort((a, b) => a.result.value - b.result.value)
  const ranked = assignCompetitionRanks(available, (a, b) => a.result.value === b.result.value)
    .map(r => ({ memberId: r.memberId, profile: r.profile, logId: r.logId, points: r.result.value, rank: r.rank }))
  const incomplete = results.filter(r => r.result.status !== 'available')
    .map(r => ({ memberId: r.memberId, profile: r.profile, logId: r.logId }))

  return { ranked, incomplete }
}
