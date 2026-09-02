// P11.2 — structural assertions on the coach-correction learning-evidence
// migration. No live DB in this repo's test infra; this guards the invariants
// that matter most: additive (no canonical table touched), append-only, RLS on,
// tenant-safe, deterministic/versioned/idempotent extraction, REST-never-a-
// movement, no embeddings, and the owner decisions D1=A / D2=A / D3=B.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', 'supabase', 'migrations', '20260902100000_p11_2_ai_correction_evidence.sql'), 'utf8')
const lc = sql.toLowerCase()
const body = lc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('P11.2 migration — additive, no canonical-table change', () => {
  it('does NOT ALTER / DROP any canonical workout table', () => {
    for (const t of ['wods', 'wod_logs', 'workouts', 'workout_sections', 'skill_logs', 'profiles', 'members', 'personal_records', 'pr_events']) {
      expect(body).not.toMatch(new RegExp(`alter\\s+table\\s+(public\\.)?${t}\\b`))
      expect(body).not.toMatch(new RegExp(`drop\\s+table\\s+(public\\.)?${t}\\b`))
    }
  })
  it('creates exactly one new table: ai_correction_evidence', () => {
    const creates = [...body.matchAll(/create\s+table\s+(public\.)?(\w+)/g)].map((m) => m[2])
    expect(creates).toEqual(['ai_correction_evidence'])
  })
  it('the only trigger added to ai_analysis_runs is AFTER UPDATE (never BEFORE, never blocking)', () => {
    expect(body).toMatch(/create\s+trigger\s+ai_analysis_runs_extract_evidence\s+after\s+update\s+on\s+public\.ai_analysis_runs/)
    expect(body).not.toMatch(/before\s+(update|insert|delete)\s+on\s+public\.ai_analysis_runs/)
  })
  it('has a reversibility (DOWN) section + kill switch', () => {
    expect(lc).toContain('reversibility')
    expect(lc).toContain('drop table if exists public.ai_correction_evidence')
    expect(lc).toContain('kill switch')
  })
  it('does not read wod_logs / skill_logs / leaderboards / member data anywhere', () => {
    expect(body).not.toMatch(/\bwod_logs\b/)
    expect(body).not.toMatch(/\bskill_logs\b/)
    expect(body).not.toMatch(/\bleaderboard/)
    expect(body).not.toMatch(/\bpersonal_records\b/)
  })
})

describe('P11.2 migration — evidence model (D1=A: materialized, append-only)', () => {
  it('one row = one semantic unit, addressed by a deterministic run-relative path', () => {
    expect(body).toContain('correction_path     text not null')
    expect(body).toMatch(/unique\s*\(ai_run_id,\s*correction_path,\s*extractor_version\)/)
  })
  it('extractor_version is stamped on every row and is a pinned constant', () => {
    expect(body).toContain('extractor_version   text not null')
    expect(body).toMatch(/c_extractor\s+constant\s+text\s*:=\s*'p11\.2-correction-extractor-v1'/)
  })
  it('append-only: BEFORE UPDATE immutability trigger, no client INSERT/UPDATE, no DELETE policy', () => {
    expect(body).toContain('create trigger ai_correction_evidence_immutability')
    expect(body).toMatch(/before update on public\.ai_correction_evidence/)
    expect(body).toContain('ai_correction_evidence is append-only')
    expect(body).toMatch(/policy ai_correction_evidence_no_client_insert[\s\S]*?with check \(false\)/)
    expect(body).toMatch(/policy ai_correction_evidence_no_client_update[\s\S]*?using \(false\)/)
    expect(body).not.toMatch(/policy \w+ on public\.ai_correction_evidence\s+for delete/)
  })
  it('immutability trigger is UPDATE-only (must never block an ON DELETE CASCADE)', () => {
    expect(body).not.toMatch(/before\s+(update\s+or\s+)?delete\s+on\s+public\.ai_correction_evidence/)
  })
})

describe('P11.2 migration — extractor is deterministic / idempotent / fail-open', () => {
  it('replayable SECURITY DEFINER function keyed by run id', () => {
    expect(body).toContain('create or replace function public.p11_extract_correction_evidence(p_run_id uuid)')
    expect(body).toMatch(/p11_extract_correction_evidence[\s\S]*?security definer/)
  })
  it('source is ONLY the frozen P11.1 evidence — no current-WOD read', () => {
    expect(body).toContain('v_run.normalized_output')
    expect(body).toContain('v_run.saved_output')
    expect(body).toContain("v_run.semantic_diff->'deltas'")
    // never selects the live wods row
    expect(body).not.toMatch(/from\s+(public\.)?wods\b/)
  })
  it('eligibility gate: status ok + both snapshots + linked wod + accepted outcome', () => {
    expect(body).toContain("v_run.status <> 'ok'")
    expect(body).toContain('v_run.wod_id is null')
    expect(body).toMatch(/outcome not in \('accepted_unchanged','accepted_cosmetic','accepted_semantic'\)/)
  })
  it('idempotent via ON CONFLICT DO NOTHING on the replay key', () => {
    expect(body).toMatch(/on conflict \(ai_run_id, correction_path, extractor_version\) do nothing/)
  })
  it('trigger fires exactly once on saved_at NULL -> NOT NULL and is fail-open', () => {
    expect(body).toMatch(/old\.saved_at is null and new\.saved_at is not null/)
    expect(body).toMatch(/exception when others then[\s\S]*?raise warning 'p11_extract_correction_evidence failed/)
  })
  it('no automatic historical backfill in the migration body', () => {
    // the migration must not loop over existing ai_analysis_runs
    expect(body).not.toMatch(/from\s+public\.ai_analysis_runs\s+where\s+saved_at\s+is\s+not\s+null/)
    expect(body).not.toMatch(/perform\s+public\.p11_extract_correction_evidence\(.*\)\s+from/)
  })
})

describe('P11.2 migration — invariants honoured', () => {
  it('REST is timing, never a movement (CHECK forbids movement id/name on REST_TIME)', () => {
    expect(body).toContain('ai_correction_evidence_rest_not_a_movement')
    expect(body).toMatch(/taxonomy_kind <> 'rest_time' or \(movement_id is null and movement_name is null\)/)
  })
  it('reps is its own taxonomy kind, never folded into LOAD', () => {
    expect(body).toMatch(/when 'reps_changed'\s+then 'reps'/)
    expect(body).toMatch(/when 'reps_changed'\s+then 'reps'/) // field
  })
  it('canonical variants are exactly rx / intermediate / beginner / onramp — never "scaled"', () => {
    expect(body).toMatch(/variant\s+text check \(variant in \('rx','intermediate','beginner','onramp'\)\)/)
    expect(body).not.toMatch(/'scaled'/)
  })
  it('gender is a dimension (universal/male/female/sex_specific), never a variant', () => {
    expect(body).toMatch(/gender_dimension\s+text check \(gender_dimension in \('universal','male','female','sex_specific'\)\)/)
  })
  it('cosmetic deltas produce zero rows (title / note / rename skipped)', () => {
    expect(body).toMatch(/if v_kind in \('title_changed','note_changed','movement_renamed'\) then\s*continue/)
  })
  it('movement_reordered with a repeated movement -> AMBIGUOUS / ambiguous', () => {
    expect(body).toContain("v_reliab := 'ambiguous'; v_elig := 'ambiguous'")
  })
})

describe('P11.2 migration — D2 (coach_completion) is a distinct concept', () => {
  it('evidence_type enum separates correction from coach_completion', () => {
    expect(body).toMatch(/evidence_type\s+text not null check \(evidence_type in \('correction', 'coach_completion'\)\)/)
  })
  it('whole omitted variant tier -> VARIANT_COMPLETION coach_completion', () => {
    expect(body).toContain("'coach_completion', 'variant_completion'")
    expect(body).toMatch(/foreach v_vk in array array\['intermediate','beginner','onramp'\]/)
  })
  it('field-level: a metric delta whose FROM side is null -> PRESCRIPTION_COMPLETION coach_completion', () => {
    expect(body).toMatch(/when fp_val is null then 'coach_completion'/)
    expect(body).toMatch(/when fp_val is null then 'prescription_completion'/)
    expect(body).toMatch(/when fp_male is null then 'coach_completion'/)
    expect(body).toMatch(/when fp_female is null then 'coach_completion'/)
  })
})

describe('P11.2 migration — RLS + tenant isolation', () => {
  it('enables RLS', () => {
    expect(body).toContain('alter table public.ai_correction_evidence enable row level security')
  })
  it('SELECT is coach/admin of the evidence gym only; anon + member denied', () => {
    expect(body).toMatch(/policy ai_correction_evidence_select[\s\S]*?for select to authenticated[\s\S]*?is_coach_or_admin\(gym_id\)/)
  })
  it('gym_id is inherited from the trusted run, never client-supplied', () => {
    expect(body).toContain('p_run.gym_id')
    // the emit helper takes the run row and copies gym_id from it
    expect(body).toMatch(/insert into public\.ai_correction_evidence[\s\S]*?p_run\.gym_id/)
  })
})

describe('P11.2 migration — stats are read-only + tenant-guarded + honest denominators', () => {
  it('tenant guard raises for a non-coach', () => {
    expect(body).toContain('create or replace function public.p11_correction_evidence_stats')
    expect(body).toContain('if not public.is_coach_or_admin(p_gym_id) then')
  })
  it('run-level denominator is reported separately from evidence-row counts', () => {
    expect(body).toContain("'eligible_saved_runs'")
    expect(body).toContain("'correction_rows'")
    expect(body).toContain("'coach_completion_rows'")
    // no ratio column that divides rows by rows
    expect(body).not.toMatch(/rate\s+numeric/)
    expect(body).not.toMatch(/::numeric\s*\/\s*count/)
  })
  it('breakdowns by kind / variant / movement / format / structure / extractor version', () => {
    for (const k of ['by_taxonomy_kind', 'by_variant', 'by_movement', 'by_format', 'by_structure', 'by_extractor_version', 'by_gender_dimension']) {
      expect(body).toContain(`'${k}'`)
    }
  })
})

describe('P11.2 migration — no retrieval / RAG / embeddings / fine-tuning (D3 scope)', () => {
  it('no pgvector / embedding column / vector index', () => {
    expect(body).not.toMatch(/\bvector\s*\(|create\s+extension[^;]*vector|ivfflat|hnsw|embedding\s+(?:column|vector|jsonb|text)/)
  })
  it('no few-shot / model API wiring (prompt_version appears only as a stats filter)', () => {
    expect(body).not.toMatch(/few.?shot|openai\.com|api\.openai|gpt-\d|responses api/)
    // prompt_version is read for filtering; it is never assigned or built here
    expect(body).not.toMatch(/prompt_version\s*(:=|text\s*:=)/)
  })
  it('D3=B: does NOT try to diff workSec / restPlacement / interval params (left to backlog)', () => {
    expect(body).not.toMatch(/worksec|restplacement|intervalsec|startreps|incrementreps/)
  })
})
