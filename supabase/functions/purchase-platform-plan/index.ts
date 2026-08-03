import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://forge-delta-ivory.vercel.app";
const ALLOWED_APP_ORIGINS = (Deno.env.get("ALLOWED_APP_ORIGINS") || "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const TEST_MODE_GYM_ID = Deno.env.get("TEST_MODE_GYM_ID") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// M10.5 Platform Purchase Flow - Checkout initiation. Owner-only
// (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 11.2); this
// function never decides authorization itself - it resolves the caller's
// own gym_id, then lets purchase_platform_plan's own is_platform_billing_
// owner() check be the actual authority (Principle: no client, and no
// Edge Function, owns business logic).
//
// Reuse-window and idempotency-key logic are a deliberate, direct port of
// create-checkout-session.ts's own proven decideOrderReuse/idempotencyKey
// shapes (M10.5_PRODUCT_DECISIONS.md Decisions 1/5/4) - copied as a
// *pattern*, into this domain's own separate mechanism, never by importing
// from or sharing code with the Financial Domain's own function (Principle
// 3.2 - reuse the architecture, never the mechanism).
const PENDING_ORDER_EXPIRY_HOURS = 24;
// Stripe's own default Checkout Session expiry. The idempotency key below
// is bucketed to this same width specifically so a key never outlives the
// Stripe Session it was minted for (M10.5_PRODUCT_DECISIONS.md Decision 4 -
// the corrected key scheme, not a straight copy of the existing Member-
// billing scheme, which does not have this bucket and carries a latent,
// previously-unexamined risk of Stripe returning a stale, expired Session
// object on a key collision after expiry).
const STRIPE_SESSION_EXPIRY_HOURS = 24;

export function decidePlatformOrderReuse({ existingPending, nowMs, pendingOrderExpiryHours }: {
  existingPending: { subscriptionId: string; orderId: string; orderCreatedAtMs: number } | null;
  nowMs: number;
  pendingOrderExpiryHours: number;
}): { reuse: true; subscriptionId: string; orderId: string } | { reuse: false } {
  if (!existingPending) return { reuse: false };
  const ageMs = nowMs - existingPending.orderCreatedAtMs;
  const windowMs = pendingOrderExpiryHours * 60 * 60 * 1000;
  if (ageMs > windowMs) return { reuse: false };
  return { reuse: true, subscriptionId: existingPending.subscriptionId, orderId: existingPending.orderId };
}

// Direct port of create-checkout-session.ts's own isGymAllowedForKey - a
// real, live, proven safety mechanism this function originally shipped
// without (caught during production verification, before any live HTTP
// call was ever made against this function, not after an incident). A
// test-mode Stripe key (sk_test_...) may only ever create a real Checkout
// Session for the one designated sandbox Gym; a live key (sk_live_...) is
// unrestricted. Structural enforcement, not a documented convention -
// whichever key is actually deployed, this stays correct without anyone
// needing to remember which environment they're pointed at.
export function isGymAllowedForKey({ stripeSecretKey, gymId, testModeGymId }: {
  stripeSecretKey: string;
  gymId: string;
  testModeGymId: string;
}): boolean {
  const isTestKey = stripeSecretKey.startsWith("sk_test_");
  if (!isTestKey) return true;
  return !!testModeGymId && gymId === testModeGymId;
}

export function buildIdempotencyKey(orderId: string, nowMs: number, sessionExpiryHours: number): string {
  const bucket = Math.floor(nowMs / (sessionExpiryHours * 60 * 60 * 1000));
  return `platform_checkout:${orderId}:${bucket}`;
}

// Same Origin-then-Referer-allowlist decision as create-checkout-session.ts's
// own resolveAppBaseUrl, duplicated rather than imported (Principle 3.2) -
// a small, pure, self-contained function, not a financial mechanism.
export function resolveAppBaseUrl({ originHeader, refererHeader, allowedOrigins, fallback }: {
  originHeader: string | null;
  refererHeader: string | null;
  allowedOrigins: string[];
  fallback: string;
}): string {
  if (originHeader !== null) {
    return allowedOrigins.includes(originHeader) ? originHeader : fallback;
  }
  if (refererHeader) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(refererHeader).origin;
    } catch {
      refererOrigin = null;
    }
    if (refererOrigin && allowedOrigins.includes(refererOrigin)) return refererOrigin;
  }
  return fallback;
}

export function buildCheckoutSessionParams({ orderId, planName, unitAmountCents, currency, ownerEmail, successUrlBase, cancelUrlBase }: {
  orderId: string;
  planName: string;
  unitAmountCents: number;
  currency: string;
  ownerEmail: string;
  successUrlBase: string;
  cancelUrlBase: string;
}) {
  // mode: 'payment', not 'subscription' - Forge's own commercial clock
  // (advance_trial_state-style scheduled commands, OWNER_DOMAIN_
  // IMPLEMENTATION_ARCHITECTURE.md Section 6.6/12.5) drives renewal, not
  // Stripe's native recurring-subscription engine, mirroring exactly why
  // create-checkout-session.ts also uses mode:'payment' for Member billing.
  // Renewal charging is explicitly out of M10.5's own scope (docs/
  // architecture/PLATFORM_BILLING_MODEL.md's own deferred "Future Price
  // Change Policy" question) - each purchase is its own one-time Checkout.
  return {
    mode: "payment" as const,
    client_reference_id: orderId,
    customer_email: ownerEmail,
    line_items: [{
      // Inline price_data, never a pre-created Stripe Product/Price
      // (M10.5_PRODUCT_DECISIONS.md Decision 6 - the proven, live pattern
      // create-checkout-session.ts already uses; PLATFORM_BILLING_MODEL.md's
      // earlier Stripe-mapping recommendation is superseded by this).
      price_data: {
        currency,
        unit_amount: unitAmountCents,
        product_data: { name: planName },
      },
      quantity: 1,
    }],
    metadata: { order_id: orderId },
    success_url: `${successUrlBase}?platform_checkout=${orderId}`,
    cancel_url: cancelUrlBase,
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing authentication" }), { status: 401, headers: CORS });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
    }

    // Caller's own bearer token throughout, never service_role - every RPC
    // call below runs under the caller's own session, exactly as Section
    // 11.2 requires (purchase_platform_plan's own is_platform_billing_
    // owner() check is the real authority; this client is how that check
    // ever sees the right auth.uid()).
    const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: adminRow, error: adminErr } = await ownerClient
      .from("admins").select("gym_id, email").eq("id", caller.id).maybeSingle();
    if (adminErr || !adminRow?.gym_id) {
      return new Response(JSON.stringify({ error: "No gym found for this account" }), { status: 404, headers: CORS });
    }
    const gymId = adminRow.gym_id;

    if (!isGymAllowedForKey({ stripeSecretKey: STRIPE_SECRET_KEY, gymId, testModeGymId: TEST_MODE_GYM_ID })) {
      return new Response(JSON.stringify({ error: "Platform billing is not available for this gym in the test environment" }), { status: 403, headers: CORS });
    }

    const { data: versions, error: versionsErr } = await ownerClient
      .from("platform_plan_versions").select("id").is("retired_at", null);
    if (versionsErr || !versions || versions.length !== 1) {
      console.error("purchase-platform-plan: expected exactly one active Platform Plan Version, found", versions?.length, versionsErr?.message);
      return new Response(JSON.stringify({ error: "Pricing is temporarily unavailable" }), { status: 503, headers: CORS });
    }
    const platformPlanVersionId = versions[0].id;

    // Reuse-window: an existing, still-fresh pending purchase for this gym
    // is reused rather than starting a second one (M10.5_PRODUCT_DECISIONS.md
    // Decision 5) - looked up via the Owner's own RLS-scoped read, exactly
    // mirroring create-checkout-session.ts's own existingSub/existingOrder
    // lookup shape.
    const { data: pendingSub } = await ownerClient
      .from("platform_subscriptions")
      .select("id, price_amount, currency, created_at, platform_orders(id, status, created_at)")
      .eq("gym_id", gymId)
      .eq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const pendingOrder = Array.isArray(pendingSub?.platform_orders) ? pendingSub?.platform_orders[0] : pendingSub?.platform_orders;
    const reuseDecision = decidePlatformOrderReuse({
      existingPending: pendingSub && pendingOrder && pendingOrder.status === "pending" ? {
        subscriptionId: pendingSub.id,
        orderId: pendingOrder.id,
        orderCreatedAtMs: new Date(pendingOrder.created_at).getTime(),
      } : null,
      nowMs: Date.now(),
      pendingOrderExpiryHours: PENDING_ORDER_EXPIRY_HOURS,
    });

    let orderId: string;
    let totalAmount: number;
    let currency: string;

    if (reuseDecision.reuse) {
      orderId = reuseDecision.orderId;
      totalAmount = pendingSub!.price_amount;
      currency = pendingSub!.currency;
    } else {
      const { data: purchaseResult, error: purchaseErr } = await ownerClient
        .rpc("purchase_platform_plan", { p_gym_id: gymId, p_platform_plan_version_id: platformPlanVersionId })
        .single();
      if (purchaseErr || !purchaseResult) {
        console.error("purchase-platform-plan: purchase_platform_plan failed:", purchaseErr?.message);
        return new Response(JSON.stringify({ error: purchaseErr?.message || "Could not start purchase" }), { status: 400, headers: CORS });
      }
      orderId = purchaseResult.platform_order_id;
      totalAmount = purchaseResult.total_amount;
      currency = purchaseResult.currency;
    }

    const resolvedAppBaseUrl = resolveAppBaseUrl({
      originHeader: req.headers.get("origin"),
      refererHeader: req.headers.get("referer"),
      allowedOrigins: ALLOWED_APP_ORIGINS,
      fallback: APP_BASE_URL,
    });

    const params = buildCheckoutSessionParams({
      orderId,
      planName: "Forge",
      unitAmountCents: totalAmount,
      currency,
      ownerEmail: adminRow.email,
      successUrlBase: resolvedAppBaseUrl,
      cancelUrlBase: resolvedAppBaseUrl,
    });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: buildIdempotencyKey(orderId, Date.now(), STRIPE_SESSION_EXPIRY_HOURS),
    });

    if (!session.url) {
      return new Response(JSON.stringify({ error: "Stripe did not return a checkout URL" }), { status: 502, headers: CORS });
    }

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("purchase-platform-plan error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
