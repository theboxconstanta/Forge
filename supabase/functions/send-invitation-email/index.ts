import { CORS } from "../_shared/invite.ts";

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const FROM_NAME = Deno.env.get("FROM_NAME") || "Forge Gym";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "luciandorinrosca@gmail.com";

// Reuses Forge's existing Brevo integration (same API key, same sender
// identity, same template wrapper as send-notification) - a new, small,
// dedicated function rather than forcing this into send-notification's
// own authorization model, which is built around notifying an EXISTING
// target Member (a real gym_id, a real caller-target relationship) and
// does not fit a brand-new prospect who may have no profiles row at all
// yet. Called only by other Edge Functions (admin-invite-member,
// invitation-challenge) using the service-role client - never exposed to
// a browser directly.
function emailTemplate(html: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff">
  <div style="text-align:center;margin-bottom:24px;padding:20px;background:#3C3489;border-radius:16px">
    <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px">FORGE</div>
  </div>
  <div style="background:#f8f8ff;border-radius:16px;padding:24px;margin-bottom:16px;color:#1a1a1a">
    ${html}
  </div>
  <p style="font-size:11px;color:#aaa;text-align:center;margin-top:16px">Forge</p>
</div>`;
}

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
  if (!res.ok) console.error("send-invitation-email: Brevo error", res.status, body);
  return { ok: res.ok, status: res.status, body };
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.type === "code") {
      const { to, gymName, code } = body;
      if (!to || !code) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: CORS });
      const html = `<p style="font-size:14px;margin:0 0 12px">Your verification code for joining <strong>${gymName ?? "your gym"}</strong> on Forge:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;padding:16px;background:#fff;border-radius:10px;margin:12px 0">${code}</div>
        <p style="font-size:12px;color:#666;margin:12px 0 0">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`;
      const result = await sendEmail(to, "Your Forge verification code", html);
      return new Response(JSON.stringify(result), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // default: invitation link
    const { to, gymName, link } = body;
    if (!to || !link) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: CORS });
    const html = `<p style="font-size:14px;margin:0 0 12px">You've been invited to join <strong>${gymName ?? "a gym"}</strong> on Forge.</p>
      <p style="font-size:14px;margin:0 0 16px">Click below to get started:</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#ABE73C;color:#0E0E0E;border-radius:10px;text-decoration:none;font-weight:600">Join Forge</a>
      <p style="font-size:12px;color:#666;margin:16px 0 0">This link expires in 72 hours.</p>`;
    const result = await sendEmail(to, `You're invited to join ${gymName ?? "Forge"}`, html);
    return new Response(JSON.stringify(result), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-invitation-email: unhandled exception:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
