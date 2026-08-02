import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errDetail, errorResponse, hmac, randomToken, INVITATION_EXPIRY_HOURS } from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVITATION_HMAC_SECRET = Deno.env.get("INVITATION_HMAC_SECRET")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// M10.3 Admin Invitation. Three actions in one function - the same
// multi-action shape admin-invite-member (create/revoke/resend) and
// admin-manage-waiver (publish) already use, kept to exactly the one new
// Edge Function M10_IMPLEMENTATION_PLAN.md names. "send"/"revoke" require
// an authenticated Admin caller; "status"/"accept" are public, pre-auth
// (the invitee has no session yet - same reasoning as invitation-status/
// invitation-final-commit).
//
// send_admin_invitation/revoke_admin_invitation/accept_admin_invitation
// are service_role-only SQL RPCs (see the migration's own comment for why
// this Edge Function layer is structurally required despite M10_
// IMPLEMENTATION_PLAN.md's own boundary table framing these as directly
// client-callable: the HMAC secret used here exists only in this runtime).

// Mirrors resolveInvitationByToken in _shared/invite.ts exactly, scoped to
// admin_invitations instead of gym_invitations - a parallel implementation,
// not a shared one, since accepting one is a structurally different write
// (Admin role, never a Membership) - OWNER_DOMAIN_IMPLEMENTATION_
// ARCHITECTURE.md Section 5.5's own "reuses M9's proven shape, without
// reusing M9's table" applies to this resolver too, not just the schema.
async function resolveAdminInvitationByToken(admin: any, invitationId: string, rawToken: string): Promise<Record<string, any> | null> {
  const { data: inv, error } = await admin.from("admin_invitations").select("*").eq("id", invitationId).maybeSingle();
  if (error || !inv) return null;
  if (inv.accepted_at || inv.revoked_at) return null;
  if (new Date(inv.expires_at).getTime() <= Date.now()) return null;
  const computed = await hmac(INVITATION_HMAC_SECRET, rawToken);
  if (computed !== inv.token_hash) return null;
  return inv;
}

// Identical mechanism to invitation-final-commit's own handoffSession -
// the new Admin's very first session, established the same way a new
// Member's is, via a service-role-generated magic link the client
// exchanges with supabase.auth.verifyOtp(). Not shared code (it lives in
// that Edge Function's own file, not _shared/invite.ts), so this is a
// parallel implementation of the same, already-proven pattern.
async function handoffSession(admin: any, email: string): Promise<Response> {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error("accept-admin-invitation: session handoff failed after successful accept:", linkErr ? errDetail(linkErr) : "no hashed_token");
    return new Response(
      JSON.stringify({ success: true, session_pending: true }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({ success: true, token_hash: linkData.properties.hashed_token }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
}

async function sendAdminInvitationEmail(admin: any, email: string, gymName: string, invitationId: string, rawToken: string): Promise<{ error: string | null }> {
  const memberAppUrl = Deno.env.get("MEMBER_APP_URL") || "https://app.forge.ro";
  const link = `${memberAppUrl}/admin-invite/${invitationId}?t=${rawToken}`;
  const { data, error } = await admin.functions.invoke("send-invitation-email", {
    body: { type: "admin_invite", to: email, gymName, link },
  });
  if (!error) return { error: data?.ok === false ? `Brevo a respins trimiterea (status ${data?.status ?? "necunoscut"})` : null };
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const responseBody = await context.json();
      if (typeof responseBody?.body === "string") return { error: `Brevo a respins trimiterea: ${responseBody.body.slice(0, 300)}` };
    } catch { /* fall through to generic message */ }
  }
  return { error: errDetail(error).message };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let step = "start";
  try {
    step = "parse_body";
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ===== Public, pre-auth: status (read invitation details before accepting) =====
    if (action === "status") {
      const invitationId = body.invitation_id as string;
      const rawToken = body.token as string;
      if (!invitationId || !rawToken) return errorResponse("Invitație invalidă", 404);
      step = "resolve_status";
      const inv = await resolveAdminInvitationByToken(admin, invitationId, rawToken);
      if (!inv) return errorResponse("Această invitație nu mai este validă", 404);
      const { data: gymRow } = await admin.from("gyms").select("name").eq("id", inv.gym_id).maybeSingle();
      return new Response(JSON.stringify({ gym_name: gymRow?.name ?? "Forge", invited_email: inv.invited_email }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ===== Public, pre-auth: accept =====
    if (action === "accept") {
      const invitationId = body.invitation_id as string;
      const rawToken = body.token as string;
      if (!invitationId || !rawToken) return errorResponse("Invitație invalidă", 404);
      step = "resolve_accept";
      const inv = await resolveAdminInvitationByToken(admin, invitationId, rawToken);
      if (!inv) return errorResponse("Această invitație nu mai este validă", 404);

      // Identity resolution - reuse an existing account by email if one
      // exists (the same lookup admin-invite-member already performs),
      // otherwise create one. This is deliberately simpler than M9's own
      // three-way existing/dormant/new-prospect split: admins carries no
      // "dormant" concept at all (unlike Membership, there is no removal
      // history to reactivate), so only two cases genuinely exist here.
      // Whether the resolved identity also happens to be a Member
      // somewhere is irrelevant and requires no special handling -
      // admins and members are independent tables with no coupling
      // between them, so an identity can freely hold both roles.
      step = "lookup_existing_profile";
      const { data: existingProfile } = await admin.from("profiles").select("id").ilike("email", inv.invited_email).maybeSingle();

      let newAdminId: string;
      if (existingProfile) {
        newAdminId = existingProfile.id;
      } else {
        step = "create_auth_user";
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: inv.invited_email,
          email_confirm: true, // justified identically to invitation-final-commit: possession of this link already proves control of the inbox
        });
        if (createErr || !created?.user) return errorResponse(errDetail(createErr).message, 500);
        newAdminId = created.user.id;
      }

      step = "sql_accept";
      const { data: acceptStatus, error: acceptErr } = await admin.rpc("accept_admin_invitation", {
        p_invitation_id: invitationId,
        p_new_admin_id: newAdminId,
        p_new_admin_email: inv.invited_email,
      });
      if (acceptErr) return errorResponse(errDetail(acceptErr).message, 500);
      if (acceptStatus !== "ok") return errorResponse("Invitația nu a putut fi acceptată. Încearcă din nou.", 409);

      return await handoffSession(admin, inv.invited_email);
    }

    // ===== Authenticated Admin caller: send / revoke =====
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse("Lipsește autentificarea", 401);

    step = "verify_caller_token";
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) return errorResponse("Token invalid", 401);

    step = "lookup_caller_admin_row";
    const { data: callerAdminRow } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();
    if (!callerAdminRow) return errorResponse("Doar administratorii pot invita colegi", 403);
    const callerGymId = callerAdminRow.gym_id as string;

    if (action === "revoke") {
      const invitationId = body.invitation_id as string;
      if (!invitationId) return errorResponse("Lipsește invitation_id", 400);
      const { data: revoked, error } = await admin.rpc("revoke_admin_invitation", {
        p_invitation_id: invitationId,
        p_gym_id: callerGymId,
        p_actor_admin_id: caller.id,
      });
      if (error) return errorResponse(errDetail(error).message, 500);
      if (!revoked) return errorResponse("Invitația nu mai poate fi revocată", 409);
      return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action !== "send") return errorResponse("Acțiune necunoscută", 400);

    step = "validate_email";
    const emailRaw = typeof body.email === "string" ? body.email : "";
    const emailNorm = emailRaw.toLowerCase().trim();
    if (!emailNorm || !EMAIL_RE.test(emailNorm)) return errorResponse("Email invalid", 400);

    step = "check_already_admin";
    const { data: existingAdmin } = await admin.from("admins").select("id").eq("gym_id", callerGymId).ilike("email", emailNorm).maybeSingle();
    if (existingAdmin) return errorResponse("Această persoană este deja administrator al sălii tale", 409);

    step = "create_invitation";
    const rawInvitationToken = randomToken(32);
    const tokenHash = await hmac(INVITATION_HMAC_SECRET, rawInvitationToken);
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 3600 * 1000).toISOString();

    const { data: invitationId, error: writeErr } = await admin.rpc("send_admin_invitation", {
      p_gym_id: callerGymId,
      p_actor_admin_id: caller.id,
      p_invited_email: emailNorm,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    });
    if (writeErr) return errorResponse(errDetail(writeErr).message, 500);

    step = "send_invitation_email";
    const { data: gymRow } = await admin.from("gyms").select("name").eq("id", callerGymId).maybeSingle();
    const emailResult = await sendAdminInvitationEmail(admin, emailNorm, gymRow?.name ?? "Forge", invitationId as string, rawInvitationToken);
    if (emailResult.error) {
      console.error("accept-admin-invitation: invitation email send failed (invitation row still created):", emailResult.error);
    }

    return new Response(JSON.stringify({ success: true, invitation_id: invitationId }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("accept-admin-invitation: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
