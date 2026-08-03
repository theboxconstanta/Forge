import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
// A separate signing secret from the Member-billing webhook's own
// STRIPE_WEBHOOK_SECRET - a different Stripe-side endpoint has its own
// distinct secret by construction, never reused across endpoints
// (M10_IMPLEMENTATION_PLAN.md Section 6 - "a separate Edge Function and a
// separate Stripe webhook endpoint", verified explicitly at deploy time,
// not merely by this code existing).
const PLATFORM_STRIPE_WEBHOOK_SECRET = Deno.env.get("PLATFORM_STRIPE_WEBHOOK_SECRET") || "";

// M10.5 Platform Purchase Flow - webhook. A direct structural port of
// stripe-webhook/index.ts's own four-step sequence (verify signature ->
// re-derive Order from Forge's own record -> confirm claim matches ->
// invoke the one RPC any other verified-internal caller would) - Section
// 7.2's proven shape, copied as a *pattern* into this domain's own,
// separate mechanism (Principle 3.2/3.7 both satisfied simultaneously,
// exactly as OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.4
// itself frames it: "reusing Financial Domain's design is what Principle
// 3.7 asks for; reusing Financial Domain's tables would violate Principle
// 3.2 - the resolution is to copy the architecture, not the object").
//
// Simpler than stripe-webhook by one step: register_platform_payment
// itself atomically activates the Subscription and updates Gym Commercial
// State (companion migration's own documented reasoning) - there is no
// second "activate" RPC call here the way stripe-webhook needs
// activate_queued_subscription as a separate step.
const HANDLED_EVENT_TYPE = "checkout.session.completed";

export function extractPlatformOrderContext(event: { type: string; data: { object: any } }): {
  orderId: string; paymentIntentId: string | null; amountTotal: number;
} | null {
  if (event.type !== HANDLED_EVENT_TYPE) return null;
  const session = event.data.object;
  const orderId = session.client_reference_id || session.metadata?.order_id;
  if (!orderId) return null;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : 0;
  return { orderId, paymentIntentId, amountTotal };
}

export function validatePlatformOrderMatch({ order, context }: {
  order: { id: string; status: string; total_amount: number } | null;
  context: { orderId: string; amountTotal: number };
}): { ok: true } | { ok: false; reason: string } {
  if (!order) return { ok: false, reason: "order not found" };
  if (order.status !== "pending") return { ok: false, reason: `order already ${order.status}` };
  if (order.total_amount !== context.amountTotal) return { ok: false, reason: `amount mismatch (expected ${order.total_amount}, got ${context.amountTotal})` };
  return { ok: true };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok");

  try {
    const signature = req.headers.get("stripe-signature") || "";
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing stripe-signature" }), { status: 400 });
    }

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY);
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, PLATFORM_STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("platform-billing-webhook: signature verification failed:", err);
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
    }

    const context = extractPlatformOrderContext(event as unknown as { type: string; data: { object: any } });
    if (!context) {
      if (event.type !== HANDLED_EVENT_TYPE) {
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      console.error("platform-billing-webhook: checkout.session.completed with missing order context", event.id);
      return new Response(JSON.stringify({ received: true, warning: "missing order context" }), { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: order, error: orderErr } = await supabase
      .from("platform_orders").select("id, status, total_amount").eq("id", context.orderId).maybeSingle();
    if (orderErr) {
      console.error("platform-billing-webhook: order lookup failed:", orderErr.message);
      return new Response(JSON.stringify({ error: "order lookup failed" }), { status: 500 });
    }

    const validation = validatePlatformOrderMatch({ order, context });
    if (!validation.ok) {
      // "already paid" is expected idempotency (duplicate delivery) - ack
      // 200, not an error. Any other mismatch is a real data-quality
      // question to investigate (FINANCIAL_DOMAIN_ARCHITECTURE.md Section
      // 9.2's own principle, restated for this ledger), never retried
      // automatically - still ack 200 so Stripe does not retry forever on
      // a claim that will never become correct by being attempted again.
      console.warn("platform-billing-webhook: order validation failed for", context.orderId, "-", validation.reason);
      return new Response(JSON.stringify({ received: true, warning: validation.reason }), { status: 200 });
    }

    const { data: paymentId, error: payErr } = await supabase.rpc("register_platform_payment", {
      p_platform_order_id: context.orderId,
      p_amount: order!.total_amount,
      p_status: "succeeded",
      p_provider: "stripe",
      p_provider_reference: context.paymentIntentId,
    });
    if (payErr) {
      console.error("platform-billing-webhook: register_platform_payment failed for order", context.orderId, ":", payErr.message);
      return new Response(JSON.stringify({ error: "register_platform_payment failed" }), { status: 500 });
    }

    return new Response(JSON.stringify({ received: true, paymentId }), { status: 200 });
  } catch (err) {
    console.error("platform-billing-webhook: unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
