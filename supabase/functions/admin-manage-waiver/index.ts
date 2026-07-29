import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errDetail, errorResponse } from "../_shared/invite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20000;

// M9 Waiver / Gym Rules Management. Same caller-verification shape as
// admin-invite-member/admin-add-member - gym_id is always derived from the
// caller's own admin row, never trusted from the client (Phase 5). Publish
// is the only write action: always an INSERT via m9_publish_waiver, never
// an UPDATE - historical rows are immutable by construction, not by
// convention (Phase 2/3).
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
    if (!callerAdminRow) return errorResponse("Doar administratorii pot gestiona regulamentul sălii", 403);
    const callerGymId = callerAdminRow.gym_id as string;

    if (action !== "publish") return errorResponse("Acțiune necunoscută", 400);

    step = "validate_input";
    const titleRaw = typeof body.title === "string" ? body.title.trim() : "";
    const contentRaw = typeof body.content === "string" ? body.content : "";
    const contentTrimmed = contentRaw.trim();
    if (!titleRaw) return errorResponse("Titlul este obligatoriu", 400);
    if (titleRaw.length > MAX_TITLE_LENGTH) return errorResponse(`Titlul poate avea cel mult ${MAX_TITLE_LENGTH} caractere`, 400);
    if (!contentTrimmed) return errorResponse("Conținutul regulamentului este obligatoriu", 400);
    if (contentRaw.length > MAX_CONTENT_LENGTH) return errorResponse(`Conținutul poate avea cel mult ${MAX_CONTENT_LENGTH} caractere`, 400);

    step = "publish_waiver";
    const { data: publishRows, error: publishErr } = await admin.rpc("m9_publish_waiver", {
      p_gym_id: callerGymId,
      p_actor_admin_id: caller.id,
      p_title: titleRaw,
      p_content_ref: contentRaw,
    });
    if (publishErr) {
      if (errDetail(publishErr).message?.includes("invalid_title")) return errorResponse("Titlul este obligatoriu", 400);
      if (errDetail(publishErr).message?.includes("invalid_content")) return errorResponse("Conținutul regulamentului este obligatoriu", 400);
      return errorResponse(errDetail(publishErr).message, 500);
    }
    const published = Array.isArray(publishRows) ? publishRows[0] : publishRows;

    return new Response(JSON.stringify({
      success: true,
      id: published.id,
      version: published.version,
      effective_date: published.effective_date,
      immediate: published.immediate,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-manage-waiver: unhandled exception at step", step, ":", err);
    return errorResponse(String(err), 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
