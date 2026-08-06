import { supabase } from './supabase'

// Results Phase 2 Slice 5 - Analytics Foundation. Mirrors forge-admin-web's
// own src/features/results/analytics.ts contract exactly (same views, same
// field names) - every number here comes from a single Postgres view
// (athlete_performance_summary/movement_progress_summary), never computed
// client-side, so the PWA and Admin always show the identical figure for
// the same underlying data.

/** getAthletePerformanceSummary(memberId) - the canonical per-athlete analytics object, the primary analytics source for the PWA. */
export async function getAthletePerformanceSummary(gymId, memberId) {
  const { data, error } = await supabase
    .from('athlete_performance_summary')
    .select('*')
    .eq('gym_id', gymId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** getMovementProgressSummary(memberId) - one member's own movement PR-frequency trends. */
export async function getMovementProgressSummary(gymId, memberId) {
  const { data, error } = await supabase
    .from('movement_progress_summary')
    .select('*')
    .eq('gym_id', gymId)
    .eq('member_id', memberId)
  if (error) throw error
  return data || []
}

const TREND_LABEL_RO = {
  rapidly_improving: 'Progres rapid',
  improving: 'In progres',
  stable: 'Stabil',
  plateau: 'Platou',
  declining: 'In scadere',
  insufficient_data: 'Date insuficiente',
}

export function formatTrendLabel(trend) {
  return TREND_LABEL_RO[trend] || null
}
