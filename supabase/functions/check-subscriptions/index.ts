import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@forge.ro";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const FROM_NAME = Deno.env.get("FROM_NAME") || "Forge Gym";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "luciandorinrosca@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function getContent(type: "expiring_3d" | "expiring_1d", planName: string, endDate: string) {
  const dateFmt = new Date(endDate + "T00:00:00").toLocaleDateString("ro-RO", {
    day: "numeric", month: "long", year: "numeric",
  });
  if (type === "expiring_3d") return {
    title: "⚠️ Abonament expiră în 3 zile",
    body: `Planul ${planName} expiră pe ${dateFmt}. Reînnoiește-l acum!`,
    html: `<h2 style="color:#BA7517">Abonamentul tău expiră în 3 zile!</h2>
           <p>Planul <strong>${planName}</strong> expiră pe <strong>${dateFmt}</strong>.</p>
           <p>Contactează coachul pentru reînnoire înainte să pierzi accesul.</p>`,
  };
  return {
    title: "🚨 Abonamentul expiră MÂINE!",
    body: `Planul ${planName} expiră mâine (${dateFmt}). Acționează urgent!`,
    html: `<h2 style="color:#E24B4A">Abonamentul tău expiră mâine!</h2>
           <p>Planul <strong>${planName}</strong> expiră mâine, <strong>${dateFmt}</strong>.</p>
           <p>Contactează coachul <strong>urgent</strong> pentru reînnoire!</p>`,
  };
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

async function notify(
  supabase: ReturnType<typeof createClient>,
  email: string,
  type: "expiring_3d" | "expiring_1d",
  planName: string,
  endDate: string
) {
  const { title, body, html } = getContent(type, planName, endDate);

  const { data: pushSubs } = await supabase
    .from("push_subscriptions").select("subscription").eq("member_email", email.toLowerCase());
  for (const row of pushSubs || []) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, icon: "/pwa-192x192.png" }));
    } catch (e) {
      console.error("Push failed for", email, e);
    }
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email }],
      subject: title,
      htmlContent: emailTemplate(html),
    }),
  });
  if (!res.ok) console.error("Brevo error for", email, await res.text());
}

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const today = new Date().toISOString().split("T")[0];
  const in3days = addDays(today, 3);
  const in1day = addDays(today, 1);

  const { data: exp3 } = await supabase.from("subscriptions")
    .select("member_email, end_date, subscription_plans(name)")
    .eq("is_active", true).eq("end_date", in3days);

  const { data: exp1 } = await supabase.from("subscriptions")
    .select("member_email, end_date, subscription_plans(name)")
    .eq("is_active", true).eq("end_date", in1day);

  for (const sub of exp3 || []) {
    const planName = (sub.subscription_plans as { name?: string })?.name || "Abonament";
    await notify(supabase, sub.member_email, "expiring_3d", planName, sub.end_date);
  }
  for (const sub of exp1 || []) {
    const planName = (sub.subscription_plans as { name?: string })?.name || "Abonament";
    await notify(supabase, sub.member_email, "expiring_1d", planName, sub.end_date);
  }

  return new Response(
    JSON.stringify({ checked: today, exp3: exp3?.length ?? 0, exp1: exp1?.length ?? 0 }),
    { headers: { "Content-Type": "application/json" } }
  );
});
