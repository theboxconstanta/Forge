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

// gymName vine acum din join-ul subscriptions -> gyms (Edge Function-ul
// ruleaza cu service-role, ocoleste RLS, deci vede orice sala) - fallback la
// "Forge" doar pt randuri orfane fara gym_id (nu ar trebui sa existe dupa
// Faza 1/3, dar mai sigur decat sa aratam un nume gol/undefined intr-un
// email real.
const emailTemplate = (html: string, gymName: string) => `
<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff">
  <div style="text-align:center;margin-bottom:24px;padding:20px;background:#3C3489;border-radius:16px">
    <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px">FORGE</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:3px">${gymName.toUpperCase()}</div>
  </div>
  <div style="background:#f8f8ff;border-radius:16px;padding:24px;margin-bottom:16px;color:#1a1a1a">
    ${html}
  </div>
  <p style="font-size:11px;color:#aaa;text-align:center;margin-top:16px">Forge Gym · ${gymName}</p>
</div>`;

async function notify(
  supabase: ReturnType<typeof createClient>,
  email: string,
  type: "expiring_3d" | "expiring_1d",
  planName: string,
  endDate: string,
  gymName: string
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
      htmlContent: emailTemplate(html, gymName),
    }),
  });
  if (!res.ok) console.error("Brevo error for", email, await res.text());
}

// Decide daca apikey-ul primit este chiar secret key-ul "default" al
// proiectului - singurul apelant de incredere pentru acest job (un
// scheduler, nu un utilizator din aplicatie). Pura / fara I/O ca sa poata
// fi testata fara un backend Supabase live - vezi index.test.ts. Exista
// DOAR pentru ca functia asta ruleaza pe service_role si, inainte de acest
// fix, nu facea NICIO verificare - era complet publica pe internet
// (verify_jwt=false), fara nicio autentificare (07-19, P0-005). Prima
// varianta a fix-ului (verify_jwt=true + comparatie pe headerul
// Authorization cu SUPABASE_SERVICE_ROLE_KEY legacy) s-a dovedit
// incompatibila cu noul model de API keys al proiectului - verify_jwt
// intelege doar JWT-uri legacy, nu si noile secret keys. Varianta de mai
// jos urmeaza "Option 1" din ghidul oficial de migrare Supabase:
// verify_jwt=false, header apikey, SUPABASE_SECRET_KEYS (dictionar JSON
// dupa nume - singura cheie existenta azi in proiect e "default").
// Esueaza inchis (fail closed) la orice problema: header lipsa/gol, JSON
// invalid, sau cheia "default" absenta din dictionar.
export function isAuthorizedScheduler(apikeyHeader: string | null, secretKeysJson: string | undefined): boolean {
  if (!apikeyHeader || !secretKeysJson) return false;
  let secretKeys: Record<string, string>;
  try {
    secretKeys = JSON.parse(secretKeysJson);
  } catch {
    return false;
  }
  const expected = secretKeys?.["default"];
  if (!expected) return false;
  return apikeyHeader === expected;
}

async function handleRequest(req: Request): Promise<Response> {
  const apikeyHeader = req.headers.get("apikey") || null;
  if (!isAuthorizedScheduler(apikeyHeader, Deno.env.get("SUPABASE_SECRET_KEYS"))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const today = new Date().toISOString().split("T")[0];
  const in3days = addDays(today, 3);
  const in1day = addDays(today, 1);

  const { data: exp3 } = await supabase.from("subscriptions")
    .select("member_email, end_date, subscription_plans(name), gyms(name)")
    .eq("is_active", true).eq("end_date", in3days);

  const { data: exp1 } = await supabase.from("subscriptions")
    .select("member_email, end_date, subscription_plans(name), gyms(name)")
    .eq("is_active", true).eq("end_date", in1day);

  for (const sub of exp3 || []) {
    const planName = (sub.subscription_plans as { name?: string })?.name || "Abonament";
    const gymName = (sub.gyms as { name?: string })?.name || "Forge";
    await notify(supabase, sub.member_email, "expiring_3d", planName, sub.end_date, gymName);
  }
  for (const sub of exp1 || []) {
    const planName = (sub.subscription_plans as { name?: string })?.name || "Abonament";
    const gymName = (sub.gyms as { name?: string })?.name || "Forge";
    await notify(supabase, sub.member_email, "expiring_1d", planName, sub.end_date, gymName);
  }

  return new Response(
    JSON.stringify({ checked: today, exp3: exp3?.length ?? 0, exp1: exp1?.length ?? 0 }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// import.meta.main e false cand fisierul e importat (de index.test.ts) si
// true cand Supabase Edge Runtime il ruleaza direct - fara asta, importul
// din test ar porni un al doilea listener HTTP real.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
