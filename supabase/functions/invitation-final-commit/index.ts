import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errDetail, errorResponse, resolveInvitationByToken } from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVITATION_HMAC_SECRET = Deno.env.get("INVITATION_HMAC_SECRET")!;

const COMMIT_FAILURE_MESSAGES: Record<string, string> = {
  invalid_invitation: "Această invitație nu mai este validă",
  stale_waiver: "Regulamentul a fost actualizat. Te rugăm să îl revizuiești din nou.",
  membership_missing: "A apărut o eroare neașteptată. Te rugăm să încerci din nou.",
  membership_race_lost: "Contul a fost deja activat.",
};

// M9 Member Preferences & Internationalization increment. Canonical values
// only - members.gender/language/weight_unit have no DB CHECK constraint
// (weight_unit is the one exception, but is re-validated here anyway so
// all three fail the same way), so this Edge Function is the only gate
// standing between an arbitrary client payload and these columns.
const ALLOWED_GENDER = new Set(["masculin", "feminin"]);
const ALLOWED_LANGUAGE = new Set(["en", "ro"]);
const ALLOWED_WEIGHT_UNIT = new Set(["kg", "lbs"]);

export function isValidOnboardingPreferences(gender: string, language: string, weightUnit: string): boolean {
  return ALLOWED_GENDER.has(gender) && ALLOWED_LANGUAGE.has(language) && ALLOWED_WEIGHT_UNIT.has(weightUnit);
}

// 2026-07-30 Removed Member Re-invitation fix. An invitation carrying
// member_id (admin-invite-member's own "dormantExisting" classification -
// profiles.gym_id was null at invite time) can no longer be assumed to mean
// "already has an active membership" by the time Final Commit runs: a
// member who was previously active and has since been removed also has
// gym_id null, and needs the SAME reactivation m9_final_commit_dormant_member
// already performs for the email-discovered dormant path, not
// m9_final_commit_existing_member's stricter "must already be active"
// contract. A missing profile row (should be unreachable given the FK, but
// not guaranteed) is treated the same as null - both fail safely inside
// whichever RPC runs, never silently attach the wrong identity.
export function needsMemberReactivation(memberProfile: { gym_id: string | null } | null): boolean {
  return !memberProfile || memberProfile.gym_id === null;
}

// Existing-identity/dormant-Member preferences must never be silently
// overwritten by whatever an unrelated invitation happened to default to
// (Preferences audit Section 8/9/14). A single UPDATE ... WHERE id = X AND
// <col> IS NULL is atomic at the statement level - there is no read-then-
// write race window, unlike a select-then-conditionally-update pattern
// would have. One statement per column since PostgREST's query builder
// can't express a single COALESCE(col, new) SET clause across mixed
// null/non-null columns in one call.
async function applyPreferencesIfUnset(
  admin: any,
  memberId: string,
  gender: string,
  language: string,
  weightUnit: string,
): Promise<void> {
  await admin.from("members").update({ gender }).eq("id", memberId).is("gender", null);
  await admin.from("members").update({ language }).eq("id", memberId).is("language", null);
  await admin.from("members").update({ weight_unit: weightUnit }).eq("id", memberId).is("weight_unit", null);
}

// Final Commit - the one place every M9 Invite Member architecture/security
// gate in this thread converged on. Ordering is binding, not a stylistic
// choice (Final Auth-Handoff Security Report Section 10): identity step
// first, SQL Final Commit second, session-establishment token last - a
// failure in the last step never requires undoing real business state.
async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let step = "start";
  try {
    const body = await req.json().catch(() => ({}));
    const invitationId = body.invitation_id as string;
    const rawToken = body.token as string;
    const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
    const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    const birthDate = typeof body.birth_date === "string" && body.birth_date.trim() ? body.birth_date.trim() : null;
    const waiverId = body.waiver_id as string;
    const gender = typeof body.gender === "string" ? body.gender : "";
    const language = typeof body.language === "string" ? body.language : "";
    const weightUnit = typeof body.weight_unit === "string" ? body.weight_unit : "";

    if (!invitationId || !rawToken || !firstName || !lastName || !birthDate || !waiverId) {
      return errorResponse("Date lipsă", 400);
    }
    if (!isValidOnboardingPreferences(gender, language, weightUnit)) {
      return errorResponse("Preferințe invalide", 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    step = "resolve_invitation";
    const inv = await resolveInvitationByToken(admin, invitationId, rawToken, INVITATION_HMAC_SECRET);
    if (!inv) return errorResponse("Această invitație nu mai este validă", 404);

    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    // ===== Path: invitation was created for a known identity (admin-invite-member's
    // own "dormantExisting" classification sets member_id whenever profiles.gym_id
    // was null at invite time, which covers BOTH a never-yet-activated Increment 1
    // manual-add AND a member who was previously active and has since been removed) =====
    if (inv.member_id) {
      step = "lookup_member_profile_state";
      const { data: memberProfile, error: memberProfileErr } = await admin.from("profiles").select("id, gym_id").eq("id", inv.member_id).maybeSingle();
      if (memberProfileErr) return errorResponse(errDetail(memberProfileErr).message, 500);

      // Re-derive at commit time, not just trust member_id's mere presence -
      // state can change between invitation creation and Final Commit (this
      // is exactly the removed-member defect: profiles.gym_id was already
      // null when the invitation was created, but m9_final_commit_existing_member
      // assumes an ALREADY-active membership, which only holds when gym_id is
      // non-null and matches this invitation's gym). gym_id null routes to
      // the exact same reactivation RPC already used for the email-discovered
      // dormant path below - no new reactivation logic, no duplicated Member
      // Domain transition.
      const needsReactivation = needsMemberReactivation(memberProfile);
      const rpcName = needsReactivation ? "m9_final_commit_dormant_member" : "m9_final_commit_existing_member";

      step = "activate_existing_member";
      const { error: updErr } = await admin.auth.admin.updateUserById(inv.member_id, { email_confirm: true });
      if (updErr) return errorResponse(errDetail(updErr).message, 500);

      step = needsReactivation ? "sql_final_commit_dormant_via_member_id" : "sql_final_commit_existing";
      const { data: commitStatus, error: commitErr } = await admin.rpc(rpcName, {
        p_invitation_id: invitationId,
        p_gym_id: inv.gym_id,
        p_member_id: inv.member_id,
        p_waiver_id: waiverId,
      });
      if (commitErr) return errorResponse(errDetail(commitErr).message, 500);
      if (commitStatus !== "ok") {
        // Binding correction from the Auth Spike: no compensation for this
        // path - the Member already legitimately existed, nothing new was
        // created, and email_confirm cannot be reverted anyway. The
        // operation is simply retryable. Applies identically to both RPCs -
        // neither creates a new auth.users identity.
        return errorResponse(COMMIT_FAILURE_MESSAGES[commitStatus as string] ?? "Eroare necunoscută", 409);
      }

      await admin.from("members").update({ first_name: firstName, last_name: lastName, full_name: fullName, phone, birth_date: birthDate }).eq("id", inv.member_id);
      await applyPreferencesIfUnset(admin, inv.member_id, gender, language, weightUnit);

      return await handoffSession(admin, inv.invited_email);
    }

    // ===== Resolve: new prospect vs. dormant existing identity =====
    step = "lookup_existing_profile";
    const { data: existingProfile } = await admin.from("profiles").select("id, gym_id").ilike("email", inv.invited_email).maybeSingle();

    if (existingProfile) {
      // Dormant existing identity - resolve, do not re-create.
      step = "sql_final_commit_dormant";
      const { data: commitStatus, error: commitErr } = await admin.rpc("m9_final_commit_dormant_member", {
        p_invitation_id: invitationId,
        p_gym_id: inv.gym_id,
        p_member_id: existingProfile.id,
        p_waiver_id: waiverId,
      });
      if (commitErr) return errorResponse(errDetail(commitErr).message, 500);
      if (commitStatus !== "ok") {
        return errorResponse(COMMIT_FAILURE_MESSAGES[commitStatus as string] ?? "Eroare necunoscută", 409);
      }

      await admin.from("members").update({ first_name: firstName, last_name: lastName, full_name: fullName, phone, birth_date: birthDate }).eq("id", existingProfile.id);
      await applyPreferencesIfUnset(admin, existingProfile.id, gender, language, weightUnit);

      return await handoffSession(admin, inv.invited_email);
    }

    // ===== Genuinely new prospect =====
    step = "lookup_gym_join_code";
    const { data: gymRow } = await admin.from("gyms").select("join_code").eq("id", inv.gym_id).maybeSingle();
    if (!gymRow?.join_code) return errorResponse("Nu s-a putut identifica sala", 500);

    step = "create_auth_user";
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: inv.invited_email,
      email_confirm: true, // justified: Forge's own email challenge already verified control moments ago
      user_metadata: { gym_join_code: gymRow.join_code, full_name: fullName },
    });
    if (createErr || !created?.user) return errorResponse(errDetail(createErr).message, 500);
    const newMemberId = created.user.id;

    step = "sql_final_commit_new";
    const { data: commitStatus, error: commitErr } = await admin.rpc("m9_final_commit_new_prospect", {
      p_invitation_id: invitationId,
      p_gym_id: inv.gym_id,
      p_new_member_id: newMemberId,
      p_waiver_id: waiverId,
    });
    if (commitErr || commitStatus !== "ok") {
      console.error("invitation-final-commit: SQL commit failed after createUser, compensating:", commitErr ? errDetail(commitErr) : commitStatus);
      step = "compensate_delete_membership";
      const { error: compMembershipErr } = await admin.rpc("m9_delete_membership_for_compensation", { p_member_id: newMemberId, p_gym_id: inv.gym_id });
      if (compMembershipErr) console.error("invitation-final-commit: COMPENSATION FAILED at membership delete for", newMemberId, errDetail(compMembershipErr));
      step = "compensate_delete_user";
      const { error: compUserErr } = await admin.auth.admin.deleteUser(newMemberId);
      if (compUserErr) console.error("invitation-final-commit: COMPENSATION FAILED at auth delete for", newMemberId, errDetail(compUserErr));
      return errorResponse(COMMIT_FAILURE_MESSAGES[commitStatus as string] ?? "Înregistrarea nu a putut fi finalizată. Încearcă din nou.", commitErr ? 500 : 409);
    }

    // Unconditional, unlike applyPreferencesIfUnset used for the existing/
    // dormant paths above - this row was just created by createUser() a
    // few lines up, so gender/language/weight_unit are guaranteed null and
    // the invitation's selections become canonical outright.
    await admin.from("members").update({ first_name: firstName, last_name: lastName, full_name: fullName, phone, birth_date: birthDate, gender, language, weight_unit: weightUnit }).eq("id", newMemberId);

    return await handoffSession(admin, inv.invited_email);
  } catch (err) {
    console.error("invitation-final-commit: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

// Session handoff - after successful Final Commit only, never before
// (Final Auth-Handoff Security Report Section 10/11). Uses the
// experimentally-verified generateLink + type:'magiclink' pairing
// (M9 Auth Spike). No second email - the already-verified browser
// receives the token directly.
async function handoffSession(admin: any, email: string): Promise<Response> {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData?.properties?.hashed_token) {
    // Per the approved failure model: Member/Membership/waiver/invitation
    // are already validly committed at this point - this is a retryable
    // access-delivery problem, never a reason to undo real business state.
    console.error("invitation-final-commit: session handoff failed after successful commit:", linkErr ? errDetail(linkErr) : "no hashed_token");
    return new Response(
      JSON.stringify({ success: true, session_pending: true, message: "Contul a fost creat. Activarea sesiunii poate fi reîncercată." }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({ success: true, token_hash: linkData.properties.hashed_token }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
