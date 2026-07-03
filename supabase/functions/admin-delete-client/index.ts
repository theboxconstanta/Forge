import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Lipsește autentificarea" }), { status: 401, headers: CORS });
    }

    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "Lipsește client_id" }), { status: 400, headers: CORS });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Token invalid" }), { status: 401, headers: CORS });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: callerAdminRow } = await admin.from("admins").select("id").eq("id", caller.id).maybeSingle();
    if (!callerAdminRow) {
      return new Response(JSON.stringify({ error: "Doar administratorii pot șterge clienți" }), { status: 403, headers: CORS });
    }

    const { data: target } = await admin.from("profiles").select("id, email").eq("id", client_id).maybeSingle();
    if (!target) {
      return new Response(JSON.stringify({ error: "Client inexistent" }), { status: 404, headers: CORS });
    }

    const { data: targetAdminRow } = await admin.from("admins").select("id").eq("id", client_id).maybeSingle();
    if (targetAdminRow) {
      return new Response(JSON.stringify({ error: "Nu poți șterge un cont de administrator" }), { status: 400, headers: CORS });
    }

    const email = (target.email || "").toLowerCase();

    // Sterge toate urmele membrului din tabelele care nu au ON DELETE CASCADE
    // catre profiles/auth.users, inainte sa stergem contul propriu-zis.
    await Promise.all([
      admin.from("bookings").delete().eq("member_id", client_id),
      admin.from("class_waitlist").delete().eq("member_id", client_id),
      admin.from("class_reminders").delete().eq("member_email", email),
      admin.from("wod_logs").delete().eq("member_id", client_id),
      admin.from("personal_records").delete().eq("member_id", client_id),
      admin.from("custom_hero_wods").delete().eq("member_id", client_id),
      admin.from("feed_posts").delete().eq("member_id", client_id),
      admin.from("feed_reactions").delete().eq("member_id", client_id),
      admin.from("feed_comments").delete().eq("member_id", client_id),
      admin.from("push_subscriptions").delete().eq("member_email", email),
      admin.from("subscriptions").delete().eq("member_email", email),
    ]);

    await admin.from("profiles").delete().eq("id", client_id);

    const { error: authDelErr } = await admin.auth.admin.deleteUser(client_id);
    if (authDelErr) {
      console.error("auth.admin.deleteUser error:", authDelErr);
      return new Response(JSON.stringify({ error: authDelErr.message }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("admin-delete-client error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
