import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// M9_PRODUCT_SPECIFICATION.md Section 4.1, Rules 4-5. Pure / no I/O so it
// can be tested without a live backend - same reasoning as
// authorizeMemberRemoval (admin-remove-member/index.ts). Given the existing
// profile matched by email (or null, if genuinely new) and the calling
// admin's own gym, decides which of the four Section 4.1 outcomes applies.
// "sameGymConflict" and "crossGymReject" are deliberately two different
// results, not one - ADR-001's uniform-response requirement applies only to
// crossGymReject (never disclose which other gym, or whether one exists);
// disclosing an already-on-your-own-roster conflict crosses no tenant
// boundary and is not the case ADR-001 governs.
export function classifyAddMemberTarget({ existingProfile, callerGymId }: {
  existingProfile: { id: string; gym_id: string | null } | null;
  callerGymId: string;
}): { outcome: "createNew" } | { outcome: "resolveDormant"; memberId: string } | { outcome: "sameGymConflict" } | { outcome: "crossGymReject" } {
  if (!existingProfile) return { outcome: "createNew" };
  if (existingProfile.gym_id === null) return { outcome: "resolveDormant", memberId: existingProfile.id };
  if (existingProfile.gym_id === callerGymId) return { outcome: "sameGymConflict" };
  return { outcome: "crossGymReject" };
}

function errDetail(error: unknown) {
  const e = error as { message?: string; code?: string; details?: string; hint?: string; status?: number; name?: string } | null;
  return { message: e?.message ?? String(error), code: e?.code, details: e?.details, hint: e?.hint, status: e?.status, name: e?.name };
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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
    const body = await req.json().catch(() => ({}));
    const emailRaw = typeof body.email === "string" ? body.email : "";
    const emailNorm = emailRaw.toLowerCase().trim();
    const fullName = typeof body.full_name === "string" && body.full_name.trim() ? body.full_name.trim() : null;
    if (!emailNorm || !EMAIL_RE.test(emailNorm)) {
      return errorResponse("Email invalid", 400);
    }

    step = "verify_caller_token";
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      console.error("admin-add-member: caller token invalid:", errDetail(callerErr));
      return errorResponse("Token invalid", 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    step = "lookup_caller_admin_row";
    const { data: callerAdminRow, error: callerAdminErr } = await admin.from("admins").select("id, gym_id").eq("id", caller.id).maybeSingle();
    if (callerAdminErr) console.error("admin-add-member: callerAdminRow lookup error (non-fatal, treated as not-admin):", errDetail(callerAdminErr));
    if (!callerAdminRow) {
      return errorResponse("Doar administratorii pot adăuga membri", 403);
    }
    const callerGymId = callerAdminRow.gym_id as string;

    step = "lookup_existing_profile";
    const { data: existingProfile, error: lookupErr } = await admin
      .from("profiles").select("id, gym_id").ilike("email", emailNorm).maybeSingle();
    if (lookupErr) {
      console.error("admin-add-member: existing profile lookup failed:", errDetail(lookupErr));
      return errorResponse(errDetail(lookupErr).message, 500);
    }

    const classification = classifyAddMemberTarget({ existingProfile: existingProfile ?? null, callerGymId });

    if (classification.outcome === "sameGymConflict") {
      return errorResponse("Acest membru este deja activ în sala ta", 409);
    }
    if (classification.outcome === "crossGymReject") {
      // Rule 5, ADR-001: single, generic message - never names or implies
      // which other gym, never distinguishable from any other rejection
      // reason at this branch.
      return errorResponse("Adăugarea acestui membru nu poate fi finalizată", 409);
    }

    if (classification.outcome === "resolveDormant") {
      step = "resolve_dormant_member";
      const { data: resolved, error: resolveErr } = await admin.rpc("m9_resolve_dormant_member_enrollment", {
        p_member_id: classification.memberId,
        p_gym_id: callerGymId,
        p_actor_admin_id: caller.id,
      });
      if (resolveErr) {
        console.error("admin-add-member: m9_resolve_dormant_member_enrollment failed:", errDetail(resolveErr));
        return errorResponse(errDetail(resolveErr).message, 500);
      }
      if (resolved === true) {
        return new Response(JSON.stringify({ success: true, outcome: "resolved_existing" }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      // Lost the race (another admin, or the member's own self-service join,
      // resolved this profile first between the lookup and the update). Not
      // this function's job to guess why - re-read current state and answer
      // exactly as a fresh request would.
      step = "reresolve_after_race";
      const { data: freshProfile, error: freshErr } = await admin
        .from("profiles").select("id, gym_id").eq("id", classification.memberId).maybeSingle();
      if (freshErr || !freshProfile) {
        return errorResponse("Adăugarea acestui membru nu poate fi finalizată", 409);
      }
      const freshClassification = classifyAddMemberTarget({ existingProfile: freshProfile, callerGymId });
      if (freshClassification.outcome === "sameGymConflict") {
        return errorResponse("Acest membru este deja activ în sala ta", 409);
      }
      return errorResponse("Adăugarea acestui membru nu poate fi finalizată", 409);
    }

    // classification.outcome === "createNew"
    //
    // handle_new_user() does NOT accept a raw gym_id in metadata - verified
    // live (pg_get_functiondef), and materially different from what the
    // original multitenant_signup.sql migration shows, superseded since by
    // join-code support: it reads `gym_join_code` (text) and resolves it
    // itself via resolve_gym_join_code(), the exact same mechanism the
    // ordinary self-service join already uses (upper(join_code) match,
    // gyms.is_active = true). Reusing it here - rather than trying to set
    // profiles.gym_id directly some other way - means this path is never a
    // second, divergent way to establish a Gym Membership; it is the same
    // one, admin-triggered instead of member-triggered, and it inherits
    // the is_active guard for free.
    step = "lookup_caller_gym_join_code";
    const { data: gymRow, error: gymErr } = await admin.from("gyms").select("join_code").eq("id", callerGymId).maybeSingle();
    if (gymErr || !gymRow?.join_code) {
      console.error("admin-add-member: could not resolve caller gym's join_code:", errDetail(gymErr));
      return errorResponse("Nu s-a putut identifica sala administratorului", 500);
    }

    step = "create_auth_user";
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailNorm,
      email_confirm: false,
      user_metadata: { gym_join_code: gymRow.join_code, full_name: fullName },
    });
    if (createErr || !created?.user) {
      const detail = errDetail(createErr);
      // Lost a race against another admin (or a self-service signup)
      // creating the same brand-new email between our lookup and this call.
      // Re-resolve exactly as the resolveDormant race path does, rather
      // than surfacing GoTrue's own error text to the admin.
      const looksLikeDuplicate = detail.status === 422 || /already.*registered|already.*exists/i.test(detail.message || "");
      if (looksLikeDuplicate) {
        step = "reresolve_after_create_race";
        const { data: freshProfile } = await admin.from("profiles").select("id, gym_id").ilike("email", emailNorm).maybeSingle();
        if (freshProfile) {
          const freshClassification = classifyAddMemberTarget({ existingProfile: freshProfile, callerGymId });
          if (freshClassification.outcome === "sameGymConflict") {
            return errorResponse("Acest membru este deja activ în sala ta", 409);
          }
        }
        return errorResponse("Adăugarea acestui membru nu poate fi finalizată", 409);
      }
      console.error("admin-add-member: auth.admin.createUser failed:", detail);
      return errorResponse(detail.message, 500);
    }

    const newMemberId = created.user.id;

    // Reliability refinement: verification (profiles.gym_id actually
    // matches Rule 1's expected outcome - the join-code resolution path was
    // only discovered by inspecting the live handle_new_user() definition,
    // not because it's known to be unreliable) and the audit write are one
    // round trip, not two - fewer independent chances for a transient
    // failure to trigger compensation at all. Does not change what is
    // checked, what is written, or the compensation order itself (proven
    // optimal separately - memberships before auth.users is the only order
    // that can succeed).
    step = "verify_and_record_new_member";
    const { data: verifiedAndAudited, error: verifyAuditErr } = await admin.rpc("m9_verify_and_record_new_member", {
      p_member_id: newMemberId,
      p_gym_id: callerGymId,
      p_actor_admin_id: caller.id,
    });

    if (verifyAuditErr || verifiedAndAudited !== true) {
      console.error("admin-add-member: verify+audit failed after identity creation, compensating:", errDetail(verifyAuditErr), "result:", verifiedAndAudited);
      // Atomicity rule: a Member created with no Audit Log entry is not a
      // valid resting state (Product Specification Section 4.1 Success
      // Outcomes + Section 7 Partial Completion). Compensate in the order
      // verified against the live schema: memberships has no ON DELETE
      // cascade from members, so it must be removed explicitly before the
      // auth.users deletion, which then cascades cleanly to profiles and
      // members (both independent, direct ON DELETE CASCADE edges).
      step = "compensate_delete_membership";
      const { error: compMembershipErr } = await admin.rpc("m9_delete_membership_for_compensation", {
        p_member_id: newMemberId,
        p_gym_id: callerGymId,
      });
      if (compMembershipErr) {
        console.error("admin-add-member: COMPENSATION FAILED at membership delete - manual cleanup required for member", newMemberId, errDetail(compMembershipErr));
      }
      step = "compensate_delete_user";
      const { error: compUserErr } = await admin.auth.admin.deleteUser(newMemberId);
      if (compUserErr) {
        console.error("admin-add-member: COMPENSATION FAILED at auth user delete - manual cleanup required for member", newMemberId, errDetail(compUserErr));
      }
      return errorResponse("Adăugarea membrului nu a putut fi finalizată. Încearcă din nou.", 500);
    }

    return new Response(JSON.stringify({ success: true, outcome: "created" }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-add-member: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
