import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

// Doar checkout.session.completed e ceva ce facem - orice alt tip de
// eveniment primit (daca vreodata ajunge, ex. o schimbare de configurare in
// dashboard) e confirmat cu 200 fara nicio actiune, nu tratat ca eroare -
// Stripe nu trebuie sa reincerce la nesfarsit un eveniment pe care oricum
// nu-l procesam (Sectiunea 8, reviewul Faza 5b).
const HANDLED_EVENT_TYPE = "checkout.session.completed";

// Extractie pura din evenimentul Stripe deja verificat (semnatura) - separata
// ca sa fie testabila cu un payload construit manual, fara sa fie nevoie de
// o semnatura Stripe reala. Metadata + client_reference_id sunt redundante
// intentionat (Sectiunea 3, reviewul Faza 5c) - daca unul lipseste, celalalt
// inca permite recuperarea contextului.
export function extractOrderContext(event: { type: string; data: { object: any } }): {
  orderId: string; gymId: string; subscriptionId: string; paymentIntentId: string | null; amountTotal: number;
} | null {
  if (event.type !== HANDLED_EVENT_TYPE) return null;
  const session = event.data.object;
  const orderId = session.client_reference_id || session.metadata?.order_id;
  const gymId = session.metadata?.gym_id;
  const subscriptionId = session.metadata?.subscription_id;
  if (!orderId || !gymId || !subscriptionId) return null;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : 0;
  return { orderId, gymId, subscriptionId, paymentIntentId, amountTotal };
}

// Verificare pura: comanda re-citita din baza de date (sursa de adevar)
// chiar corespunde evenimentului primit? Metadata nu e niciodata autorizare,
// doar un indicator - aceasta functie e "a doua verificare independenta"
// din modelul de securitate (Sectiunea 4, reviewul Faza 5c), nu o formalitate.
export function validateOrderMatch({ order, context }: {
  order: { id: string; gym_id: string; status: string; total_amount: number } | null;
  context: { orderId: string; gymId: string; amountTotal: number };
}): { ok: true } | { ok: false; reason: string } {
  if (!order) return { ok: false, reason: "order not found" };
  if (order.status !== "pending") return { ok: false, reason: `order already ${order.status}` };
  if (order.gym_id !== context.gymId) return { ok: false, reason: "gym mismatch" };
  const expectedCents = Math.round(Number(order.total_amount) * 100);
  if (expectedCents !== context.amountTotal) return { ok: false, reason: `amount mismatch (expected ${expectedCents}, got ${context.amountTotal})` };
  return { ok: true };
}

// Aceeasi logica exacta ca addMonthsClamped din src/utils.js (folosita de
// activateQueuedSubscription/adminActiveazaAboQueued in App.jsx) - trebuie
// sa produca un end_date identic indiferent de calea de activare
// (self-service in app, admin manual, sau acum webhook Stripe). Reimplementata
// aici (nu importata) fiindca App.jsx e cod de front-end, nefolosibil intr-un
// runtime Deno.
export function addMonthsClamped(startDate: Date, months: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const endDate = new Date(startDate);
  const targetMonth = endDate.getMonth() + months;
  endDate.setMonth(targetMonth);
  if (endDate.getMonth() !== ((targetMonth % 12) + 12) % 12) endDate.setDate(0);
  return `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok");

  try {
    const signature = req.headers.get("stripe-signature") || "";
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing stripe-signature" }), { status: 400 });
    }

    // Corpul RAW, inainte de orice parsare - verificarea semnaturii trebuie sa
    // vada exact bytes-ii trimisi de Stripe, nu o reserializare JSON.
    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY);
      // constructEventAsync (nu varianta sync) - runtime-ul Deno/edge foloseste
      // SubtleCrypto, care e inerent asincron.
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("stripe-webhook: signature verification failed:", err);
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
    }

    const context = extractOrderContext(event as unknown as { type: string; data: { object: any } });
    if (!context) {
      // Fie un tip de eveniment la care nu suntem abonati (normal, ack 200),
      // fie checkout.session.completed fara metadata (o problema reala la
      // crearea Session-ului, nu una tranzitorie - reincercarea Stripe nu ar
      // rezolva-o, deci tot 200, dar logata vizibil).
      if (event.type !== HANDLED_EVENT_TYPE) {
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      console.error("stripe-webhook: checkout.session.completed with missing order context", event.id);
      return new Response(JSON.stringify({ received: true, warning: "missing order context" }), { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: order, error: orderErr } = await supabase
      .from("orders").select("id, gym_id, status, total_amount").eq("id", context.orderId).maybeSingle();
    if (orderErr) {
      console.error("stripe-webhook: order lookup failed:", orderErr.message);
      return new Response(JSON.stringify({ error: "order lookup failed" }), { status: 500 });
    }

    const validation = validateOrderMatch({ order, context });
    if (!validation.ok) {
      // "already paid"/"already active" e idempotenta asteptata (livrare
      // dubla) - ack 200, nu eroare. Orice alta discrepanta (gym/suma) e o
      // problema de date reala, nu una pe care reincercarea o rezolva - tot
      // 200, dar logata ca sa fie vizibila.
      console.warn("stripe-webhook: order validation failed for", context.orderId, "-", validation.reason);
      return new Response(JSON.stringify({ received: true, warning: validation.reason }), { status: 200 });
    }

    const { data: paymentId, error: payErr } = await supabase.rpc("register_payment", {
      p_order_id: context.orderId,
      p_amount: order!.total_amount,
      p_status: "succeeded",
      p_method: "card",
      p_provider: "stripe",
      p_provider_reference: context.paymentIntentId,
    });
    if (payErr) {
      console.error("stripe-webhook: register_payment failed for order", context.orderId, ":", payErr.message);
      return new Response(JSON.stringify({ error: "register_payment failed" }), { status: 500 });
    }

    const { data: subRow } = await supabase
      .from("subscriptions")
      .select("plan_id, subscription_plans(duration_months)")
      .eq("id", context.subscriptionId)
      .maybeSingle();
    const planRow = Array.isArray(subRow?.subscription_plans) ? subRow?.subscription_plans[0] : subRow?.subscription_plans;
    const durationMonths = (planRow as { duration_months: number } | undefined)?.duration_months || 1;
    const endDate = addMonthsClamped(new Date(), durationMonths);

    const { error: activateErr } = await supabase.rpc("activate_queued_subscription", {
      p_subscription_id: context.subscriptionId,
      p_end_date: endDate,
    });
    if (activateErr) {
      // O a doua livrare a ACELUIASI eveniment ajunge aici dupa ce plata a
      // fost deja inregistrata (idempotent, fara eroare mai sus) - abonamentul
      // e deja activ, iar activate_queued_subscription respinge corect
      // "subscription not found" pentru o subscriptie care nu mai e queued.
      // Asta e rezultatul asteptat al livrarii duble (Faza 5a), nu o eroare
      // reala - ack 200.
      console.warn("stripe-webhook: activate_queued_subscription no-op/error for", context.subscriptionId, ":", activateErr.message);
      return new Response(JSON.stringify({ received: true, paymentId, warning: activateErr.message }), { status: 200 });
    }

    return new Response(JSON.stringify({ received: true, paymentId }), { status: 200 });
  } catch (err) {
    // Plasa de siguranta finala - orice eroare neasteptata (nu doar
    // semnatura invalida) trebuie sa produca un raspuns JSON controlat, nu
    // o eroare generica Deno/500 fara forma - Stripe reincearca oricum pe
    // orice non-2xx, deci comportamentul de retry nu se schimba.
    console.error("stripe-webhook: unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
