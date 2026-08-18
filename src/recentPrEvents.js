// Member Performance, Phase 6 (Performance Overview) - Recent PRs.
//
// CRITICAL DISTINCTION from Current Bests (movementHistory.js/
// benchmarkHistory.js): Current Bests are derived from authoritative
// Results directly, ignoring `pr_events` entirely. Recent PRs is the
// other, genuinely different concept - "which valid ledger EVENTS
// happened recently" - and legitimately reads `pr_events` (Phase 5's own
// hardened ledger), but must not trust every unvoided row blindly.
//
// Phase 5's own report disclosed Caveat A: 5 real production pr_events
// rows are semantically invalid under the CURRENT (Phase 3) comparison-
// identity contract (all format_snapshot='Weightlifting', always UNKNOWN,
// never legitimately PR-comparable) - created before this contract was
// enforced, deliberately left unvoided/un-mutated (no historical
// guessing). This module is the read-side filter that keeps them from
// ever reaching the UI: for every movement-type event, its SOURCE
// Result's format_snapshot/format_config_snapshot is looked up and
// re-run through the exact same resolveComparisonIdentity resolver Phase
// 3 already proved correct - not a second, hand-rolled "is this legit"
// heuristic. An event whose source can no longer be found (deleted, or
// simply outside the caller's already-loaded Result set) is excluded,
// never assumed valid.
//
// Benchmark-type events are NOT re-validated against comparison identity
// (Phase 3 already found Benchmark Identity strong, and Phase 5 did not
// change benchmark eligibility) - only the existence of a live source is
// checked, mirroring the movement path's own conservative default.

import { resolveComparisonIdentity } from './movementHistory'

function findSource(event, wodLogsById, skillLogsById) {
  if (event.source_wod_log_id) return wodLogsById.get(event.source_wod_log_id) || null
  if (event.source_skill_log_id) return skillLogsById.get(event.source_skill_log_id) || null
  return null
}

// `wodLogsById`/`skillLogsById` are plain Maps keyed by id, built by the
// caller from Results it has ALREADY loaded (WOD-SIMPLE's own wodLogs/
// skillLogs member state is unbounded/unfiltered - see App.jsx's
// fetchWodLogs/fetchSkillLogs - so no new query is needed here beyond
// fetching pr_events itself).
export function filterValidRecentPrEvents(prEvents, wodLogsById, skillLogsById) {
  return (prEvents || []).filter((event) => {
    if (event.voided_at) return false
    const source = findSource(event, wodLogsById, skillLogsById)
    if (!source) return false
    if (event.pr_type === 'benchmark') return true
    const identity = resolveComparisonIdentity({
      formatSnapshot: source.format_snapshot,
      formatConfigSnapshot: source.format_config_snapshot,
    })
    return identity.comparable
  })
}

// Newest athletic occurrence first (mission §17/§66) - `occurred_at` is
// the source Result's own `logged_at` (Slice 3's own design), never the
// ledger row's insertion timestamp, so a backdated Result correctly
// sorts by when it was actually performed, not when it was entered.
export function sortRecentPrEvents(events) {
  return [...(events || [])].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
}
