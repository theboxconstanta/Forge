import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@forge.ro";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const FROM_NAME = Deno.env.get("FROM_NAME") || "Forge Gym";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "luciandorinrosca@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

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

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  // Fereastra: clase care incep intre 50 si 70 minute de acum
  const windowStart = new Date(now.getTime() + 50 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 70 * 60 * 1000);

  // Extrage data si intervalul de ore pentru query
  const toDateStr = (d: Date) => d.toISOString().split("T")[0];
  const toTimeStr = (d: Date) => d.toISOString().split("T")[1].slice(0, 8); // HH:MM:SS

  // Clase din zilele acoperite de fereastra (poate span midnight)
  const dates = [...new Set([toDateStr(windowStart), toDateStr(windowEnd)])];

  const { data: classes, error: classErr } = await supabase
    .from("classes")
    .select("id, name, date, start_time, coach")
    .in("date", dates);

  if (classErr) {
    console.error("classes fetch error", classErr);
    return new Response(JSON.stringify({ error: String(classErr) }), { status: 500 });
  }

  // Filtreaza clasele al caror start e in fereastra
  const targetClasses = (classes || []).filter((c) => {
    const classStart = new Date(`${c.date}T${c.start_time}`);
    return classStart >= windowStart && classStart <= windowEnd;
  });

  if (targetClasses.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  let sent = 0;

  for (const cls of targetClasses) {
    // Toti membrii rezervati la aceasta clasa
    const { data: bookings } = await supabase
      .from("bookings")
      .select("member_id")
      .eq("class_id", cls.id);

    if (!bookings?.length) continue;

    const memberIds = bookings.map((b: { member_id: string }) => b.member_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", memberIds);

    for (const profile of profiles || []) {
      const email = profile.email?.toLowerCase();
      if (!email) continue;

      // Deduplicare: skip daca am trimis deja pentru aceasta (clasa, email)
      const { data: existing } = await supabase
        .from("class_reminder_log")
        .select("class_id")
        .eq("class_id", cls.id)
        .eq("member_email", email)
        .maybeSingle();

      if (existing) continue;

      // Inregistreaza inainte de trimitere (previne duplicatele chiar daca trimiterea esueaza)
      await supabase.from("class_reminder_log").insert({ class_id: cls.id, member_email: email });

      const ora = cls.start_time?.slice(0, 5) || "";
      const title = `⏰ Clasă în 1 oră — ${cls.name}${ora ? ` la ${ora}` : ""}`;
      const body  = `Te așteptăm la ${cls.name}${ora ? ` la ora ${ora}` : ""}. Pregătește-te!`;
      const html  = `<h2 style="color:#3C3489">Clasă în 1 oră!</h2>
                     <p>Ai rezervare la <strong>${cls.name}</strong>${ora ? ` la ora <strong>${ora}</strong>` : ""}.</p>
                     <p>Pregătește-te și te așteptăm! 💪</p>`;

      // Push notification
      const { data: pushSubs } = await supabase
        .from("push_subscriptions")
        .select("subscription")
        .eq("member_email", email);

      for (const row of pushSubs || []) {
        try {
          await webpush.sendNotification(
            row.subscription,
            JSON.stringify({ title, body, icon: "/pwa-192x192.png", badge: "/pwa-64x64.png" })
          );
        } catch (e) {
          console.error("Push failed for", email, e);
          if ((e as { statusCode?: number }).statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("member_email", email);
          }
        }
      }

      // Email via Brevo
      try {
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
      } catch (e) {
        console.error("Brevo fetch failed for", email, e);
      }

      sent++;
    }
  }

  return new Response(
    JSON.stringify({ checked: now.toISOString(), classes: targetClasses.length, sent }),
    { headers: { "Content-Type": "application/json" } }
  );
});
