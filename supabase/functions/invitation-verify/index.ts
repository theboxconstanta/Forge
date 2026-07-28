import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errDetail, errorResponse, hmac, resolveInvitationByToken, CHALLENGE_MAX_ATTEMPTS } from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVITATION_HMAC_SECRET = Deno.env.get("INVITATION_HMAC_SECRET")!;

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let step = "start";
  try {
    const body = await req.json().catch(() => ({}));
    const invitationId = body.invitation_id as string;
    const rawToken = body.token as string;
    const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
    if (!invitationId || !rawToken || !submittedCode) return errorResponse("Cerere invalidă", 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    step = "resolve_invitation";
    const inv = await resolveInvitationByToken(admin, invitationId, rawToken, INVITATION_HMAC_SECRET);
    if (!inv) return errorResponse("Această invitație nu mai este validă", 404);

    step = "verify_code";
    const submittedHash = await hmac(INVITATION_HMAC_SECRET, submittedCode);
    const { data: verified, error } = await admin.rpc("m9_verify_email_challenge", {
      p_invitation_id: invitationId,
      p_submitted_hash: submittedHash,
      p_max_attempts: CHALLENGE_MAX_ATTEMPTS,
    });
    if (error) return errorResponse(errDetail(error).message, 500);

    if (!verified) return errorResponse("Cod incorect sau expirat", 400);
    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("invitation-verify: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
