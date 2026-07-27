import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// M7.3 Step 10 - Gym Transfer Fallback Journey, destination side. Lets a
// destination administrator complete an enrollment on behalf of a
// Member who cannot complete the ordinary self-service join themselves,
// using a Transfer Code as the credential identifying which Member is
// joining. Per M7.2 Section 5: narrowly scoped - performs only the
// tenancy-signal write a valid code already resolves to (via
// redeem_transfer_code, service-role gated - see its own migration for
// why the two effects must be one transaction), and lets the existing,
// unmodified gym-change synchronization trigger (Steps 1/7) produce the
// resulting Membership. No Membership-creation logic, no code
// validation, and no authorization condition is duplicated here beyond
// this function's own single responsibility: confirm the caller is a
// genuine administrator and resolve their own gym_id.
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
    const { code } = await req.json();
    if (!code || typeof code !== "string" || !code.trim()) {
      return errorResponse("Lipsește codul de transfer", 400);
    }

    step = "verify_caller_token";
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      console.error("redeem-transfer-code: caller token invalid:", errDetail(callerErr));
      return errorResponse("Token invalid", 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    step = "lookup_caller_admin_row";
    const { data: callerAdminRow, error: callerAdminErr } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();
    if (callerAdminErr) console.error("redeem-transfer-code: callerAdminRow lookup error (non-fatal, treated as not-admin):", errDetail(callerAdminErr));
    if (!callerAdminRow) {
      return errorResponse("Doar administratorii pot înregistra un transfer", 403);
    }

    // Redemption has no separate "target's own gym" to compare against
    // the way Remove/Transfer's authorizeMemberRemoval does - the
    // Transfer Code itself is what resolves which Member is joining,
    // and every reason it could be invalid (nonexistent, used, revoked,
    // superseded, expired) is collapsed into the same uniform rejection
    // below (M7.2 Section 9/15) - the caller learns nothing beyond
    // "not valid", never which gym originally issued it.
    step = "redeem_transfer_code";
    const { error: redeemErr } = await admin.rpc("redeem_transfer_code", {
      p_code: code.trim(),
      p_gym_id: callerAdminRow.gym_id,
    });
    if (redeemErr) {
      console.error("redeem-transfer-code: redeem_transfer_code failed:", errDetail(redeemErr));
      return errorResponse("Cod de transfer invalid", 400);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("redeem-transfer-code: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
