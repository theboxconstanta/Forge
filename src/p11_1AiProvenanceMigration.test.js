// P11.1 — structural assertions on the provenance migration. No live DB in this
// repo's test infra; this guards the invariants that matter most: the migration
// is ADDITIVE (touches no canonical workout table), RLS is on, the immutability
// trigger + retention + metric function exist, and cross-tenant / anon access
// is denied by construction.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', 'supabase', 'migrations', '20260902090000_p11_1_ai_analysis_provenance.sql'), 'utf8')
const lc = sql.toLowerCase()

describe('P11.1 migration — additive, no canonical-table change (owner decision D1)', () => {
  it('does NOT ALTER / DROP any canonical workout table', () => {
    for (const t of ['wods', 'wod_logs', 'workouts', 'workout_sections', 'skill_logs', 'profiles', 'members']) {
      expect(lc).not.toMatch(new RegExp(`alter\\s+table\\s+(public\\.)?${t}\\b`))
      expect(lc).not.toMatch(new RegExp(`drop\\s+table\\s+(public\\.)?${t}\\b`))
    }
  })
  it('does NOT add an AI-source column anywhere', () => {
    expect(lc).not.toMatch(/add\s+column\s+.*ai_run_id/)
    expect(lc).not.toMatch(/add\s+column\s+.*\bsource\b/)
  })
  it('creates exactly one new table: ai_analysis_runs', () => {
    const creates = [...lc.matchAll(/create\s+table\s+(public\.)?(\w+)/g)].map((m) => m[2])
    expect(creates).toEqual(['ai_analysis_runs'])
  })
  it('has a reversibility (DOWN) section', () => {
    expect(lc).toContain('reversibility')
    expect(lc).toContain('drop table if exists public.ai_analysis_runs')
  })
})

describe('P11.1 migration — RLS + tenant isolation', () => {
  it('enables RLS on the ledger', () => {
    expect(lc).toContain('alter table public.ai_analysis_runs enable row level security')
  })
  it('SELECT is coach/admin of the run gym only', () => {
    expect(lc).toMatch(/policy ai_analysis_runs_select[\s\S]*?for select to authenticated[\s\S]*?is_coach_or_admin\(gym_id\)/)
  })
  it('clients can NEVER insert (with check false) — only the service-role EF', () => {
    expect(lc).toMatch(/policy ai_analysis_runs_no_client_insert[\s\S]*?for insert to authenticated[\s\S]*?with check \(false\)/)
  })
  it('UPDATE is gym-scoped (my_gym_id + is_coach_or_admin)', () => {
    expect(lc).toMatch(/policy ai_analysis_runs_lifecycle_update[\s\S]*?gym_id = public\.my_gym_id\(\)[\s\S]*?is_coach_or_admin\(gym_id\)/)
  })
  it('no DELETE policy => deletes denied for every client', () => {
    expect(lc).not.toMatch(/policy \w+ on public\.ai_analysis_runs\s+for delete/)
  })
})

describe('P11.1 migration — immutability + lifecycle-once', () => {
  it('BEFORE UPDATE trigger + function', () => {
    expect(lc).toContain('create or replace function public.enforce_ai_analysis_run_immutability()')
    expect(lc).toContain('before update on public.ai_analysis_runs')
  })
  it('evidence columns are write-once (raises)', () => {
    expect(lc).toContain('model/version/output evidence is write-once')
  })
  it('retention transitions are the only allowed evidence change (input_text/raw_output -> null)', () => {
    expect(lc).toContain('only retention may null it')
  })
  it('lifecycle is fill-once once saved_at is set', () => {
    expect(lc).toContain('lifecycle is fill-once')
    expect(lc).toContain('if old.saved_at is not null then')
  })
  it('gym_id is immutable', () => {
    expect(lc).toContain('ai_analysis_runs.gym_id is immutable')
  })
})

describe('P11.1 migration — retention (D4) + metric', () => {
  it('90-day input_text expiry + 365-day raw_output expiry functions', () => {
    expect(lc).toContain("input_text = null")
    expect(lc).toContain("interval '90 days'")
    expect(lc).toContain("raw_output = null")
    expect(lc).toContain("interval '365 days'")
  })
  it('scheduled via pg_cron (same shape as existing daily crons)', () => {
    expect(lc).toContain("cron.schedule(")
    expect(lc).toContain('p11-expire-ai-input-text-daily')
    expect(lc).toContain('p11-expire-ai-raw-output-daily')
  })
  it('retention keeps run id / versions / normalized_output / diff / outcome', () => {
    // it only ever nulls input_text and raw_output
    const nulls = [...lc.matchAll(/set\s+(\w+)\s*=\s*null/g)].map((m) => m[1])
    expect(new Set(nulls)).toEqual(new Set(['input_text', 'raw_output']))
  })
  it('acceptance-rate metric function is tenant-guarded', () => {
    expect(lc).toContain('create or replace function public.p11_ai_acceptance_stats')
    expect(lc).toContain('if not public.is_coach_or_admin(p_gym_id) then')
    expect(lc).toContain('semantic_acceptance_rate')
  })
  it('metric: abandoned reported separately, not counted as a semantic failure', () => {
    // numerator = accepted_unchanged + accepted_cosmetic; abandoned is its own column
    expect(sql).toMatch(/accepted_unchanged','accepted_cosmetic'\)\)::numeric/)
    expect(lc).toContain("outcome = 'abandoned' and saved_at is null)   as abandoned")
  })
})

describe('P11.1 migration — no embeddings / vector / fine-tuning', () => {
  it('no pgvector / embedding column / vector index (own header disclaimer aside)', () => {
    const body = lc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(body).not.toMatch(/\bvector\s*\(|create\s+extension[^;]*vector|ivfflat|hnsw|embedding\s+(?:column|vector|jsonb|text)/)
  })
})
