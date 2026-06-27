import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@forge.ro";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Forge Gym <onboarding@resend.dev>";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { member_email, type, plan_name, end_date } = await req.json();
    if (!member_email || !type) {
      return new Response(JSON.stringify({ error: "Missing member_email or type" }), { status: 400, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
        // Remove invalid subscriptions
        if ((e as { statusCode?: number }).statusCode === 410) {
          await supabase.from("push_subscriptions").delete()
            .eq("member_email", member_email.toLowerCase())
            .eq("subscription->endpoint", row.subscription.endpoint);
        }
      }
    }

    // Email via Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [member_email],
        subject: title,
        html: emailTemplate(html),
      }),
    });
    if (!emailRes.ok) console.error("Resend error:", await emailRes.text());

    return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
