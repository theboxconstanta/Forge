import { supabase } from './supabase'
import { secToTime } from './utils'

// Client wrapper around performance_progression_summary (Results Phase 2
// Slice 4, migration 20260813100300) - mirrors forge-admin-web's own
// src/features/results/api.ts fetchProgressionForMember exactly (same
// contract). No shared package between the two repos (RESULTS_PHASE1_
// IMPLEMENTATION_REPORT.md Section 9), so this is ported, not imported -
// but the actual progression/trend computation lives once, in the
// database views, not duplicated here.

// Keyed by performance_identity_id, so a caller (JurnalList) can look up
// the relevant row per logged entry via w.performance_identity_id.
export async function fetchProgressionForMember(gymId, memberId) {
  const result = new Map()
  const { data, error } = await supabase
    .from('performance_progression_summary')
    .select('*')
    .eq('gym_id', gymId)
    .eq('member_id', memberId)
  if (error) throw error
  for (const row of data || []) result.set(row.performance_identity_id, row)
  return result
}

function formatResultValue(value, unit) {
  if (value == null || unit == null) return null
  return unit === 'seconds' ? secToTime(value) : `${value} runde`
}

// Pure, testable in isolation - the single line JurnalList renders under
// a logged entry that resolved to a repeated Performance Identity with a
// prior attempt to compare against. Returns null when there's nothing
// meaningful to show (first-ever attempt, or an unscored repeat format -
// Slice 4's own disclosed For Time/AMRAP-only quantitative scope).
export function formatProgressionNote(row) {
  if (!row || row.trend === 'insufficient_data' || row.total_attempts < 2) return null
  const previous = formatResultValue(row.previous_result_value, row.previous_result_unit)
  if (!previous) return null
  const pctChange = row.pct_change_since_previous
  const suffix = row.current_is_pr
    ? ' · PR nou'
    : pctChange != null
      ? ` · ${pctChange > 0 ? '▲' : '▼'} ${Math.abs(Math.round(pctChange))}%`
      : ''
  return `vs data trecuta (${previous})${suffix}`
}
