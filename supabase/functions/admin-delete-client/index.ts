import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decide daca `caller` (deja confirmat admin undeva) poate sterge `target`.
// Pura / fara I/O ca sa poata fi testata fara un backend Supabase live - vezi
// index.test.ts. Exista DOAR pentru ca acest endpoint ruleaza pe service_role
// si ocoleste RLS - altfel verificarea de gym_id ar fi facuta deja de RLS,
// ca la "subscriptions_admin_delete" si echivalentele ei.
export function authorizeClientDeletion({ callerAdminRow, target, targetAdminRow }: {
  callerAdminRow: { id: string; gym_id: string } | null;
  target: { id: string; email: string; gym_id: string | null } | null;
  targetAdminRow: { id: string } | null;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!callerAdminRow) {
    return { ok: false, status: 403, error: "Doar administratorii pot șterge clienți" };
  }
  // Acelasi raspuns pentru "nu exista" si "e in alta sala" - altfel raspunsul
  // ar confirma unui admin ca un client_id apartine altei sali (07-18, P0-003).
  if (!target || target.gym_id !== callerAdminRow.gym_id) {
    return { ok: false, status: 404, error: "Client inexistent" };
  }
  if (targetAdminRow) {
    return { ok: false, status: 400, error: "Nu poți șterge un cont de administrator" };
  }
  return { ok: true };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Lipsește autentificarea" }), { status: 401, headers: CORS });
    }

    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "Lipsește client_id" }), { status: 400, headers: CORS });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Token invalid" }), { status: 401, headers: CORS });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: callerAdminRow } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();

    let target: { id: string; email: string; gym_id: string | null } | null = null;
    let targetAdminRow: { id: string } | null = null;
    if (callerAdminRow) {
      ({ data: target } = await admin.from("profiles").select("id, email, gym_id").eq("id", client_id).maybeSingle());
      if (target) {
        ({ data: targetAdminRow } = await admin.from("admins").select("id").eq("id", client_id).maybeSingle());
      }
    }

    const authz = authorizeClientDeletion({ callerAdminRow, target, targetAdminRow });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), { status: authz.status, headers: CORS });
    }

    const email = (target!.email || "").toLowerCase();

    // Sterge toate urmele membrului din tabelele care nu au ON DELETE CASCADE
    // catre profiles/auth.users, inainte sa stergem contul propriu-zis.
    await Promise.all([
      admin.from("bookings").delete().eq("member_id", client_id),
      admin.from("class_waitlist").delete().eq("member_id", client_id),
      admin.from("class_reminders").delete().eq("member_email", email),
      admin.from("wod_logs").delete().eq("member_id", client_id),
      admin.from("personal_records").delete().eq("member_id", client_id),
      admin.from("custom_hero_wods").delete().eq("member_id", client_id),
      admin.from("feed_posts").delete().eq("member_id", client_id),
      admin.from("feed_reactions").delete().eq("member_id", client_id),
      admin.from("feed_comments").delete().eq("member_id", client_id),
      admin.from("push_subscriptions").delete().eq("member_email", email),
      admin.from("subscriptions").delete().eq("member_email", email),
    ]);

    await admin.from("profiles").delete().eq("id", client_id);

    const { error: authDelErr } = await admin.auth.admin.deleteUser(client_id);
    if (authDelErr) {
      console.error("auth.admin.deleteUser error:", authDelErr);
      return new Response(JSON.stringify({ error: authDelErr.message }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-delete-client error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

// import.meta.main e false cand fisierul e importat (de index.test.ts) si
// true cand Supabase Edge Runtime il ruleaza direct - fara asta, importul
// din test ar porni un al doilea listener HTTP real.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
