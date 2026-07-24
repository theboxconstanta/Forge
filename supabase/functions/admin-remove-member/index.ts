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

// TEMPORARY diagnostic instrumentation (P1 investigation, 2026-07-24): a
// production "Failed to remove member from gym" report could not be
// reproduced against the live function via direct calls or the real UI -
// see docs. This surfaces exactly which step/statement failed and the raw
// Postgres error fields (code/details/hint), both in the function's own
// logs and (temporarily) in the response body, instead of only a bare
// .message - the fastest way to capture ground truth from the next real
// occurrence, whoever triggers it. Revert once the real failure is caught
// and fixed: restore the plain `{ error: X.message }` bodies and remove the
// step/pgDetail plumbing.
function pgDetail(error: unknown) {
  const e = error as { message?: string; code?: string; details?: string; hint?: string } | null;
  return { message: e?.message ?? String(error), code: e?.code, details: e?.details, hint: e?.hint };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let step = "start";
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Lipsește autentificarea" }), { status: 401, headers: CORS });
    }

    step = "parse_body";
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "Lipsește client_id" }), { status: 400, headers: CORS });
    }
    console.log("admin-remove-member: request received for client_id", client_id);

    step = "verify_caller_token";
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      console.error("admin-remove-member: caller token invalid:", callerErr?.message);
      return new Response(JSON.stringify({ error: "Token invalid" }), { status: 401, headers: CORS });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    step = "lookup_caller_admin_row";
    const { data: callerAdminRow, error: callerAdminErr } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();
    if (callerAdminErr) console.error("admin-remove-member: callerAdminRow lookup error (non-fatal, treated as not-admin):", pgDetail(callerAdminErr));

    let target: { id: string; email: string; gym_id: string | null } | null = null;
    let targetAdminRow: { id: string } | null = null;
    if (callerAdminRow) {
      step = "lookup_target_profile";
      const { data: targetData, error: targetErr } = await admin.from("profiles").select("id, email, gym_id").eq("id", client_id).maybeSingle();
      if (targetErr) console.error("admin-remove-member: target profile lookup error (non-fatal, treated as not-found):", pgDetail(targetErr));
      target = targetData;
      if (target) {
        step = "lookup_target_admin_row";
        const { data: targetAdminData, error: targetAdminErr } = await admin.from("admins").select("id").eq("id", client_id).maybeSingle();
        if (targetAdminErr) console.error("admin-remove-member: targetAdminRow lookup error (non-fatal, treated as not-admin):", pgDetail(targetAdminErr));
        targetAdminRow = targetAdminData;
      }
    }

    const authz = authorizeMemberRemoval({ callerAdminRow, target, targetAdminRow });
    if (!authz.ok) {
      console.log("admin-remove-member: authorization rejected:", authz.error, "caller", caller.id, "target", client_id);
      return new Response(JSON.stringify({ error: authz.error }), { status: authz.status, headers: CORS });
    }

    const email = (target!.email || "").toLowerCase();
    const gymId = target!.gym_id!;
    console.log("admin-remove-member: authorized. caller", caller.id, "target", client_id, "email", email, "gym", gymId);

    // Date operationale fara sens dupa ce relatia cu sala se incheie - sterse.
    // Istoricul de antrenament (wod_logs, personal_records, custom_hero_wods),
    // feed-ul si istoricul financiar (orders, payments) NU sunt atinse aici -
    // decizie explicita de produs (P0-006), nu o omisiune.
    step = "delete_operational_rows";
    const [bookingsRes, waitlistRes, remindersRes, pushRes] = await Promise.all([
      admin.from("bookings").delete().eq("member_id", client_id),
      admin.from("class_waitlist").delete().eq("member_id", client_id),
      admin.from("class_reminders").delete().eq("member_email", email),
      admin.from("push_subscriptions").delete().eq("member_email", email),
    ]);
    const deleteFailures = [
      { table: "bookings", error: bookingsRes.error },
      { table: "class_waitlist", error: waitlistRes.error },
      { table: "class_reminders", error: remindersRes.error },
      { table: "push_subscriptions", error: pushRes.error },
    ].filter((r) => r.error);
    if (deleteFailures.length > 0) {
      for (const f of deleteFailures) console.error(`admin-remove-member: ${f.table} delete failed:`, pgDetail(f.error));
      const first = deleteFailures[0];
      return new Response(
        JSON.stringify({ error: pgDetail(first.error).message, step: `delete_${first.table}`, debug: pgDetail(first.error) }),
        { status: 500, headers: CORS },
      );
    }
    console.log("admin-remove-member: operational rows cleared for", client_id);

    // Orice abonament activ se incheie prin domeniul Subscription (RPC
    // end_subscription, cale service_role), niciodata printr-un update SQL
    // direct pe subscriptions - Order/Payment raman complet neatinse (nu au
    // fost create/sterse aici, doar subscriptions.is_active se schimba).
    step = "lookup_active_subscriptions";
    const { data: activeSubs, error: subsErr } = await admin
      .from("subscriptions").select("id")
      .eq("gym_id", gymId).ilike("member_email", email).eq("is_active", true);
    if (subsErr) {
      console.error("admin-remove-member: active subscription lookup failed:", pgDetail(subsErr));
      return new Response(JSON.stringify({ error: pgDetail(subsErr).message, step, debug: pgDetail(subsErr) }), { status: 500, headers: CORS });
    }
    console.log("admin-remove-member: active subscriptions found:", (activeSubs || []).length);

    for (const sub of activeSubs || []) {
      step = `end_subscription:${sub.id}`;
      const { error: endErr } = await admin.rpc("end_subscription", { p_subscription_id: sub.id });
      if (endErr) {
        console.error("admin-remove-member: end_subscription failed for", sub.id, ":", pgDetail(endErr));
        return new Response(JSON.stringify({ error: pgDetail(endErr).message, step, debug: pgDetail(endErr) }), { status: 500, headers: CORS });
      }
      console.log("admin-remove-member: ended subscription", sub.id);
    }

    // Relatia cu sala se incheie aici - identitatea (auth.users, profiles),
    // istoricul financiar si cel de antrenament raman intacte deliberat.
    step = "update_profile_gym_id_null";
    const { error: profileErr } = await admin.from("profiles").update({ gym_id: null }).eq("id", client_id);
    if (profileErr) {
      console.error("admin-remove-member: profile update failed:", pgDetail(profileErr));
      return new Response(JSON.stringify({ error: pgDetail(profileErr).message, step, debug: pgDetail(profileErr) }), { status: 500, headers: CORS });
    }
    console.log("admin-remove-member: profile updated, removal complete for", client_id);

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-remove-member: unhandled exception at step", step, ":", err);
    return new Response(
      JSON.stringify({ error: String(err), step, debug: { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined } }),
      { status: 500, headers: CORS },
    );
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
