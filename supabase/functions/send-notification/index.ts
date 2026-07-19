import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@forge.ro";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const FROM_NAME = Deno.env.get("FROM_NAME") || "Forge Gym";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "luciandorinrosca@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decide daca `caller` poate declansa o notificare de tipul `type` catre
// `target`. Pura / fara I/O ca sa poata fi testata fara un backend Supabase
// live - vezi index.test.ts. Exista DOAR pentru ca functia asta ruleaza pe
// service_role si, inainte de acest fix, nu facea NICIO verificare de
// autorizare - orice utilizator autentificat putea trimite orice tip de
// notificare catre orice membru, din orice sala (07-19, P0-004).
export function authorizeNotification({ type, callerAdminRow, callerCoachRow, callerProfile, target }: {
  type: string;
  callerAdminRow: { gym_id: string } | null;
  callerCoachRow: { gym_id: string } | null;
  callerProfile: { gym_id: string | null } | null;
  target: { gym_id: string | null } | null;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!target || !target.gym_id) {
    return { ok: false, status: 403, error: "Nu ai voie să trimiți această notificare" };
  }
  if (callerAdminRow && callerAdminRow.gym_id === target.gym_id) {
    return { ok: true };
  }
  if (callerCoachRow && callerCoachRow.gym_id === target.gym_id) {
    return { ok: true };
  }
  // Singurul caz in care un membru obisnuit (nici admin, nici coach)
  // declanseaza o notificare pentru ALT membru: auto-book de pe waitlist
  // dupa ce membrul isi anuleaza propria rezervare (App.jsx,
  // checkAndBookFromWaitlist) - ambii sunt garantat in aceeasi sala.
  if (type === "waitlist_booked" && callerProfile?.gym_id != null && callerProfile.gym_id === target.gym_id) {
    return { ok: true };
  }
  return { ok: false, status: 403, error: "Nu ai voie să trimiți această notificare" };
}

function getContent(type: string, planName: string, endDate: string) {
  const dateFmt = endDate
    ? new Date(endDate + "T00:00:00").toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" })
    : "";

  const map: Record<string, { title: string; body: string; html: string }> = {
    subscription_added: {
      title: "🎉 Abonament activat!",
      body: `Planul ${planName} este activ până pe ${dateFmt}.`,
      html: `<h2 style="color:#3C3489">Abonamentul tău a fost activat!</h2>
             <p>Planul <strong>${planName}</strong> este activ până pe <strong>${dateFmt}</strong>.</p>
             <p>Îți mulțumim și te așteptăm la antrenamente! 💪</p>`,
    },
    subscription_cancelled: {
      title: "🔒 Abonament anulat",
      body: "Abonamentul tău a fost anulat. Contactează coachul pentru detalii.",
      html: `<h2 style="color:#E24B4A">Abonamentul tău a fost anulat</h2>
             <p>Planul <strong>${planName}</strong> a fost anulat de administrator.</p>
             <p>Contactează-ne dacă ai întrebări sau consideră că e o eroare.</p>`,
    },
    expiring_3d: {
      title: "⚠️ Abonament expiră în 3 zile",
      body: `Planul ${planName} expiră pe ${dateFmt}. Reînnoiește-l acum!`,
      html: `<h2 style="color:#BA7517">Abonamentul tău expiră în 3 zile!</h2>
             <p>Planul <strong>${planName}</strong> expiră pe <strong>${dateFmt}</strong>.</p>
             <p>Contactează coachul pentru reînnoire înainte să pierzi accesul.</p>`,
    },
    expiring_1d: {
      title: "🚨 Abonamentul expiră MÂINE!",
      body: `Planul ${planName} expiră mâine (${dateFmt}). Acționează urgent!`,
      html: `<h2 style="color:#E24B4A">Abonamentul tău expiră mâine!</h2>
             <p>Planul <strong>${planName}</strong> expiră mâine, <strong>${dateFmt}</strong>.</p>
             <p>Contactează coachul <strong>urgent</strong> pentru reînnoire!</p>`,
    },
    class_added: {
      title: "✅ Ai fost adăugat la clasă!",
      body: `Ești rezervat la ${planName}${dateFmt ? ` pe ${dateFmt}` : ""}.`,
      html: `<h2 style="color:#2F6600">Ai fost adăugat la o clasă!</h2>
             <p>Coachul te-a rezervat la <strong>${planName}</strong>${dateFmt ? ` pe <strong>${dateFmt}</strong>` : ""}.
             <p>Te așteptăm la antrenament! 💪</p>`,
    },
    class_removed: {
      title: "❌ Rezervare anulată de coach",
      body: `Rezervarea ta la ${planName}${dateFmt ? ` din ${dateFmt}` : ""} a fost anulată.`,
      html: `<h2 style="color:#C62828">Rezervarea ta a fost anulată</h2>
             <p>Coachul a anulat rezervarea ta la <strong>${planName}</strong>${dateFmt ? ` din <strong>${dateFmt}</strong>` : ""}.
             <p>Contactează-ne dacă ai întrebări.</p>`,
    },
    waitlist_booked: {
      title: "🎉 Loc disponibil — ești rezervat!",
      body: `S-a eliberat un loc la ${planName}${dateFmt ? ` pe ${dateFmt}` : ""}. Ești acum rezervat automat!`,
      html: `<h2 style="color:#2F6600">S-a eliberat un loc!</h2>
             <p>Erai pe lista de așteptare pentru <strong>${planName}</strong>${dateFmt ? ` pe <strong>${dateFmt}</strong>` : ""}.
             <p>Ești acum <strong>rezervat automat</strong>. Te așteptăm! 💪</p>
             <p style="font-size:12px;color:#888">Dacă nu poți ajunge, anulează din aplicație.</p>`,
    },
  };

  return map[type] ?? map.subscription_added;
}

const emailTemplate = (html: string) => `
<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff">
  <div style="text-align:center;margin-bottom:24px;padding:20px;background:#3C3489;border-radius:16px">
    <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px">FORGE</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:3px">CROSSFIT C15</div>
  </div>
  <div style="background:#f8f8ff;border-radius:16px;padding:24px;margin-bottom:16px;color:#1a1a1a">
    ${html}
  </div>
  <p style="font-size:11px;color:#aaa;text-align:center;margin-top:16px">Forge Gym · CrossFit C15 · Constanța</p>
</div>`;

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: emailTemplate(html),
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("Brevo error", res.status, body);
  } else {
    console.log("Brevo ok", res.status, body);
  }
  return { ok: res.ok, status: res.status, body };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Lipsește autentificarea" }), { status: 401, headers: CORS });
    }

    const { member_email, type, plan_name, end_date } = await req.json();
    if (!member_email || !type) {
      return new Response(JSON.stringify({ error: "Missing member_email or type" }), { status: 400, headers: CORS });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Token invalid" }), { status: 401, headers: CORS });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [{ data: callerAdminRow }, { data: callerCoachRow }, { data: callerProfile }, { data: target }] = await Promise.all([
      supabase.from("admins").select("gym_id").eq("id", caller.id).maybeSingle(),
      supabase.from("coaches").select("gym_id").eq("id", caller.id).maybeSingle(),
      supabase.from("profiles").select("gym_id").eq("id", caller.id).maybeSingle(),
      supabase.from("profiles").select("gym_id").ilike("email", member_email).maybeSingle(),
    ]);

    const authz = authorizeNotification({ type, callerAdminRow, callerCoachRow, callerProfile, target });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error }), { status: authz.status, headers: CORS });
    }

    const { title, body, html } = getContent(type, plan_name || "", end_date || "");

    // Push notifications
    const { data: pushSubs } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("member_email", member_email.toLowerCase());

    for (const row of pushSubs || []) {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({ title, body, icon: "/pwa-192x192.png", badge: "/pwa-64x64.png" })
        );
      } catch (e) {
        console.error("Push failed:", e);
        if ((e as { statusCode?: number }).statusCode === 410) {
          await supabase.from("push_subscriptions").delete()
            .eq("member_email", member_email.toLowerCase());
        }
      }
    }

    // Email via Brevo
    const emailResult = await sendEmail(member_email, title, html);

    return new Response(JSON.stringify({ success: true, email: emailResult }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

// import.meta.main e false cand fisierul e importat (de index.test.ts) si
// true cand Supabase Edge Runtime il ruleaza direct - fara asta, importul
// din test ar porni un al doilea listener HTTP real.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
