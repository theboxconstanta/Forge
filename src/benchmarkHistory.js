// Member Performance, Phase 1 - Benchmark History. Pure, deterministic
// derivation over already-loaded wod_logs - NO new query, NO PR-engine
// dependency, NO movement-identity dependency (mission's own explicit
// stop conditions). Reuses the canonical Results comparator (sortSectionLogs)
// and canonical score extraction (setsDisplayScore/parseTimeResult) exactly
// as Clasament/Jurnal already do - never a second scoring/ranking
// implementation. See MEMBER_PERFORMANCE_DOMAIN_ARCHITECTURE_V1.md
// ("Comparison Identity", "Benchmark Identity") and
// MEMBER_PERFORMANCE_ADVERSARIAL_MATRIX.md (cases 6-8) for the design this
// ports.

import {
  sortSectionLogs, getFormat, setsDisplayScore, isWeightScoredSetsFormat,
  parseTimeResult,
} from './workoutFormats'

// Groups a member's already-loaded wod_logs by Benchmark Identity
// (wod_logs.benchmark_id, resolved server-side at logging time by
// snapshot_wod_log_context/resolve_benchmark_names - see
// MEMBER_PERFORMANCE_CURRENT_STATE_AUDIT.md). Only primary-Section
// ("metcon") logs ever carry a benchmark_id - the same trigger explicitly
// nulls it for additional-Section logs - so no Section-family filtering is
// needed here, it is already implicit in which rows have a non-null
// benchmark_id. Track-only/hidden-leaderboard Results are included by
// construction: this never reads workout_sections.leaderboard_visible at
// all (Architecture V1's "Track-only Results" / "Rx / Variant" sections).
export function groupLogsByBenchmark(wodLogs) {
  const groups = new Map()
  ;(wodLogs || []).forEach((log) => {
    if (!log.benchmark_id) return
    if (!groups.has(log.benchmark_id)) groups.set(log.benchmark_id, [])
    groups.get(log.benchmark_id).push(log)
  })
  return groups
}

// Groups one benchmark's logs by Scaling Context (Rx/Intermediate/Beginner/
// OnRamp) - Architecture V1's frozen "Rx / Variant" invariant: tiers are
// NEVER pooled into one comparison. A log with no variant_level (pre-tier
// legacy data) is treated as its own 'RX' bucket, matching the same
// default used elsewhere in this codebase (e.g. skill_logs' hardcoded
// variant_level:'RX').
export function groupLogsByTier(logs) {
  const groups = new Map()
  ;(logs || []).forEach((log) => {
    const tier = log.variant_level || 'RX'
    if (!groups.has(tier)) groups.set(tier, [])
    groups.get(tier).push(log)
  })
  return groups
}

// The one canonical score-extraction path for Benchmark History display -
// ported line-for-line from Clasament's own already-correct rendering
// (App.jsx ~1932-1937) and Jurnal's own wSetsScore computation (~5382),
// NOT from the older parseWodLogDetails helper (whose 'N sets' fallback
// for family:'sets' logs is a real, pre-existing display gap - see
// MEMBER_PERFORMANCE_PHASE1_BENCHMARK_HISTORY_IMPLEMENTATION_REPORT.md,
// "Known Limitations" - out of THIS mission's scope to fix in the shared
// helper, since it has a wider blast radius than Benchmark History alone).
export function benchmarkScoreValue(log) {
  const formatId = log.format_snapshot
  const format = formatId ? getFormat(formatId) : null
  if (format?.family === 'sets') {
    return setsDisplayScore(formatId, log.format_config_snapshot, log.sets)
  }
  if (format?.family === 'chained') {
    return log.log_meta?.totalReps ?? null
  }
  return null // scored/mixed/nft carry time_result/result directly (see benchmarkScoreDisplay)
}

export function benchmarkScoreDisplay(log, t) {
  const formatId = log.format_snapshot
  const format = formatId ? getFormat(formatId) : null
  if (format?.family === 'sets') {
    const score = benchmarkScoreValue(log)
    if (score == null) return null
    const weightScored = isWeightScoredSetsFormat(log.format_config_snapshot, formatId)
    return weightScored
      ? `${score}${(log.profile?.weight_unit || 'kg') === 'lbs' ? 'lbs' : 'kg'}`
      : `${score}${t ? ` ${t.clasamentRepsUnit}` : ' reps'}`
  }
  if (format?.family === 'chained') {
    const score = benchmarkScoreValue(log)
    return score != null ? `${score} reps` : null
  }
  return log.time_result || log.result || null
}

// Derives Best / Latest / Previous / History for one benchmark+tier's logs,
// reusing sortSectionLogs (so already correctly capped-vs-completed/zero/
// decimal/tie-safe - see UNIVERSAL_WORKOUT_SCORING_LEADERBOARD_AUDIT.md).
// The comparator's own format/formatConfig is taken from the MOST
// RECENTLY LOGGED entry's frozen snapshot - a deterministic, documented
// choice for the rare case a benchmark's structure genuinely changed
// between occurrences (Adversarial Matrix case #19's own caveat; official
// benchmarks like Fran are structurally invariant in practice).
//
// "Best" = the canonically top-ranked attempt across the whole tier
// history. "Latest" = most recent by date. "Previous" = the attempt
// immediately preceding Latest by date (NOT "second best") - the one
// deterministic rule this module commits to (mission §11/§44): "how did I
// do this time vs. last time", matching every competitor's own
// repeat-comparison framing (see MEMBER_PERFORMANCE_COMPETITIVE_RESEARCH.md).
export function deriveBenchmarkTierSummary(logs) {
  if (!logs || logs.length === 0) return null
  const byDate = [...logs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))
  const latest = byDate[0]
  const previous = byDate.length > 1 ? byDate[1] : null
  const ranked = sortSectionLogs(logs, latest.format_snapshot, latest.format_config_snapshot)
  const best = ranked[0] || null
  return {
    tier: latest.variant_level || 'RX',
    attemptCount: logs.length,
    best,
    latest,
    previous,
    isLatestBest: !!best && !!latest && best.id === latest.id,
    history: byDate,
    change: previous ? deriveChange(previous, latest) : null,
  }
}

// Improvement between two attempts of the SAME tier - direction (better/
// worse/same) is derived by re-using the exact same comparator
// (sortSectionLogs on a 2-element array), never a second ranking
// implementation. A genuine tie is detected by comparing the two entries'
// own display strings (not comparator order, which always breaks ties
// deterministically by logged_at and would otherwise never report "same").
// Numeric magnitude is shown ONLY for score families where a scalar delta
// is unambiguous and non-misleading (TIME: seconds; sets family: reps/kg)
// - for ROUNDS_REPS (AMRAP) and other structured/sequential-partial
// scores, only the direction badge is shown, per the mission's own
// explicit caution against fabricating a misleading percentage/delta for
// structured scores (§12/§13).
function deriveChange(previous, latest) {
  const displayPrev = benchmarkScoreDisplay(previous)
  const displayLatest = benchmarkScoreDisplay(latest)
  if (displayPrev != null && displayPrev === displayLatest) {
    return { direction: 'same', magnitude: null, unit: null }
  }
  const ranked = sortSectionLogs([previous, latest], latest.format_snapshot, latest.format_config_snapshot)
  const direction = ranked[0]?.id === latest.id ? 'better' : 'worse'

  const format = latest.format_snapshot ? getFormat(latest.format_snapshot) : null
  if (format?.family === 'sets' || format?.family === 'chained') {
    const prevVal = benchmarkScoreValue(previous)
    const latestVal = benchmarkScoreValue(latest)
    if (prevVal != null && latestVal != null) {
      const weightScored = format.family === 'sets' && isWeightScoredSetsFormat(latest.format_config_snapshot, latest.format_snapshot)
      return { direction, magnitude: Math.abs(latestVal - prevVal), unit: weightScored ? (latest.profile?.weight_unit || 'kg') : 'reps' }
    }
  } else if (latest.time_result && previous.time_result) {
    const prevSec = parseTimeResult(previous.time_result)
    const latestSec = parseTimeResult(latest.time_result)
    if (!Number.isNaN(prevSec) && !Number.isNaN(latestSec)) {
      return { direction, magnitude: Math.abs(prevSec - latestSec), unit: 'seconds' }
    }
  }
  return { direction, magnitude: null, unit: null }
}

// Top-level: one benchmark's full picture across every tier it's been
// attempted in, keyed by tier - Rx/Scaled/etc. are siblings, never merged.
export function deriveBenchmarkSummary(logs) {
  const byTier = groupLogsByTier(logs)
  const tiers = {}
  for (const [tier, tierLogs] of byTier) {
    tiers[tier] = deriveBenchmarkTierSummary(tierLogs)
  }
  return tiers
}

// Benchmark List (mission §21-23) - one row per benchmark identity the
// member has ever logged against, sorted by most-recently-performed
// (highest member value per the architecture's own IA recommendation),
// with a plain per-tier best precomputed so the list itself never needs a
// second grouping pass in the render layer.
export function buildBenchmarkListEntries(wodLogs, benchmarksById) {
  const byBenchmark = groupLogsByBenchmark(wodLogs)
  const entries = []
  for (const [benchmarkId, logs] of byBenchmark) {
    const meta = benchmarksById.get(benchmarkId)
    const byDate = [...logs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))
    entries.push({
      benchmarkId,
      displayName: meta?.canonical_name || byDate[0].wods?.name || byDate[0].wod_name_snapshot || null,
      category: meta?.category || null,
      attemptCount: logs.length,
      lastPerformedAt: byDate[0].logged_at,
      lastTier: byDate[0].variant_level || 'RX',
    })
  }
  entries.sort((a, b) => new Date(b.lastPerformedAt) - new Date(a.lastPerformedAt))
  return entries
}

// Member Performance, Phase 6 (Performance Overview) - Current Benchmark
// Bests, across EVERY benchmark the member has attempted. Reuses
// deriveBenchmarkSummary (Phase 1) as-is, per tier, for every benchmark -
// no second comparator, no new grouping logic (mission §14/§21: "Reuse
// Phase 1 logic/helpers... Do not reimplement Benchmark comparator").
export function buildCurrentBenchmarkBests(wodLogs, benchmarksById) {
  const byBenchmark = groupLogsByBenchmark(wodLogs)
  const bests = []
  for (const [benchmarkId, logs] of byBenchmark) {
    const summaryByTier = deriveBenchmarkSummary(logs)
    const meta = benchmarksById.get(benchmarkId)
    for (const [tier, summary] of Object.entries(summaryByTier)) {
      if (!summary?.best) continue
      bests.push({
        benchmarkId,
        displayName: meta?.canonical_name || summary.best.wods?.name || summary.best.wod_name_snapshot || null,
        tier,
        best: summary.best,
      })
    }
  }
  bests.sort((a, b) => new Date(b.best.logged_at) - new Date(a.best.logged_at))
  return bests
}

// Recent Benchmark Progress (mission §29-30) - only benchmark+tier streams
// where the LATEST attempt is genuinely better than the PREVIOUS one, per
// the canonical comparator (reused, not reimplemented). A worsened repeat
// is deliberately excluded here, not mislabeled as progress (mission
// §61's own explicit caution) - it remains visible in Benchmark History.
// One-attempt benchmarks are excluded (mission §31 - no previous to
// compare against).
export function buildRecentBenchmarkProgress(wodLogs, benchmarksById) {
  const byBenchmark = groupLogsByBenchmark(wodLogs)
  const progress = []
  for (const [benchmarkId, logs] of byBenchmark) {
    const summaryByTier = deriveBenchmarkSummary(logs)
    const meta = benchmarksById.get(benchmarkId)
    for (const [tier, summary] of Object.entries(summaryByTier)) {
      if (!summary?.previous || !summary.change || summary.change.direction !== 'better') continue
      progress.push({
        benchmarkId,
        displayName: meta?.canonical_name || summary.latest.wods?.name || summary.latest.wod_name_snapshot || null,
        tier,
        latest: summary.latest,
        previous: summary.previous,
        change: summary.change,
      })
    }
  }
  progress.sort((a, b) => new Date(b.latest.logged_at) - new Date(a.latest.logged_at))
  return progress
}
