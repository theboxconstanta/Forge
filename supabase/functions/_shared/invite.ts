// Shared, small helpers for the M9 Invite Member Edge Functions. Not a
// general-purpose library - narrowly scoped to what this one capability
// needs, per the "do not build a generic rate-limiting/auth platform"
// discipline this feature was designed under.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Keyed HMAC, never a plain/unsalted hash - Final Auth-Handoff Security
// Report Section 7. The key lives only in this Edge Function runtime's own
// environment (INVITATION_HMAC_SECRET), never in the database, so a
// database-only exposure cannot be used to recover or verify guesses
// against either the invitation bearer token or the 6-digit email code.
export async function hmac(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomChallengeCode(): string {
  // 6 numeric digits, per the approved UX - the stored verifier is a keyed
  // HMAC of this, never this value itself.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}

export function errDetail(error: unknown) {
  const e = error as { message?: string; code?: string; details?: string; hint?: string; status?: number; name?: string } | null;
  return { message: e?.message ?? String(error), code: e?.code, details: e?.details, hint: e?.hint, status: e?.status, name: e?.name };
}

export function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Configuration values, not architectural constants (Final Implementation
// Plan Section 4) - centralised here so they are tuned in one place.
export const CHALLENGE_CODE_EXPIRY_MINUTES = 10;
export const CHALLENGE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_RESENDS = 5;
export const VERIFICATION_FRESHNESS_SECONDS = 30 * 60;
export const INVITATION_EXPIRY_HOURS = 72; // matches Transfer Code's own precedent

// Resolves and authorizes an invitation purely by bearer-token possession -
// no Supabase session is involved before Final Commit (Model D). Returns
// null for every failure reason uniformly (not found, wrong token, expired,
// revoked, already accepted) - the public onboarding UI shows one generic
// "this invitation link is no longer valid" state regardless of which,
// consistent with not disclosing anything about invitations belonging to
// other people/gyms.
export async function resolveInvitationByToken(
  admin: any,
  invitationId: string,
  rawToken: string,
  secret: string,
): Promise<Record<string, any> | null> {
  const { data: inv, error } = await admin.from("gym_invitations").select("*").eq("id", invitationId).maybeSingle();
  if (error || !inv) return null;
  if (inv.accepted_at || inv.revoked_at) return null;
  if (new Date(inv.expires_at).getTime() <= Date.now()) return null;
  const computed = await hmac(secret, rawToken);
  if (computed !== inv.token_hash) return null;
  return inv;
}
