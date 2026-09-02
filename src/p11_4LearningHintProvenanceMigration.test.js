// P11.4 — structural assertions on the learning-hint provenance migration.
// Guards: additive (P11.1 frozen), append-only companion table, RLS, tenant
// guard on measurement, no embeddings/vector, service_role can call the P11.3
// engine (and only it gains that grant).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', 'supabase', 'migrations', '20260902120000_p11_4_learning_hint_provenance.sql'), 'utf8')
const lc = sql.toLowerCase()
const body = lc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const code = body.replace(/comment on[\s\S]*?';/g, '')

describe('P11.4 migration — additive; P11.1 / P11.2 / canonical frozen', () => {
  it('creates exactly one table: ai_analysis_run_learning', () => {
    expect([...code.matchAll(/create\s+table\s+(public\.)?(\w+)/g)].map((m) => m[2])).toEqual(['ai_analysis_run_learning'])
  })
  it('does NOT ALTER / DROP ai_analysis_runs, ai_correction_evidence or any canonical table', () => {
    for (const t of ['ai_analysis_runs', 'ai_correction_evidence', 'wods', 'workouts', 'workout_sections', 'wod_logs']) {
      expect(code).not.toMatch(new RegExp(`alter\\s+table\\s+(public\\.)?${t}\\b`))
      expect(code).not.toMatch(new RegExp(`drop\\s+table\\s+(public\\.)?${t}\\b`))
    }
  })
  it('does NOT add a column to ai_analysis_runs (D2 = companion table, not extend)', () => {
    expect(code).not.toMatch(/alter\s+table\s+(public\.)?ai_analysis_runs\s+add/)
  })
  it('has a reversibility (DOWN) section + kill-switch note', () => {
    expect(lc).toContain('reversibility')
    expect(lc).toContain('drop table if exists public.ai_analysis_run_learning')
    expect(lc).toContain('p11_learning_hints_mode=off')
  })
})

describe('P11.4 migration — companion ledger shape', () => {
  it('PK is ai_run_id (1:1) with FK to ai_analysis_runs, ON DELETE CASCADE', () => {
    expect(code).toMatch(/ai_run_id\s+uuid\s+primary key\s+references public\.ai_analysis_runs\(id\)\s+on delete cascade/)
  })
  it('learning_mode is a 3-value CHECK', () => {
    expect(code).toMatch(/learning_mode\s+text not null check \(learning_mode in \('off','shadow','active'\)\)/)
  })
  it('retrieval_status is a bounded CHECK enum (§19)', () => {
    expect(code).toMatch(/retrieval_status\s+text not null check \(retrieval_status in \([^)]*'retrieval_failed'\)\)/)
  })
  it('records selector + serializer + read-model + prompt versions', () => {
    for (const c of ['selector_version', 'serializer_version', 'read_model_version', 'prompt_version']) {
      expect(code).toContain(`${c} `)
    }
  })
  it('records selected hint facts + audit fingerprint, not full prompt', () => {
    expect(code).toContain('selected_hints        jsonb')
    expect(code).toContain('prompt_fragment_sha256')
    expect(code).not.toMatch(/prompt_fragment_text|full_prompt|system_prompt\s+text/)
  })
})

describe('P11.4 migration — append-only + RLS', () => {
  it('BEFORE UPDATE immutability trigger (UPDATE-only, never blocks cascade)', () => {
    expect(code).toContain('create trigger ai_analysis_run_learning_immutability')
    expect(code).toMatch(/before update on public\.ai_analysis_run_learning/)
    expect(code).toContain('ai_analysis_run_learning is append-only')
    expect(code).not.toMatch(/before\s+(update\s+or\s+)?delete\s+on\s+public\.ai_analysis_run_learning/)
  })
  it('RLS on; SELECT coach/admin of gym; no client INSERT/UPDATE; no DELETE policy', () => {
    expect(code).toContain('alter table public.ai_analysis_run_learning enable row level security')
    expect(code).toMatch(/policy ai_analysis_run_learning_select[\s\S]*?for select to authenticated[\s\S]*?is_coach_or_admin\(gym_id\)/)
    expect(code).toMatch(/policy ai_analysis_run_learning_no_client_insert[\s\S]*?with check \(false\)/)
    expect(code).toMatch(/policy ai_analysis_run_learning_no_client_update[\s\S]*?using \(false\)/)
    expect(code).not.toMatch(/policy \w+ on public\.ai_analysis_run_learning\s+for delete/)
  })
})

describe('P11.4 migration — measurement + engine grant', () => {
  it('p11_learning_effect_stats is tenant-guarded, read-only, by learning_mode', () => {
    expect(code).toContain('create or replace function public.p11_learning_effect_stats')
    expect(code).toContain('if not public.is_coach_or_admin(p_gym_id) then')
    expect(code).toContain("'bymode'")
    expect(code).toContain('semantic_acceptance_rate')
  })
  it('explicitly disclaims a causal AI-improvement claim (§56)', () => {
    expect(code).toMatch(/not a causal ai-improvement/i)
  })
  it('measurement never writes (SELECT only)', () => {
    const fn = body.slice(body.indexOf('p11_learning_effect_stats'))
    expect(fn).not.toMatch(/\binsert\s+into\b|\bupdate\s+public|\bdelete\s+from\b/)
  })
  it('grants EXECUTE on the P11.3 engine ONLY to service_role (still no client grant)', () => {
    expect(code).toMatch(/grant execute on function public\.p11_3_retrieve_impl\([\s\S]*?\) to service_role/)
    expect(code).not.toMatch(/grant execute on function public\.p11_3_retrieve_impl\([\s\S]*?\) to (anon|authenticated|public)\b/)
  })
})

describe('P11.4 migration — no retrieval-boundary crossing', () => {
  it('no embeddings / pgvector / vector search', () => {
    expect(code).not.toMatch(/create\s+extension[^;]*vector|vector\s*\(|::vector|ivfflat|hnsw|<->|embedding\s+(vector|jsonb|text)/)
  })
  it('no OpenAI / HTTP wiring in the migration', () => {
    expect(code).not.toMatch(/openai|net\.http|pg_net|http_post|extensions\.http/)
  })
  it('no member-log source', () => {
    expect(code).not.toMatch(/\bwod_logs\b|\bskill_logs\b|\bleaderboard/)
  })
})
