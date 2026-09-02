// P11.5 — structural assertions on the learning-calibration migration.
// Guards: read-only, no new table/index, no threshold weakening, ACTIVE-
// eligibility parity with the P11.4 selector, tenant-guarded, reuses the
// P11.3 engine (no fourth truth), no mode change.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', 'supabase', 'migrations', '20260902130000_p11_5_learning_calibration.sql'), 'utf8')
const lc = sql.toLowerCase()
const body = lc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const code = body.replace(/comment on[\s\S]*?';/g, '')

describe('P11.5 migration — additive, read-only, no new persistence', () => {
  it('creates NO table / index / trigger / policy; alters nothing', () => {
    expect(code).not.toMatch(/create\s+table/)
    expect(code).not.toMatch(/create\s+(unique\s+)?index/)
    expect(code).not.toMatch(/create\s+trigger/)
    expect(code).not.toMatch(/create\s+policy/)
    expect(code).not.toMatch(/alter\s+table/)
  })
  it('writes to NO table', () => {
    expect(code).not.toMatch(/\binsert\s+into\b/)
    expect(code).not.toMatch(/\bupdate\s+public\.\w+\s+set\b/)
    expect(code).not.toMatch(/\bdelete\s+from\b/)
  })
  it('creates exactly one function: p11_learning_calibration_status', () => {
    expect([...code.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)/g)].map((m) => m[1]))
      .toEqual(['p11_learning_calibration_status'])
  })
  it('has a reversibility (DOWN) note', () => {
    expect(lc).toContain('reversibility')
    expect(lc).toContain('drop function if exists public.p11_learning_calibration_status')
  })
  it('only reads P11.1-P11.4 tables', () => {
    const froms = [...body.matchAll(/\b(?:from|join)\s+public\.(\w+)/g)].map((m) => m[1])
      .filter((t) => !t.endsWith('_status') && !t.startsWith('p11_'))
    expect(new Set(froms)).toEqual(new Set(['ai_analysis_runs', 'ai_correction_evidence', 'ai_analysis_run_learning']))
  })
})

describe('P11.5 migration — ACTIVE-eligibility parity with p11.4-selector-v1 (§11/§12/§71)', () => {
  it('declares parity explicitly and reuses the P11.3 engine (no fourth truth)', () => {
    expect(code).toContain("c_selector_version constant text := 'p11.4-selector-v1'")
    expect(code).toContain('p11_3_retrieve_impl(')
    expect(lc).toContain('byte-identical to learninghints.ts')  // parity note (in a -- comment)
  })
  it('active_eligible = supported AND CONSISTENT AND >=3 AND exact-only AND allowlist', () => {
    expect(code).toMatch(/strength = 'supported'\s*\n\s*and conflict_state = 'consistent'\s*\n\s*and distinct_run_count >= 3\s*\n\s*and strong_ctx = 0\s*\n\s*and broad_ctx = 0\s*\n\s*and exact_ctx >= 1\s*\n\s*and taxonomy = any \(c_active_allowlist\)/)
  })
  it('ACTIVE allowlist is LOAD / VARIANT_COMPLETION / STRUCTURE only', () => {
    expect(code).toMatch(/c_active_allowlist constant text\[\] := array\['load','variant_completion','structure'\]/)
  })
  it('STRUCTURE patterns are flagged as needing explicit pre-model structure', () => {
    expect(code).toContain('requires_explicit_structure_pre_model')
  })
})

describe('P11.5 migration — no threshold drift (§45/§82)', () => {
  it('does NOT lower the 3-run / supported / CONSISTENT / exact-only bar', () => {
    expect(code).not.toMatch(/distinct_run_count >= [12]\b/)
    expect(code).not.toMatch(/strength = 'weak'.*active/)
    expect(code).not.toMatch(/conflict_state = 'mixed'.*active_eligible/)
  })
  it('rolloutGate reports thresholdUnchanged: true', () => {
    expect(code).toContain("'thresholdunchanged', true")
  })
  it('the rollout verdict never auto-activates — it can only say REMAIN_SHADOW or OWNER_APPROVAL_REQUIRED', () => {
    expect(code).toContain('remain_shadow_waiting_for_natural_evidence')
    expect(code).toContain('active_candidate_ready_owner_approval_required')
    expect(code).not.toMatch(/set .*p11_learning_hints_mode|secrets set|learning_mode\s*=\s*'active'/)
  })
})

describe('P11.5 migration — funnel + burden semantics (§7/§16/§17)', () => {
  it('correction burden counts only semantic|critical deltas from the frozen semantic_diff', () => {
    expect(code).toMatch(/d->>'severity' in \('semantic','critical'\)/)
    expect(code).toContain("coalesce(r.semantic_diff->'deltas'")
  })
  it('distance_to_supported = greatest(0, 3 - distinct_run_count); conflict flagged separately', () => {
    expect(code).toContain('greatest(0, 3 - distinct_run_count)')
    expect(code).toMatch(/\(conflict_state = 'conflicting'\)\s*\n?\s*as blocked_by_conflict/)
  })
  it('learningEffect is version-aware (exposes promptVersions per mode)', () => {
    expect(code).toContain("'promptversions'")
  })
  it('exposes the pre-model-retrievable vs blocked split for the two-pass decision (§53)', () => {
    expect(code).toContain("'singlepassretrievable'")
    expect(code).toContain("'blockedneedsstructureorposition'")
  })
})

describe('P11.5 migration — security + tenant isolation', () => {
  it('tenant-guarded; REVOKEd from anon; GRANTed to authenticated', () => {
    expect(code).toContain('if not public.is_coach_or_admin(p_gym_id) then')
    expect(code).toMatch(/revoke all on function public\.p11_learning_calibration_status\([\s\S]*?\) from public, anon/)
    expect(code).toMatch(/grant execute on function public\.p11_learning_calibration_status\([\s\S]*?\) to authenticated/)
  })
  it('every source query is gym-scoped', () => {
    expect(code).toMatch(/where r\.gym_id = p_gym_id/)
    expect(code).toMatch(/where\s+gym_id = p_gym_id/)
  })
  it('no member-data source', () => {
    expect(code).not.toMatch(/\bwod_logs\b|\bskill_logs\b|\bleaderboard|members\b/)
  })
})

describe('P11.5 migration — no retrieval-boundary crossing', () => {
  it('no embeddings / vector / OpenAI wiring (a descriptive "two-pass" note is allowed)', () => {
    expect(code).not.toMatch(/vector\s*\(|::vector|\bembedding\b|ivfflat|hnsw|api\.openai|net\.http|pg_net/)
    // the ONLY "two-pass" mention is the §53 decision-input note, never a call
    expect(code).not.toMatch(/perform\s+.*two.?pass|call\s+.*second.?pass/)
  })
})
