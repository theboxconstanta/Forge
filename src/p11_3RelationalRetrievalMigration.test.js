// P11.3 — structural assertions on the relational-retrieval migration. No live
// DB in this repo's test infra; this guards the invariants that matter most:
// additive + read-only, tenant-guarded, taxonomy-specific matching, no
// cross-variant / cross-gender / cross-unit / cross-gym leakage, no fuzzy
// movement match, no embeddings / RAG / prompt injection / OpenAI call.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '..', 'supabase', 'migrations', '20260902110000_p11_3_relational_retrieval.sql'), 'utf8')
const lc = sql.toLowerCase()
const body = lc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('P11.3 migration — additive + strictly read-only', () => {
  it('creates NO table, index, trigger, RLS policy', () => {
    expect(body).not.toMatch(/create\s+table/)
    expect(body).not.toMatch(/create\s+(unique\s+)?index/)
    expect(body).not.toMatch(/create\s+trigger/)
    expect(body).not.toMatch(/create\s+policy/)
    expect(body).not.toMatch(/alter\s+table/)
  })
  it('writes to NO table (no INSERT / UPDATE / DELETE / MERGE anywhere)', () => {
    expect(body).not.toMatch(/\binsert\s+into\b/)
    expect(body).not.toMatch(/\bupdate\s+(public\.)?\w+\s+set\b/)
    expect(body).not.toMatch(/\bdelete\s+from\b/)
    expect(body).not.toMatch(/\bmerge\s+into\b/)
  })
  it('never reads the live wods / workouts / wod_logs (P10 snapshot-first, §54/§73)', () => {
    expect(body).not.toMatch(/from\s+(public\.)?wods\b/)
    expect(body).not.toMatch(/from\s+(public\.)?workouts\b/)
    expect(body).not.toMatch(/from\s+(public\.)?wod_logs\b/)
    expect(body).not.toMatch(/from\s+(public\.)?skill_logs\b/)
  })
  it('only sources: ai_correction_evidence + ai_analysis_runs (frozen)', () => {
    const froms = [...body.matchAll(/\bfrom\s+public\.(\w+)/g)].map((m) => m[1])
    expect(new Set(froms)).toEqual(new Set(['ai_correction_evidence', 'ai_analysis_runs']))
  })
  it('has a reversibility (DOWN) section', () => {
    expect(lc).toContain('reversibility')
    expect(lc).toContain('drop function if exists public.p11_retrieve_learning_hints')
    expect(lc).toContain('drop function if exists public.p11_3_retrieve_impl')
  })
})

describe('P11.3 migration — tenant isolation + security (§30 / §45)', () => {
  it('public wrapper raises for a non-coach of the gym', () => {
    expect(body).toMatch(/create or replace function public\.p11_retrieve_learning_hints[\s\S]*?if not public\.is_coach_or_admin\(p_gym_id\) then[\s\S]*?raise exception 'not authorized for gym/)
  })
  it('every candidate query is gym-scoped', () => {
    expect(body).toMatch(/where ev\.gym_id = p_gym_id/)
    expect(body).toMatch(/where r\.gym_id = p_gym_id/)
  })
  it('the engine is REVOKEd from anon AND authenticated (wrapper-only)', () => {
    expect(body).toMatch(/revoke all on function public\.p11_3_retrieve_impl\([\s\S]*?\) from public, anon, authenticated/)
  })
  it('the public wrapper is REVOKEd from anon, GRANTed to authenticated', () => {
    expect(body).toMatch(/revoke all on function public\.p11_retrieve_learning_hints\([\s\S]*?\) from public, anon/)
    expect(body).toMatch(/grant execute on function public\.p11_retrieve_learning_hints\([\s\S]*?\) to authenticated/)
  })
  it('no arbitrary dynamic SQL (§46)', () => {
    expect(body).not.toMatch(/\bexecute\s+format\b/)
    expect(body).not.toMatch(/\bexecute\s+'/)
  })
})

describe('P11.3 migration — deterministic taxonomy-specific matching', () => {
  it('only DETERMINISTIC + eligible evidence is a candidate (§18/§19)', () => {
    expect(body).toContain("e.reliability = 'ambiguous'        then 'ambiguous_reliability'")
    expect(body).toContain("e.reliability = 'unsupported'      then 'unsupported_reliability'")
    expect(body).toContain("e.eligibility <> 'eligible'        then 'ineligible'")
  })
  it('no cross-variant leakage (§10)', () => {
    expect(body).toMatch(/v_need_variant and p_variant is not null and e\.variant is distinct from p_variant[\s\S]*?'incompatible_variant'/)
  })
  it('no cross-gender-dimension leakage (§11)', () => {
    expect(body).toMatch(/v_need_gender and p_gender_dimension is not null[\s\S]*?e\.gender_dimension is distinct from p_gender_dimension[\s\S]*?'incompatible_gender'/)
  })
  it('never aggregates across incompatible units (§61)', () => {
    expect(body).toMatch(/v_need_unit and p_unit is not null and e\.unit is distinct from p_unit[\s\S]*?'incompatible_unit'/)
  })
  it('movement identity is id-first, exact-name fallback, NO fuzzy match (§12)', () => {
    expect(body).toMatch(/p_movement_id is not null and e\.movement_id is not null and e\.movement_id = p_movement_id/)
    expect(body).toMatch(/e\.movement_name = v_norm_name/)
    expect(body).not.toMatch(/levenshtein|similarity\(|pg_trgm|<->|ilike/)
  })
  it('movement position is hard only for Sequence / Chipper / Ladder REPS (§13)', () => {
    expect(body).toMatch(/v_pos_matters\s*:=\s*\(p_taxonomy = 'reps'[\s\S]*?v_q_struct_norm = 'sequence' or p_format in \('chipper','ladder'\)/)
  })
  it('format / structure are HARD for structural taxonomies (§14/§15)', () => {
    expect(body).toMatch(/v_format_hard\s+:=\s+p_taxonomy in \('structure','score_family','rounds','duration','rest_time'\)/)
    expect(body).toMatch(/v_struct_hard\s+:=\s+p_taxonomy in \('rest_time','reps'\)/)
  })
  it('REST_TIME never carries a movement (invariant honoured downstream from P11.2 CHECK)', () => {
    // REST_TIME is in the format/structure-hard sets and NOT in v_need_movement
    expect(body).not.toMatch(/v_need_movement := p_taxonomy in \([^)]*'rest_time'/)
  })
})

describe('P11.3 migration — match levels + ordering (§9 / §48)', () => {
  it('three explicit match levels: exact / strong / broad (no single opaque score)', () => {
    expect(body).toContain("then 'exact'")
    expect(body).toContain("then 'strong'")
    expect(body).toContain("else 'broad'")
    expect(body).not.toMatch(/relevance_score|similarity_score|::float.*score/)
  })
  it('deterministic ordering: exact context > strength > distinct-run > recency > key', () => {
    expect(body).toMatch(/order by[\s\S]*?\(exact_count > 0\) desc,[\s\S]*?when 'supported' then 0[\s\S]*?distinct_run_count desc, latest_observed_at desc, pattern_key/)
  })
})

describe('P11.3 migration — pattern aggregation (§22-§28)', () => {
  it('strength uses DISTINCT RUN count, not row count (§23)', () => {
    expect(body).toContain('count(distinct m.ai_run_id)                       as distinct_run_count')
    expect(body).toMatch(/when distinct_run_count >= 3\s+then 'supported'/)
    expect(body).toMatch(/when distinct_run_count = 2\s+then 'weak'/)
    expect(body).toMatch(/else 'observation_only'/)
  })
  it('conflicting patterns are marked, never resolved to one arbitrary target (§26/§49)', () => {
    expect(body).toContain("when conflict_state = 'conflicting' then 'conflicting'")
    expect(body).toContain("then 'consistent'")
    expect(body).toContain("then 'mixed'")
    expect(body).toContain("else 'conflicting'")
  })
  it('exposes before/after DISTRIBUTIONS, not a normative rule (§25/§65)', () => {
    expect(body).toContain("'beforedistribution'")
    expect(body).toContain("'afterdistribution'")
    expect(body).not.toMatch(/canonical_target|recommended_value|rule_value|'target',/)
  })
  it('raw observations stay traceable to source run ids (§41/§42)', () => {
    expect(body).toContain("'sourcerunids'")
    expect(body).toContain("'exactmatches'")
    expect(body).toContain("'broadermatches'")
  })
  it('coach_completion stays distinct from correction (§17/§34)', () => {
    expect(body).toMatch(/coalesce\(s\.evidence_type,'-'\)/)  // evidence_type is part of the pattern key
  })
})

describe('P11.3 migration — positive evidence + honest denominators (§20/§21/§52/§53)', () => {
  it('positive context is derived READ-TIME from frozen saved_output (no new table)', () => {
    expect(body).toMatch(/from\s+jsonb_array_elements\(r\.saved_output\)/)
    expect(body).toMatch(/r\.outcome in \('accepted_unchanged','accepted_cosmetic','accepted_semantic'\)/)
  })
  it('field-level rate is NULL unless the denominator is large enough (§21)', () => {
    expect(body).toMatch(/when count\(\*\) >= 3[\s\S]*?else null end from comp/)
    expect(body).toContain('no fabricated precision')
  })
  it('null positiveContext for taxonomies with no derivable field denominator', () => {
    expect(body).toMatch(/p_taxonomy in \('load','reps','distance','calories','prescription_completion'\)/)
    expect(body).toMatch(/jsonb_set\(v_out, '\{positivecontext\}', 'null'::jsonb\)/)
  })
})

// strip the descriptive COMMENT ON ... IS '...'; blocks (they intentionally
// name the things this migration does NOT do)
const code = body.replace(/comment on[\s\S]*?';/g, '')

describe('P11.3 migration — no retrieval-boundary crossing (§4/§5/§93)', () => {
  it('no embeddings / pgvector / vector search', () => {
    expect(code).not.toMatch(/create\s+extension[^;]*vector|vector\s*\(|::vector|ivfflat|hnsw|<->|<=>|<#>|embedding\s+(vector|jsonb|text|real)/)
  })
  it('no OpenAI / HTTP / few-shot / RAG wiring', () => {
    expect(code).not.toMatch(/openai|few.?shot|\brag\b|net\.http|pg_net|http_post|extensions\.http|supabase_functions/)
  })
  it('result sizes are bounded (§47)', () => {
    expect(body).toMatch(/v_max_p\s+integer\s*:=\s*least\(greatest\(coalesce\(p_max_patterns, 20\), 1\), 100\)/)
    expect(body).toMatch(/v_max_o\s+integer\s*:=\s*least\(greatest\(coalesce\(p_max_observations, 50\), 1\), 500\)/)
    expect(body).toContain('limit v_max_p')
    expect(body).toContain('limit v_max_o')
  })
  it('read model carries a version stamp (forward-compatible with a future adapter, §86)', () => {
    expect(body).toMatch(/c_read_model_version constant text := 'p11\.3-read-model-v1'/)
  })
})
