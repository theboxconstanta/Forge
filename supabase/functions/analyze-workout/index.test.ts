// P11.1 — the FIRST test file for the analyze-workout Edge Function.
// Covers the pure provenance helpers (buildRunRecord / sha256Hex /
// tokenUsageOf). The DB write itself (recordRun) is best-effort and RLS/trigger
// enforced — exercised in production smoke, not here.
//
// Run: deno test supabase/functions/analyze-workout/index.test.ts

import { assertEquals, assert } from "@std/assert";
import { buildRunRecord, sha256Hex, tokenUsageOf } from "./index.ts";

const base = {
  gymId: "g-1", coachId: "c-1", inputText: "AMRAP 10\n5 pull-ups", inputHash: "hash",
  model: "gpt-5-mini", modelConfig: { reasoning_effort: "low", store: false },
  promptVersion: "p1", schemaVersion: "s1", transformVersion: "t1",
};

Deno.test("buildRunRecord — success run carries model + versions + both outputs", () => {
  const rec = buildRunRecord({
    ...base, status: "ok", rawOutput: { title: null }, normalizedOutput: { sections: [] },
    tokenUsage: { input: 100, output: 50, total: 150 }, latencyMs: 1234, completedAt: "2026-09-02T00:00:00Z",
  });
  assertEquals(rec.function, "analyze-workout");
  assertEquals(rec.provider, "openai");
  assertEquals(rec.model, "gpt-5-mini");
  assertEquals(rec.prompt_version, "p1");
  assertEquals(rec.schema_version, "s1");
  assertEquals(rec.transform_version, "t1");
  assertEquals(rec.status, "ok");
  assertEquals(rec.input_text, "AMRAP 10\n5 pull-ups");
  assertEquals(rec.input_hash, "hash");
  assertEquals((rec.model_config as Record<string, unknown>).store, false); // store:false preserved
  assert(rec.raw_output !== null);
  assert(rec.normalized_output !== null);
  assertEquals((rec.token_usage as Record<string, unknown>).total, 150);
  assertEquals(rec.latency_ms, 1234);
});

Deno.test("buildRunRecord — early failure has status + error_detail, no outputs", () => {
  const rec = buildRunRecord({ ...base, status: "error", errorDetail: "openai_unreachable", latencyMs: 42 });
  assertEquals(rec.status, "error");
  assertEquals(rec.error_detail, "openai_unreachable");
  assertEquals(rec.raw_output, null);
  assertEquals(rec.normalized_output, null);
  assertEquals(rec.token_usage, null);
});

Deno.test("buildRunRecord — schema-validation failure keeps raw + normalized for debugging", () => {
  const rec = buildRunRecord({
    ...base, status: "invalid", errorDetail: "shape_validation:format necunoscut",
    rawOutput: { bad: true }, normalizedOutput: { sections: [] },
  });
  assertEquals(rec.status, "invalid");
  assert(String(rec.error_detail).startsWith("shape_validation:"));
  assert(rec.raw_output !== null);
});

Deno.test("buildRunRecord — benchmark short-circuit: normalized set, raw null", () => {
  const rec = buildRunRecord({ ...base, status: "benchmark", rawOutput: null, normalizedOutput: { sections: [{}] } });
  assertEquals(rec.status, "benchmark");
  assertEquals(rec.raw_output, null);
  assert(rec.normalized_output !== null);
});

Deno.test("sha256Hex — deterministic, 64 hex chars", async () => {
  const a = await sha256Hex("AMRAP 10");
  const b = await sha256Hex("AMRAP 10");
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]{64}$/.test(a));
  assert((await sha256Hex("different")) !== a);
});

Deno.test("tokenUsageOf — maps Responses API usage; null when absent", () => {
  assertEquals(tokenUsageOf({}), null);
  assertEquals(
    tokenUsageOf({ usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 2 } } }),
    { input: 10, output: 5, reasoning: 2, total: 15 },
  );
});
