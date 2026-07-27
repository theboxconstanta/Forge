import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeMemberRemoval } from "../admin-remove-member/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// M7.3 Step 2 - Gym Transfer origin-side ending action. Mirrors
// admin-remove-member exactly: same caller verification, same
// authorization condition (authorizeMemberRemoval, imported unchanged -
// the condition is identical per M7.2 Technical Architecture Section
// 12), same operational-row cleanup, same end_subscription call. Differs
// only in the final write: end_membership_as_transfer() instead of a
// direct profiles update, so member_domain_sync_on_profile_gym_change()
// (20260726140000, extended by 20260727110000) is signaled to record
// 'transferred' instead of its default 'removed' - see
// 20260727120000_end_membership_as_transfer.sql for why this must happen
// inside one RPC call rather than a separate signal-then-update pair.
function errDetail(error: unknown) {
  const e = error as { message?: string; code?: string; details?: string; hint?: string; status?: number; name?: string } | null;
  return { message: e?.message ?? String(error), code: e?.code, details: e?.details, hint: e?.hint, status: e?.status, name: e?.name };
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: CORS });
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let step = "start";
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return errorResponse("Lipsește autentificarea", 401);
    }

    step = "parse_body";
    const { client_id } = await req.json();
    if (!client_id) {
      return errorResponse("Lipsește client_id", 400);
    }

    step = "verify_caller_token";
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      console.error("admin-transfer-member: caller token invalid:", errDetail(callerErr));
      return errorResponse("Token invalid", 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    step = "lookup_caller_admin_row";
    const { data: callerAdminRow, error: callerAdminErr } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();
    if (callerAdminErr) console.error("admin-transfer-member: callerAdminRow lookup error (non-fatal, treated as not-admin):", errDetail(callerAdminErr));

    let target: { id: string; email: string; gym_id: string | null } | null = null;
    let targetAdminRow: { id: string } | null = null;
    if (callerAdminRow) {
      step = "lookup_target_profile";
      const { data: targetData, error: targetErr } = await admin.from("profiles").select("id, email, gym_id").eq("id", client_id).maybeSingle();
      if (targetErr) console.error("admin-transfer-member: target profile lookup error (non-fatal, treated as not-found):", errDetail(targetErr));
      target = targetData;
      if (target) {
        step = "lookup_target_admin_row";
        const { data: targetAdminData, error: targetAdminErr } = await admin.from("admins").select("id").eq("id", client_id).maybeSingle();
        if (targetAdminErr) console.error("admin-transfer-member: targetAdminRow lookup error (non-fatal, treated as not-admin):", errDetail(targetAdminErr));
        targetAdminRow = targetAdminData;
      }
    }

    const authz = authorizeMemberRemoval({ callerAdminRow, target, targetAdminRow });
    if (!authz.ok) {
      return errorResponse(authz.error, authz.status);
    }

    const email = (target!.email || "").toLowerCase();
    const gymId = target!.gym_id!;

    // Identic cu admin-remove-member: date operationale fara sens dupa ce
    // relatia cu sala se incheie. Istoricul de antrenament, feed-ul si
    // istoricul financiar (orders, payments) nu sunt atinse aici.
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
      for (const f of deleteFailures) console.error(`admin-transfer-member: ${f.table} delete failed:`, errDetail(f.error));
      return errorResponse(errDetail(deleteFailures[0].error).message, 500);
    }

    // Orice abonament activ se incheie prin domeniul Subscription (RPC
    // end_subscription, cale service_role), identic cu admin-remove-member -
    // Order/Payment raman complet neatinse.
    step = "lookup_active_subscriptions";
    const { data: activeSubs, error: subsErr } = await admin
      .from("subscriptions").select("id")
      .eq("gym_id", gymId).ilike("member_email", email).eq("is_active", true);
    if (subsErr) {
      console.error("admin-transfer-member: active subscription lookup failed:", errDetail(subsErr));
      return errorResponse(errDetail(subsErr).message, 500);
    }

    for (const sub of activeSubs || []) {
      step = `end_subscription:${sub.id}`;
      const { error: endErr } = await admin.rpc("end_subscription", { p_subscription_id: sub.id });
      if (endErr) {
        console.error("admin-transfer-member: end_subscription failed for", sub.id, ":", errDetail(endErr));
        return errorResponse(errDetail(endErr).message, 500);
      }
    }

    // Relatia cu sala se incheie aici, taggata drept transfer - identitatea
    // (auth.users, profiles), istoricul financiar si cel de antrenament
    // raman intacte deliberat, exact ca la Remove Member.
    step = "end_membership_as_transfer";
    const { error: transferErr } = await admin.rpc("end_membership_as_transfer", { p_client_id: client_id });
    if (transferErr) {
      console.error("admin-transfer-member: end_membership_as_transfer failed:", errDetail(transferErr));
      return errorResponse(errDetail(transferErr).message, 500);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-transfer-member: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
