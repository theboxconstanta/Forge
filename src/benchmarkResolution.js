import { supabase } from './supabase'

// Client wrapper around the canonical resolve_benchmark_names Postgres
// function (migration 20260811090100, RESULTS_PHASE2_IMPLEMENTATION_PLAN.md
// Slice 1) - mirrors forge-admin-web's src/features/results/
// benchmarkResolution.ts exactly (same contract, same behavior). The two
// repos have no shared package (RESULTS_PHASE1_IMPLEMENTATION_REPORT.md
// Section 9), so this thin wrapper is ported, not imported - but unlike
// Phase 1's ranking/formatting ports, almost nothing is duplicated here:
// the actual resolution algorithm (normalization, alias matching) lives
// once, in the database function itself, not in either client.
//
// Batched (one round trip per distinct name, not one per row) - the same
// reasoning the SQL function's own design already committed to.

// Keyed by the exact, original (un-normalized) input string, so callers
// can look up with whatever raw name they already have. Unresolved names
// are simply absent from the returned Map.
export async function resolveBenchmarkNames(names) {
  const distinct = [...new Set((names || []).filter((n) => n && n.trim()))]
  const result = new Map()
  if (distinct.length === 0) return result

  const { data, error } = await supabase.rpc('resolve_benchmark_names', { p_names: distinct })
  if (error) throw error

  for (const row of data || []) {
    if (!row.benchmark_id) continue
    result.set(row.input_name, {
      benchmarkId: row.benchmark_id,
      canonicalName: row.canonical_name,
      category: row.category,
      isPlatform: row.is_platform,
    })
  }
  return result
}

// Member Performance, Phase 1 (Benchmark History) - looks up display
// metadata (canonical_name/category) for a set of already-known
// benchmark_id UUIDs, e.g. the distinct wod_logs.benchmark_id values a
// member has logged against. Deliberately separate from
// resolveBenchmarkNames above (that one resolves NAME -> id; this one
// resolves id -> display metadata) - callers that already have the id
// directly on a log row (server-resolved at logging time, see
// snapshot_wod_log_context) should never need to re-resolve by name.
// Keyed by benchmark_id (string) so callers can Map.get(log.benchmark_id)
// directly.
export async function getBenchmarksByIds(ids) {
  const distinct = [...new Set((ids || []).filter(Boolean))]
  const result = new Map()
  if (distinct.length === 0) return result
  const { data, error } = await supabase.from('benchmarks').select('id, canonical_name, category').in('id', distinct)
  if (error) throw error
  for (const row of data || []) {
    result.set(row.id, { canonical_name: row.canonical_name, category: row.category })
  }
  return result
}
