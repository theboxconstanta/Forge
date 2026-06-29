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

  // Toate reminderele scadente: remind_at <= acum si nesent
  const { data: reminders, error } = await supabase
    .from("class_reminders")
    .select("id, class_id, member_email, remind_at")
    .lte("remind_at", new Date().toISOString())
    .eq("sent", false);

  if (error) {
    console.error("fetch reminders error", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }

  if (!reminders?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  // Incarca detaliile claselor o singura data
  const classIds = [...new Set(reminders.map(r => r.class_id))];
  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, start_time")
    .in("id", classIds);

  const classMap: Record<string, { name: string; start_time: string }> = {};
  for (const c of classes || []) classMap[c.id] = c;

  let sent = 0;

  for (const reminder of reminders) {
    // Marcheaza inainte de trimitere — previne duplicatele chiar daca trimiterea esueaza
    await supabase.from("class_reminders").update({ sent: true }).eq("id", reminder.id);

    const cls = classMap[reminder.class_id];
    const ora = cls?.start_time?.slice(0, 5) || "";
    const title = `⏰ Clasă în 1 oră${ora ? ` · ${ora}` : ""}`;
    const body  = `Ai rezervare la ${cls?.name || "clasă"}${ora ? ` la ora ${ora}` : ""}. Pregătește-te!`;
    const html  = `<h2 style="color:#3C3489">Clasă în 1 oră!</h2>
                   <p>Ai rezervare la <strong>${cls?.name || "clasă"}</strong>${ora ? ` la ora <strong>${ora}</strong>` : ""}.</p>
                   <p>Pregătește-te și te așteptăm! 💪</p>`;

    const email = reminder.member_email;

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

  return new Response(
    JSON.stringify({ processed: reminders.length, sent }),
    { headers: { "Content-Type": "application/json" } }
  );
});
