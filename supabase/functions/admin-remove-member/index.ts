import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decide daca `caller` (deja confirmat admin undeva) poate elimina `target`
// din sala. Pura / fara I/O ca sa poata fi testata fara un backend Supabase
// live - vezi index.test.ts. Exista DOAR pentru ca acest endpoint ruleaza pe
// service_role si ocoleste RLS - altfel verificarea de gym_id ar fi facuta
// deja de RLS. Logica identica cu fosta authorizeClientDeletion
// (admin-delete-client) - doar operatia din spate s-a schimbat (P0-006),
// nu cine are voie sa o declanseze.
export function authorizeMemberRemoval({ callerAdminRow, target, targetAdminRow }: {
  callerAdminRow: { id: string; gym_id: string } | null;
  target: { id: string; email: string; gym_id: string | null } | null;
  targetAdminRow: { id: string } | null;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!callerAdminRow) {
    return { ok: false, status: 403, error: "Doar administratorii pot elimina membri" };
  }
  // Acelasi raspuns pentru "nu exista" si "e in alta sala" - altfel raspunsul
  // ar confirma unui admin ca un client_id apartine altei sali (07-18, P0-003).
  if (!target || target.gym_id !== callerAdminRow.gym_id) {
    return { ok: false, status: 404, error: "Membru inexistent" };
  }
  if (targetAdminRow) {
    return { ok: false, status: 400, error: "Nu poți elimina un cont de administrator" };
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

    const authz = authorizeMemberRemoval({ callerAdminRow, target, targetAdminRow });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), { status: authz.status, headers: CORS });
    }

    const email = (target!.email || "").toLowerCase();
    const gymId = target!.gym_id!;

    // Date operationale fara sens dupa ce relatia cu sala se incheie - sterse.
    // Istoricul de antrenament (wod_logs, personal_records, custom_hero_wods),
    // feed-ul si istoricul financiar (orders, payments) NU sunt atinse aici -
    // decizie explicita de produs (P0-006), nu o omisiune.
    await Promise.all([
      admin.from("bookings").delete().eq("member_id", client_id),
      admin.from("class_waitlist").delete().eq("member_id", client_id),
      admin.from("class_reminders").delete().eq("member_email", email),
      admin.from("push_subscriptions").delete().eq("member_email", email),
    ]);

    // Orice abonament activ se incheie prin domeniul Subscription (RPC
    // end_subscription, cale service_role), niciodata printr-un update SQL
    // direct pe subscriptions - Order/Payment raman complet neatinse (nu au
    // fost create/sterse aici, doar subscriptions.is_active se schimba).
    const { data: activeSubs, error: subsErr } = await admin
      .from("subscriptions").select("id")
      .eq("gym_id", gymId).ilike("member_email", email).eq("is_active", true);
    if (subsErr) {
      console.error("admin-remove-member: active subscription lookup failed:", subsErr.message);
      return new Response(JSON.stringify({ error: subsErr.message }), { status: 500, headers: CORS });
    }
    for (const sub of activeSubs || []) {
      const { error: endErr } = await admin.rpc("end_subscription", { p_subscription_id: sub.id });
      if (endErr) {
        console.error("admin-remove-member: end_subscription failed for", sub.id, ":", endErr.message);
        return new Response(JSON.stringify({ error: endErr.message }), { status: 500, headers: CORS });
      }
    }

    // Relatia cu sala se incheie aici - identitatea (auth.users, profiles),
    // istoricul financiar si cel de antrenament raman intacte deliberat.
    const { error: profileErr } = await admin.from("profiles").update({ gym_id: null }).eq("id", client_id);
    if (profileErr) {
      console.error("admin-remove-member: profile update failed:", profileErr.message);
      return new Response(JSON.stringify({ error: profileErr.message }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-remove-member error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
