import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errDetail, errorResponse, hmac, randomToken, INVITATION_EXPIRY_HOURS } from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVITATION_HMAC_SECRET = Deno.env.get("INVITATION_HMAC_SECRET")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// M9 Invite Member (Product Specification Section 4.2). Same identity-
// resolution shape as admin-add-member's classifyAddMemberTarget - ADR-001
// uniform rejection, reused as the direct template, not reimplemented
// differently.
export function classifyInviteTarget({ existingProfile, callerGymId }: {
  existingProfile: { id: string; gym_id: string | null } | null;
  callerGymId: string;
}): { outcome: "newProspect" } | { outcome: "dormantExisting"; memberId: string } | { outcome: "sameGymConflict" } | { outcome: "crossGymReject" } {
  if (!existingProfile) return { outcome: "newProspect" };
  if (existingProfile.gym_id === null) return { outcome: "dormantExisting", memberId: existingProfile.id };
  if (existingProfile.gym_id === callerGymId) return { outcome: "sameGymConflict" };
  return { outcome: "crossGymReject" };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let step = "start";
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse("Lipsește autentificarea", 401);

    step = "parse_body";
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    step = "verify_caller_token";
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) return errorResponse("Token invalid", 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    step = "lookup_caller_admin_row";
    const { data: callerAdminRow } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();
    if (!callerAdminRow) return errorResponse("Doar administratorii pot invita membri", 403);
    const callerGymId = callerAdminRow.gym_id as string;

    if (action === "revoke") {
      const invitationId = body.invitation_id as string;
      if (!invitationId) return errorResponse("Lipsește invitation_id", 400);
      const { data: revoked, error } = await admin.rpc("m9_revoke_invitation", {
        p_invitation_id: invitationId,
        p_gym_id: callerGymId,
        p_actor_admin_id: caller.id,
      });
      if (error) return errorResponse(errDetail(error).message, 500);
      if (!revoked) return errorResponse("Invitația nu mai poate fi revocată", 409);
      return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action !== "create") return errorResponse("Acțiune necunoscută", 400);

    step = "validate_email";
    const emailRaw = typeof body.email === "string" ? body.email : "";
    const emailNorm = emailRaw.toLowerCase().trim();
    if (!emailNorm || !EMAIL_RE.test(emailNorm)) return errorResponse("Email invalid", 400);

    step = "lookup_existing_profile";
    const { data: existingProfile, error: lookupErr } = await admin
      .from("profiles").select("id, gym_id").ilike("email", emailNorm).maybeSingle();
    if (lookupErr) return errorResponse(errDetail(lookupErr).message, 500);

    const classification = classifyInviteTarget({ existingProfile: existingProfile ?? null, callerGymId });

    if (classification.outcome === "sameGymConflict") {
      return errorResponse("Acest membru este deja activ în sala ta", 409);
    }
    if (classification.outcome === "crossGymReject") {
      return errorResponse("Invitația nu poate fi trimisă", 409);
    }

    step = "create_invitation";
    const rawInvitationToken = randomToken(32);
    const tokenHash = await hmac(INVITATION_HMAC_SECRET, rawInvitationToken);
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 3600 * 1000).toISOString();
    const memberId = classification.outcome === "dormantExisting" ? classification.memberId : null;

    const { data: invitationId, error: writeErr } = await admin.rpc("m9_write_invitation", {
      p_gym_id: callerGymId,
      p_actor_admin_id: caller.id,
      p_invited_email: emailNorm,
      p_member_id: memberId,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    });
    if (writeErr) return errorResponse(errDetail(writeErr).message, 500);

    step = "send_invitation_email";
    const { data: gymRow } = await admin.from("gyms").select("name").eq("id", callerGymId).maybeSingle();
    const inviteErr = await sendInvitationEmail(admin, emailNorm, gymRow?.name ?? "Forge", invitationId as string, rawInvitationToken);
    if (inviteErr) {
      console.error("admin-invite-member: invitation email send failed (invitation row still created, resend available):", inviteErr);
    }

    return new Response(JSON.stringify({ success: true, invitation_id: invitationId }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-invite-member: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

async function sendInvitationEmail(admin: any, email: string, gymName: string, invitationId: string, rawToken: string): Promise<string | null> {
  const memberAppUrl = Deno.env.get("MEMBER_APP_URL") || "https://app.forge.ro";
  const link = `${memberAppUrl}/invite/${invitationId}?t=${rawToken}`;
  const { error } = await admin.functions.invoke("send-invitation-email", {
    body: { to: email, gymName, link },
  });
  return error ? errDetail(error).message : null;
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
