// Pasul 2A din Workout Intelligence Engine (design aprobat in fazele
// anterioare) - primeste un text de antrenament lipit si intoarce JSON
// structurat. Deocamdata raspunde cu date MOCK, fara niciun apel real catre
// un provider AI - scopul e doar sa verificam end-to-end pipeline-ul
// client -> Edge Function -> raspuns JSON inainte sa adaugam integrarea
// reala (pas ulterior). Nu scrie nimic in DB - doar citeste `admins`/
// `coaches` ca sa autorizeze apelantul, acelasi tipar ca admin-delete-client.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mockAnalysis() {
  return {
    warmup: "Mock warm-up",
    skill: "Mock skill",
    skill2: "",
    wod: "Mock WOD",
    stimulus: "High intensity",
    timeCap: 10,
    scoreType: "For Time",
    movements: ["Thruster", "Pull-up"],
    equipment: ["Barbell", "Pull-up Bar"],
    notes: "Mock response",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Lipsește autentificarea" }), { status: 401, headers: CORS });
    }

    const body = await req.json().catch(() => null);
    const workout = body?.workout;
    if (!workout || typeof workout !== "string" || !workout.trim()) {
      return new Response(JSON.stringify({ error: "Lipsește textul antrenamentului" }), { status: 400, headers: CORS });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Token invalid" }), { status: 401, headers: CORS });
    }

    // Doar admin/coach pot analiza antrenamente - membrii obisnuiti nu au
    // acces la editorul de WOD deloc, deci nici la acest endpoint.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: adminRow }, { data: coachRow }] = await Promise.all([
      admin.from("admins").select("id").eq("id", caller.id).maybeSingle(),
      admin.from("coaches").select("id").eq("id", caller.id).maybeSingle(),
    ]);
    if (!adminRow && !coachRow) {
      return new Response(JSON.stringify({ error: "Doar coach/admin poate analiza un antrenament" }), { status: 403, headers: CORS });
    }

    return new Response(JSON.stringify(mockAnalysis()), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("analyze-workout error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
