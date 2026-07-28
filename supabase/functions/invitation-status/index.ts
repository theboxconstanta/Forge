import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errorResponse, resolveInvitationByToken } from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVITATION_HMAC_SECRET = Deno.env.get("INVITATION_HMAC_SECRET")!;

// Public, unauthenticated landing check for the onboarding UI. Possession
// of {invitation_id, token} is the only authority - no Supabase session
// exists or is created here (Model D). Every failure reason (not found,
// wrong token, expired, revoked, already accepted) returns the identical
// generic response - the onboarding UI shows one "this invitation is no
// longer valid" state, never distinguishing why.
async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const invitationId = body.invitation_id as string;
    const rawToken = body.token as string;
    if (!invitationId || !rawToken) return errorResponse("Link invalid", 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const inv = await resolveInvitationByToken(admin, invitationId, rawToken, INVITATION_HMAC_SECRET);
    if (!inv) return errorResponse("Această invitație nu mai este validă", 404);

    const { data: gymRow } = await admin.from("gyms").select("name").eq("id", inv.gym_id).maybeSingle();
    const { data: waiverRow } = await admin
      .from("gym_waivers").select("id, title, version, content_ref")
      .eq("gym_id", inv.gym_id).lte("effective_date", new Date().toISOString().slice(0, 10))
      .order("effective_date", { ascending: false }).limit(1).maybeSingle();

    return new Response(
      JSON.stringify({
        gym_name: gymRow?.name ?? "your gym",
        invited_email: inv.invited_email,
        path: inv.member_id ? "existing" : "new_or_dormant",
        waiver: waiverRow ?? null,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
