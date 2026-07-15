// Pasul 2C din Workout Intelligence Engine - inlocuieste raspunsul MOCK
// (Pasul 2A) cu un apel real catre OpenAI Responses API (Structured
// Outputs), gpt-5-mini implicit. Nu scrie nimic in DB si nu populeaza
// formularul din admin - doar intoarce un obiect WorkoutAnalysis validat
// (vezi workout-analysis-schema.ts, contractul canonic) catre client, care
// deocamdata doar il afiseaza in consola (App.jsx, analyzeWorkout()).
// Autorizarea (doar admin/coach) e neschimbata fata de Pasul 2A - citeste
// `admins`/`coaches`, acelasi tipar ca admin-delete-client.
import { createClient } from "npm:@supabase/supabase-js@2";
import { WORKOUT_ANALYSIS_JSON_SCHEMA } from "./openaiSchema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { toWorkoutAnalysis, validateWorkoutAnalysis } from "./transform.ts";

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

const OPENAI_TIMEOUT_MS = 45_000;
const OPENAI_RETRY_DELAY_MS = 800;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: CORS });
}

class OpenAiHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`OpenAI HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function callOpenAiOnce(workout: string, signal: AbortSignal) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      store: false,
      input: [
        { role: "developer", content: SYSTEM_PROMPT },
        { role: "user", content: workout },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "workout_analysis",
          strict: true,
          schema: WORKOUT_ANALYSIS_JSON_SCHEMA,
        },
      },
    }),
  });
}

// O singura reincercare, doar pt erori tranzitorii (429/5xx sau
// timeout/retea) - nu si pt erori 4xx (cerere invalida, nu se rezolva
// reincercand aceeasi cerere).
async function callOpenAiWithRetry(workout: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    try {
      const res = await callOpenAiOnce(workout, controller.signal);
      if (res.ok) return await res.json();
      const responseBody = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, OPENAI_RETRY_DELAY_MS));
        continue;
      }
      throw new OpenAiHttpError(res.status, responseBody);
    } catch (err) {
      if (err instanceof OpenAiHttpError) throw err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, OPENAI_RETRY_DELAY_MS));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse(401, "Lipsește autentificarea");

    const body = await req.json().catch(() => null);
    const workout = body?.workout;
    if (!workout || typeof workout !== "string" || !workout.trim()) {
      return errorResponse(400, "Lipsește textul antrenamentului");
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) return errorResponse(401, "Token invalid");

    // Doar admin/coach pot analiza antrenamente - membrii obisnuiti nu au
    // acces la editorul de WOD deloc, deci nici la acest endpoint.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: adminRow }, { data: coachRow }] = await Promise.all([
      admin.from("admins").select("id").eq("id", caller.id).maybeSingle(),
      admin.from("coaches").select("id").eq("id", caller.id).maybeSingle(),
    ]);
    if (!adminRow && !coachRow) return errorResponse(403, "Doar coach/admin poate analiza un antrenament");

    if (!OPENAI_API_KEY) {
      console.error("analyze-workout: lipsește secretul OPENAI_API_KEY");
      return errorResponse(500, "Configurare server incompletă (cheie AI lipsă)");
    }

    let raw: any;
    try {
      raw = await callOpenAiWithRetry(workout);
    } catch (err) {
      if (err instanceof OpenAiHttpError) {
        console.error("analyze-workout: OpenAI HTTP error", err.status, err.body?.slice(0, 2000));
      } else {
        console.error("analyze-workout: cererea către OpenAI a eșuat", err);
      }
      return errorResponse(502, "Serviciul AI nu a putut fi contactat, încearcă din nou");
    }

    if (raw.status === "incomplete") {
      console.error("analyze-workout: răspuns incomplet", JSON.stringify(raw.incomplete_details));
      return errorResponse(502, "Răspunsul AI a fost trunchiat, încearcă un text mai scurt");
    }

    const message = raw.output?.find((item: any) => item.type === "message");
    const refusal = message?.content?.find((c: any) => c.type === "refusal");
    if (refusal) {
      console.error("analyze-workout: AI a refuzat cererea", refusal.refusal);
      return errorResponse(422, "AI a refuzat să analizeze acest text");
    }

    const textPart = message?.content?.find((c: any) => c.type === "output_text");
    if (!textPart?.text) {
      console.error("analyze-workout: răspuns fără output_text", JSON.stringify(raw).slice(0, 2000));
      return errorResponse(502, "Răspuns AI invalid");
    }

    let flat: any;
    try {
      flat = JSON.parse(textPart.text);
    } catch {
      console.error("analyze-workout: JSON invalid din partea AI", String(textPart.text).slice(0, 2000));
      return errorResponse(502, "Răspuns AI invalid (JSON)");
    }

    const analysis = toWorkoutAnalysis(flat, workout);
    const validationErrors = validateWorkoutAnalysis(analysis);
    if (validationErrors.length) {
      console.error("analyze-workout: răspuns AI invalid după validare", validationErrors, JSON.stringify(flat).slice(0, 2000));
      return errorResponse(502, "Răspuns AI invalid (schemă)");
    }

    return new Response(JSON.stringify(analysis), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("analyze-workout error:", err);
    return errorResponse(500, String(err));
  }
});
