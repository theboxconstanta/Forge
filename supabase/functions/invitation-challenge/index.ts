import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CORS, errDetail, errorResponse, hmac, randomChallengeCode, resolveInvitationByToken,
  CHALLENGE_CODE_EXPIRY_MINUTES, RESEND_COOLDOWN_SECONDS, MAX_RESENDS,
} from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVITATION_HMAC_SECRET = Deno.env.get("INVITATION_HMAC_SECRET")!;

// Sends (or resends) the 6-digit email-ownership challenge. This is NOT
// authentication (Final Auth-Handoff Security Report Section 3/6) - it
// creates no auth.users, no session, grants no access beyond letting the
// same invitation-token holder submit a code back.
async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let step = "start";
  try {
    const body = await req.json().catch(() => ({}));
    const invitationId = body.invitation_id as string;
    const rawToken = body.token as string;
    if (!invitationId || !rawToken) return errorResponse("Link invalid", 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    step = "resolve_invitation";
    const inv = await resolveInvitationByToken(admin, invitationId, rawToken, INVITATION_HMAC_SECRET);
    if (!inv) return errorResponse("Această invitație nu mai este validă", 404);

    step = "generate_code";
    const code = randomChallengeCode();
    const challengeHash = await hmac(INVITATION_HMAC_SECRET, code);
    const expiresAt = new Date(Date.now() + CHALLENGE_CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    step = "write_challenge";
    const { data: status, error } = await admin.rpc("m9_send_email_challenge", {
      p_invitation_id: invitationId,
      p_challenge_hash: challengeHash,
      p_challenge_expires_at: expiresAt,
      p_resend_cooldown_seconds: RESEND_COOLDOWN_SECONDS,
      p_max_resends: MAX_RESENDS,
    });
    if (error) return errorResponse(errDetail(error).message, 500);
    if (status === "cooldown") return errorResponse("Așteaptă puțin înainte de a cere un cod nou", 429);
    if (status === "resend_cap") return errorResponse("Prea multe cereri de cod. Contactează sala pentru o invitație nouă.", 429);
    if (status !== "ok") return errorResponse("Această invitație nu mai este validă", 404);

    step = "send_email";
    const { data: gymRow } = await admin.from("gyms").select("name").eq("id", inv.gym_id).maybeSingle();
    const { error: emailErr } = await admin.functions.invoke("send-invitation-email", {
      body: { type: "code", to: inv.invited_email, gymName: gymRow?.name, code },
    });
    if (emailErr) {
      console.error("invitation-challenge: code email send failed:", errDetail(emailErr));
      return errorResponse("Codul nu a putut fi trimis. Încearcă din nou.", 500);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("invitation-challenge: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
