// Pasul 2C din Workout Intelligence Engine - inlocuieste raspunsul MOCK
// (Pasul 2A) cu un apel real catre OpenAI Responses API (Structured
// Outputs), gpt-5-mini implicit. Nu scrie nimic in DB si nu populeaza
// formularul din admin - doar intoarce un obiect WorkoutAnalysis validat
// (vezi workout-analysis-schema.ts, contractul canonic) catre client, care
// deocamdata doar il afiseaza in consola (App.jsx, analyzeWorkout()).
// Autorizarea (doar admin/coach) e neschimbata fata de Pasul 2A - citeste
// `admins`/`coaches`, acelasi tipar ca admin-remove-member.
//
// P11.1 - fiecare incercare (reusita SAU esuata) scrie UN rand in
// `ai_analysis_runs` (provenienta AI, ledger append-only, vezi migratia
// 20260902090000). Scrierea e BEST-EFFORT: o eroare la insert NU trebuie
// niciodata sa schimbe raspunsul catre coach (fail-open). `aiRunId` e intors
// in raspunsul de succes ca clientul sa poata lega WOD-ul salvat de rulare.
import { createClient } from "npm:@supabase/supabase-js@2";
import { WORKOUT_ANALYSIS_JSON_SCHEMA, SCHEMA_VERSION } from "./openaiSchema.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "./prompt.ts";
import { toWorkoutAnalysis, validateWorkoutAnalysis, TRANSFORM_VERSION } from "./transform.ts";
import { matchBenchmark } from "./benchmarks.ts";
import { CORS, OpenAiHttpError, callOpenAiWithRetry, errorResponse } from "../_shared/openai.ts";
import { extractLearningContext, LEARNING_CONTEXT_VERSION } from "./learningContext.ts";
import { selectAndSerialize } from "./learningHints.ts";

// P11.4 - controlled learning-hint injection. Runtime kill switch / mode via
// env (no redeploy). Unknown/missing => off (fail-safe; production is NEVER
// silently active).
export function resolveLearningMode(raw: string | undefined): "off" | "shadow" | "active" {
  const v = (raw || "").trim().toLowerCase();
  return v === "shadow" || v === "active" ? v : "off";
}
const LEARNING_READ_MODEL_VERSION = "p11.3-read-model-v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Secret Supabase (`supabase secrets set OPENAI_API_KEY=...`) - niciodata
// hardcodat. OPENAI_MODEL e configurabil separat (poate fi schimbat fara
// redeploy de cod, doar `supabase secrets set OPENAI_MODEL=...`), cu
// gpt-5-mini ca implicit (suficient pt parsare structurata de text, mult mai
// ieftin/rapid decat gpt-5 pt un task sincron "click si astepti raspunsul").
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";

// P11.1 - model config relevant for reproducibility (mirrors _shared/openai.ts).
const MODEL_CONFIG = { api: "responses", reasoning_effort: "low", store: false, timeout_ms: 45000, retry: 1 };

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// P11.1 - PURE: assemble the ai_analysis_runs insert payload. Extracted so it
// can be unit-tested (Deno.test) without a live model call or DB. Every payload
// carries function/provider + the version triple + the resolved model.
export function buildRunRecord(input: {
  gymId: string;
  coachId: string;
  inputText: string;
  inputHash: string;
  model: string;
  modelConfig: Record<string, unknown>;
  promptVersion: string;
  schemaVersion: string;
  transformVersion: string;
  status: "ok" | "benchmark" | "refused" | "truncated" | "invalid" | "error";
  errorDetail?: string | null;
  rawOutput?: unknown;
  normalizedOutput?: unknown;
  tokenUsage?: unknown;
  latencyMs?: number | null;
  completedAt?: string | null;
}): Record<string, unknown> {
  return {
    function: "analyze-workout",
    provider: "openai",
    gym_id: input.gymId,
    coach_id: input.coachId,
    input_text: input.inputText,
    input_hash: input.inputHash,
    model: input.model,
    model_config: input.modelConfig,
    prompt_version: input.promptVersion,
    schema_version: input.schemaVersion,
    transform_version: input.transformVersion,
    status: input.status,
    error_detail: input.errorDetail ?? null,
    raw_output: input.rawOutput ?? null,
    normalized_output: input.normalizedOutput ?? null,
    token_usage: input.tokenUsage ?? null,
    latency_ms: input.latencyMs ?? null,
    completed_at: input.completedAt ?? null,
  };
}

// deno-lint-ignore no-explicit-any
export function tokenUsageOf(raw: any) {
  const u = raw?.usage;
  if (!u) return null;
  return {
    input: u.input_tokens ?? null,
    output: u.output_tokens ?? null,
    reasoning: u.output_tokens_details?.reasoning_tokens ?? null,
    total: u.total_tokens ?? null,
  };
}

// P11.1 - one best-effort provenance insert. Returns the run id, or null if the
// insert failed / the ledger table does not exist yet (fail-open: the caller
// ignores null and the coach flow is untouched).
// P11.4 - gather learning hints BEFORE the model call. Fully fail-open: any
// failure => zero hints, empty fragment, Analyze continues unchanged. Never
// throws. Retrieval is bounded by an internal deadline so it cannot eat the
// OpenAI timeout budget.
// deno-lint-ignore no-explicit-any
async function gatherLearning(admin: any, mode: "off" | "shadow" | "active", gymId: string, workout: string, gymMovementNames: string[]): Promise<{
  fragment: string;
  record: Record<string, unknown>;
}> {
  const base = {
    learning_mode: mode,
    read_model_version: LEARNING_READ_MODEL_VERSION,
    selector_version: "p11.4-selector-v1",
    serializer_version: "p11.4-hint-serializer-v1",
    prompt_version: PROMPT_VERSION,
    retrieval_status: "disabled" as string,
    retrieval_latency_ms: null as number | null,
    error_class: null as string | null,
    query_context: {} as unknown,
    candidate_hint_count: 0,
    selected_hint_count: 0,
    selected_hints: [] as unknown[],
    prompt_fragment_chars: 0,
    prompt_fragment_sha256: null as string | null,
  };
  if (mode === "off") return { fragment: "", record: base };

  const startedAt = Date.now();
  try {
    const ctx = extractLearningContext(workout, gymMovementNames);
    const queries: Record<string, unknown>[] = [];
    // LOAD - one query per deterministically detected (movement, variant, unit)
    for (const d of ctx.detected) {
      if (!d.variant || !d.unit) continue;
      queries.push({
        p_gym_id: gymId, p_taxonomy: "LOAD", p_variant: d.variant,
        p_movement_name: d.movementName, p_unit: d.unit,
        p_gender_dimension: d.genderDimension === "universal" ? "universal" : null,
        p_format: ctx.formatExplicit ? ctx.format : null, p_max_patterns: 10,
      });
    }
    // VARIANT_COMPLETION - for each scaling tier the input did NOT label
    if (ctx.formatExplicit) {
      for (const v of ctx.absentScalingTiers) {
        queries.push({ p_gym_id: gymId, p_taxonomy: "VARIANT_COMPLETION", p_variant: v, p_format: ctx.format, p_evidence_type: "coach_completion", p_max_patterns: 5 });
      }
    }
    // STRUCTURE - ONLY when the raw input literally declared it
    if (ctx.structureExplicit && ctx.formatExplicit) {
      queries.push({ p_gym_id: gymId, p_taxonomy: "STRUCTURE", p_format: ctx.format, p_structure: ctx.structure, p_max_patterns: 5 });
    }

    base.query_context = {
      contextVersion: ctx.contextVersion, format: ctx.format, formatExplicit: ctx.formatExplicit,
      structure: ctx.structure, structureExplicit: ctx.structureExplicit,
      scalingLabelsPresent: ctx.scalingLabelsPresent, absentScalingTiers: ctx.absentScalingTiers,
      detected: ctx.detected, diagnostics: ctx.diagnostics, queryCount: queries.length,
    };

    if (queries.length === 0) {
      base.retrieval_status = "no_context";
      base.retrieval_latency_ms = Date.now() - startedAt;
      return { fragment: "", record: base };
    }

    const DEADLINE_MS = 2500;
    const readModels = await Promise.race([
      Promise.all(queries.map(async (q) => {
        const { data, error } = await admin.rpc("p11_3_retrieve_impl", q);
        if (error) throw new Error(error.message);
        return data;
      })),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("retrieval_deadline")), DEADLINE_MS)),
    ]);

    const sel = selectAndSerialize({ readModels: readModels as unknown[], allowStructure: ctx.structureExplicit });
    base.retrieval_latency_ms = Date.now() - startedAt;
    base.candidate_hint_count = sel.candidateHintCount;
    base.selected_hint_count = sel.selectedHints.length;
    base.selected_hints = sel.selectedHints.map((h) => ({
      taxonomy: h.taxonomy, variant: h.variant, movement: h.movement, unit: h.unit,
      format: h.format, structureNorm: h.structureNorm, evidenceType: h.evidenceType,
      distinctRunCount: h.distinctRunCount, beforeValue: h.beforeValue, afterValue: h.afterValue,
    }));
    base.prompt_fragment_chars = sel.promptFragmentChars;

    if (sel.selectedHints.length === 0) {
      base.retrieval_status = sel.candidateHintCount === 0 ? "no_matches" : "no_eligible_hints";
      return { fragment: "", record: base };
    }
    if (mode === "shadow") {
      base.retrieval_status = "shadow_selected";
      return { fragment: "", record: base };
    }
    base.retrieval_status = "active_selected";
    base.prompt_fragment_sha256 = await sha256Hex(sel.promptFragment);
    return { fragment: sel.promptFragment, record: base };
  } catch (e) {
    base.retrieval_status = "retrieval_failed";
    base.retrieval_latency_ms = Date.now() - startedAt;
    base.error_class = String((e as Error)?.message || e).slice(0, 60).replace(/[^a-z0-9_:\- ]/gi, "");
    return { fragment: "", record: base };
  }
}

// P11.4 - best-effort companion-ledger write, keyed 1:1 to the P11.1 run id.
// Never throws; a failure here never invalidates the Analyze result.
// deno-lint-ignore no-explicit-any
async function recordLearning(admin: any, aiRunId: string | null, gymId: string | null, coachId: string, rec: Record<string, unknown>): Promise<void> {
  if (!aiRunId || !gymId) return;
  try {
    const { error } = await admin.from("ai_analysis_run_learning").insert({ ai_run_id: aiRunId, gym_id: gymId, coach_id: coachId, ...rec });
    if (error) console.error("analyze-workout: ai_analysis_run_learning insert failed", error.message);
  } catch (e) {
    console.error("analyze-workout: ai_analysis_run_learning insert threw", e);
  }
}

// deno-lint-ignore no-explicit-any
async function recordRun(admin: any, fields: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("ai_analysis_runs")
      .insert({ function: "analyze-workout", provider: "openai", ...fields })
      .select("id")
      .single();
    if (error) { console.error("analyze-workout: ai_analysis_runs insert failed", error.message); return null; }
    return data?.id ?? null;
  } catch (e) {
    console.error("analyze-workout: ai_analysis_runs insert threw", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // P11.1 - collected as the request progresses; used by every recordRun call.
  const runStartedAt = Date.now();
  let admin: ReturnType<typeof createClient> | null = null;
  let provCommon: Record<string, unknown> = {
    model: OPENAI_MODEL, model_config: MODEL_CONFIG,
    prompt_version: PROMPT_VERSION, schema_version: SCHEMA_VERSION, transform_version: TRANSFORM_VERSION,
  };

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse(401, "Lipsește autentificarea");

    const body = await req.json().catch(() => null);
    const workout = body?.workout;
    if (!workout || typeof workout !== "string" || !workout.trim()) {
      return errorResponse(400, "Lipsește textul antrenamentului");
    }
    // Coach Quick Create Phase 2 - optional, backward compatible.
    const gymId = typeof body?.gymId === "string" ? body.gymId : null;

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) return errorResponse(401, "Token invalid");

    // Doar admin/coach pot analiza antrenamente.
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: adminRow }, { data: coachRow }] = await Promise.all([
      admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle(),
      admin.from("coaches").select("id, gym_id").eq("id", caller.id).maybeSingle(),
    ]);
    if (!adminRow && !coachRow) return errorResponse(403, "Doar coach/admin poate analiza un antrenament");

    // P11.1 - tenant + actor for the provenance row. gym_id: prefer the
    // client-sent gymId ONLY if it matches the caller's own admin/coach gym
    // (never trust an arbitrary client tenant id - mission section 19);
    // otherwise fall back to the caller's canonical gym. The run is NOT written
    // if we cannot resolve a gym (the table requires gym_id NOT NULL).
    const callerGym = (adminRow as { gym_id?: string } | null)?.gym_id
      ?? (coachRow as { gym_id?: string } | null)?.gym_id ?? null;
    const provGymId = (gymId && gymId === callerGym) ? gymId : callerGym;
    provCommon = {
      ...provCommon,
      gym_id: provGymId,
      coach_id: caller.id,
      input_text: workout,
      input_hash: await sha256Hex(workout.trim()),
    };
    const canRecord = !!provGymId;

    // Scurtatura pt WOD-uri benchmark/hero foarte cunoscute.
    const benchmarkMatch = matchBenchmark(workout);
    if (benchmarkMatch) {
      const analysis = toWorkoutAnalysis(benchmarkMatch, workout);
      const aiRunId = canRecord
        ? await recordRun(admin, {
            ...provCommon, status: "benchmark", raw_output: null, normalized_output: analysis,
            completed_at: new Date().toISOString(), latency_ms: Date.now() - runStartedAt,
          })
        : null;
      return new Response(JSON.stringify({ ...analysis, aiRunId }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!OPENAI_API_KEY) {
      console.error("analyze-workout: lipsește secretul OPENAI_API_KEY");
      return errorResponse(500, "Configurare server incompletă (cheie AI lipsă)");
    }

    // Coach Quick Create Phase 2 - gym-scoped + platform-global movement names.
    let gymMovementNames: string[] = [];
    if (provGymId) {
      const { data: movementRows } = await admin
        .from("movements")
        .select("name")
        .or(`gym_id.eq.${provGymId},gym_id.is.null`);
      gymMovementNames = (movementRows ?? []).map((m: { name: string }) => m.name);
    }

    // P11.4 - deterministic pre-model learning retrieval (fail-open). The
    // fragment is non-empty ONLY in ACTIVE mode with >=1 eligible pattern.
    const learningMode = resolveLearningMode(Deno.env.get("P11_LEARNING_HINTS_MODE"));
    const learning = canRecord
      ? await gatherLearning(admin, learningMode, provGymId!, workout, gymMovementNames)
      : { fragment: "", record: { learning_mode: learningMode, retrieval_status: "disabled" } as Record<string, unknown> };
    const recordLearningFor = (aiRunId: string | null) =>
      recordLearning(admin!, aiRunId, provGymId, caller.id, learning.record);

    // deno-lint-ignore no-explicit-any
    let raw: any;
    try {
      raw = await callOpenAiWithRetry({
        apiKey: OPENAI_API_KEY!,
        model: OPENAI_MODEL,
        systemPrompt: buildSystemPrompt(gymMovementNames, learning.fragment),
        userContent: workout,
        schemaName: "workout_analysis",
        jsonSchema: WORKOUT_ANALYSIS_JSON_SCHEMA,
      });
    } catch (err) {
      if (err instanceof OpenAiHttpError) {
        console.error("analyze-workout: OpenAI HTTP error", err.status, err.body?.slice(0, 2000));
      } else {
        console.error("analyze-workout: cererea către OpenAI a eșuat", err);
      }
      if (canRecord) await recordLearningFor(await recordRun(admin, { ...provCommon, status: "error", error_detail: "openai_unreachable", latency_ms: Date.now() - runStartedAt }));
      return errorResponse(502, "Serviciul AI nu a putut fi contactat, încearcă din nou");
    }

    const completedAt = new Date().toISOString();
    const latencyMs = Date.now() - runStartedAt;
    const tokenUsage = tokenUsageOf(raw);

    if (raw.status === "incomplete") {
      console.error("analyze-workout: răspuns incomplet", JSON.stringify(raw.incomplete_details));
      if (canRecord) await recordLearningFor(await recordRun(admin, { ...provCommon, status: "truncated", error_detail: "response_incomplete", completed_at: completedAt, latency_ms: latencyMs, token_usage: tokenUsage }));
      return errorResponse(502, "Răspunsul AI a fost trunchiat, încearcă un text mai scurt");
    }

    // deno-lint-ignore no-explicit-any
    const message = raw.output?.find((item: any) => item.type === "message");
    // deno-lint-ignore no-explicit-any
    const refusal = message?.content?.find((c: any) => c.type === "refusal");
    if (refusal) {
      console.error("analyze-workout: AI a refuzat cererea", refusal.refusal);
      if (canRecord) await recordLearningFor(await recordRun(admin, { ...provCommon, status: "refused", error_detail: String(refusal.refusal).slice(0, 500), completed_at: completedAt, latency_ms: latencyMs, token_usage: tokenUsage }));
      return errorResponse(422, "AI a refuzat să analizeze acest text");
    }

    // deno-lint-ignore no-explicit-any
    const textPart = message?.content?.find((c: any) => c.type === "output_text");
    if (!textPart?.text) {
      console.error("analyze-workout: răspuns fără output_text", JSON.stringify(raw).slice(0, 2000));
      if (canRecord) await recordLearningFor(await recordRun(admin, { ...provCommon, status: "invalid", error_detail: "no_output_text", completed_at: completedAt, latency_ms: latencyMs, token_usage: tokenUsage }));
      return errorResponse(502, "Răspuns AI invalid");
    }

    // deno-lint-ignore no-explicit-any
    let flat: any;
    try {
      flat = JSON.parse(textPart.text);
    } catch {
      console.error("analyze-workout: JSON invalid din partea AI", String(textPart.text).slice(0, 2000));
      if (canRecord) await recordLearningFor(await recordRun(admin, { ...provCommon, status: "invalid", error_detail: "json_parse_failed", completed_at: completedAt, latency_ms: latencyMs, token_usage: tokenUsage }));
      return errorResponse(502, "Răspuns AI invalid (JSON)");
    }

    const analysis = toWorkoutAnalysis(flat, workout);
    const validationErrors = validateWorkoutAnalysis(analysis);
    if (validationErrors.length) {
      console.error("analyze-workout: răspuns AI invalid după validare", validationErrors, JSON.stringify(flat).slice(0, 2000));
      if (canRecord) await recordLearningFor(await recordRun(admin, { ...provCommon, status: "invalid", error_detail: "shape_validation:" + validationErrors.join("; ").slice(0, 400), raw_output: flat, normalized_output: analysis, completed_at: completedAt, latency_ms: latencyMs, token_usage: tokenUsage }));
      return errorResponse(502, "Răspuns AI invalid (schemă)");
    }

    const aiRunId = canRecord
      ? await recordRun(admin, { ...provCommon, status: "ok", raw_output: flat, normalized_output: analysis, completed_at: completedAt, latency_ms: latencyMs, token_usage: tokenUsage })
      : null;
    await recordLearningFor(aiRunId);

    return new Response(JSON.stringify({ ...analysis, aiRunId }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("analyze-workout error:", err);
    if (admin && provCommon.gym_id) {
      await recordRun(admin, { ...provCommon, status: "error", error_detail: "unhandled:" + String(err).slice(0, 300), latency_ms: Date.now() - runStartedAt });
    }
    return errorResponse(500, String(err));
  }
});
