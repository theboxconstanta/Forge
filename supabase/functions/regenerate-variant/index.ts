// Coach Quick Create Phase 1 - "Regenerate with AI" (VariantTabs.tsx,
// forge-admin-web). Additive, does not touch analyze-workout's contract
// at all: one LLM call, given the RX section + a target scaling tier,
// returns exactly one regenerated variant (movements/weight/note). The
// deterministic scaling engine (scalingEngine.ts) is the DEFAULT
// generation path (instant, free, fits the 30-second rule); this
// function is an optional per-tab "second opinion", never in the default
// path. Auth mirrors analyze-workout/index.ts exactly (anon-key
// auth.getUser -> service-role admin/coach check) - same authorization
// shape, not a new one.
import { createClient } from "npm:@supabase/supabase-js@2";
import { REGENERATE_VARIANT_JSON_SCHEMA } from "./openaiSchema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { CORS, OpenAiHttpError, callOpenAiWithRetry, errorResponse } from "../_shared/openai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";

const VALID_TIERS = ["intermediate", "beginner", "onramp"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse(401, "Missing authentication");

    const body = await req.json().catch(() => null);
    const rxSection = body?.rxSection;
    const targetTier = body?.targetTier;

    if (!rxSection || typeof rxSection !== "object") return errorResponse(400, "Missing rxSection");
    if (!isStringArray(rxSection.movements) || rxSection.movements.length === 0) {
      return errorResponse(400, "rxSection.movements must be a non-empty array of strings");
    }
    if (!VALID_TIERS.includes(targetTier)) {
      return errorResponse(400, `targetTier must be one of: ${VALID_TIERS.join(", ")}`);
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) return errorResponse(401, "Invalid token");

    // Only admin/coach can regenerate a variant - same population that
    // can reach the workout builder at all, matching analyze-workout's
    // own authorization exactly.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: adminRow }, { data: coachRow }] = await Promise.all([
      admin.from("admins").select("id").eq("id", caller.id).maybeSingle(),
      admin.from("coaches").select("id").eq("id", caller.id).maybeSingle(),
    ]);
    if (!adminRow && !coachRow) return errorResponse(403, "Only a coach/admin can regenerate a variant");

    if (!OPENAI_API_KEY) {
      console.error("regenerate-variant: missing OPENAI_API_KEY secret");
      return errorResponse(500, "Server not configured (missing AI key)");
    }

    const gymMovementContext = isStringArray(body?.gymMovementContext) ? body.gymMovementContext : [];

    const userContent = JSON.stringify({
      targetTier,
      rxMovements: rxSection.movements,
      rxWeight: rxSection.weight ?? { male: "", female: "" },
      rxNote: rxSection.note ?? "",
      format: rxSection.format ?? "",
      gymMovementContext,
    });

    let raw: any;
    try {
      raw = await callOpenAiWithRetry({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userContent,
        schemaName: "regenerated_variant",
        jsonSchema: REGENERATE_VARIANT_JSON_SCHEMA,
      });
    } catch (err) {
      if (err instanceof OpenAiHttpError) {
        console.error("regenerate-variant: OpenAI HTTP error", err.status, err.body?.slice(0, 2000));
      } else {
        console.error("regenerate-variant: request to OpenAI failed", err);
      }
      return errorResponse(502, "The AI service could not be reached, try again");
    }

    if (raw.status === "incomplete") {
      console.error("regenerate-variant: incomplete response", JSON.stringify(raw.incomplete_details));
      return errorResponse(502, "The AI response was truncated, try again");
    }

    const message = raw.output?.find((item: any) => item.type === "message");
    const refusal = message?.content?.find((c: any) => c.type === "refusal");
    if (refusal) {
      console.error("regenerate-variant: AI refused the request", refusal.refusal);
      return errorResponse(422, "AI declined to regenerate this variant");
    }

    const textPart = message?.content?.find((c: any) => c.type === "output_text");
    if (!textPart?.text) {
      console.error("regenerate-variant: response missing output_text", JSON.stringify(raw).slice(0, 2000));
      return errorResponse(502, "Invalid AI response");
    }

    let variant: any;
    try {
      variant = JSON.parse(textPart.text);
    } catch {
      console.error("regenerate-variant: invalid JSON from AI", String(textPart.text).slice(0, 2000));
      return errorResponse(502, "Invalid AI response (JSON)");
    }

    if (!isStringArray(variant.movements) || typeof variant.weight?.male !== "string" || typeof variant.weight?.female !== "string" || typeof variant.note !== "string") {
      console.error("regenerate-variant: AI response failed shape validation", JSON.stringify(variant).slice(0, 2000));
      return errorResponse(502, "Invalid AI response (schema)");
    }

    return new Response(JSON.stringify(variant), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("regenerate-variant error:", err);
    return errorResponse(500, String(err));
  }
});
