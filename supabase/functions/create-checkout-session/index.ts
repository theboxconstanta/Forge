import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const TEST_MODE_GYM_ID = Deno.env.get("TEST_MODE_GYM_ID") || "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://forge-delta-ivory.vercel.app";
const ALLOWED_APP_ORIGINS = (Deno.env.get("ALLOWED_APP_ORIGINS") || "")
  .split(",").map((o) => o.trim()).filter(Boolean);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_PENDING_ORDER_EXPIRY_HOURS = 24;

// Decizie pura: se reutilizeaza Order-ul in asteptare al unui abonament deja
// pus in coada, sau e invechit/pentru alt plan si trebuie unul nou? Separata
// ca sa fie testabila fara Stripe/DB live - vezi index.test.ts. Codifica
// decizia de produs aprobata ("Optiunea A", Faza 5c, 2026-07-20): comenzile
// raman imuabile o data create, una invechita e pur si simplu abandonata,
// niciodata modificata.
export function decideOrderReuse({ existingQueued, requestedPlanId, nowMs, pendingOrderExpiryHours }: {
  existingQueued: { subscriptionId: string; planId: string; orderId: string; orderStatus: string; orderCreatedAtMs: number } | null;
  requestedPlanId: string;
  nowMs: number;
  pendingOrderExpiryHours: number;
}): { reuse: true; subscriptionId: string; orderId: string } | { reuse: false } {
  if (!existingQueued) return { reuse: false };
  if (existingQueued.planId !== requestedPlanId) return { reuse: false };
  if (existingQueued.orderStatus !== "pending") return { reuse: false };
  const ageMs = nowMs - existingQueued.orderCreatedAtMs;
  const windowMs = pendingOrderExpiryHours * 60 * 60 * 1000;
  if (ageMs > windowMs) return { reuse: false };
  return { reuse: true, subscriptionId: existingQueued.subscriptionId, orderId: existingQueued.orderId };
}

// Garda pura: o cheie secreta de test (sk_test_...) poate crea o Checkout
// Session DOAR pentru sala-sandbox desemnata - aplicare structurala a
// separarii de mediu din reviewul Fazei 5b, nu doar o conventie documentata.
// O cheie live (sk_live_...) nu are aceasta restrictie.
export function isGymAllowedForKey({ stripeSecretKey, gymId, testModeGymId }: {
  stripeSecretKey: string;
  gymId: string;
  testModeGymId: string;
}): boolean {
  const isTestKey = stripeSecretKey.startsWith("sk_test_");
  if (!isTestKey) return true;
  return !!testModeGymId && gymId === testModeGymId;
}

// Decizie pura: pe ce origine trimitem membrul dupa Stripe. Origin/Referer nu
// sunt niciodata de incredere fara validare pe o lista alba - un caller
// autentificat ar putea trimite orice header, iar un redirect nevalidat
// dupa o plata reala e un vector de phishing (chiar daca nu afecteaza alti
// utilizatori). "localhost" nu e un caz special in cod - e doar o valoare
// posibila in ALLOWED_APP_ORIGINS, tratata identic cu domeniul de productie.
export function resolveAppBaseUrl({ originHeader, refererHeader, allowedOrigins, fallback }: {
  originHeader: string | null;
  refererHeader: string | null;
  allowedOrigins: string[];
  fallback: string;
}): string {
  // Referer e rezerva doar cand Origin lipseste cu adevarat (null) - un Origin
  // PREZENT dar in afara listei albe merge direct la fallback, nu incearca
  // Referer ca a doua sansa (altfel un Origin fals ar putea fi ocolit trimitand
  // si un Referer valid).
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

export function buildCheckoutSessionParams({ orderId, gymId, subscriptionId, planName, unitAmountCents, currency, memberEmail, successUrlBase, cancelUrlBase }: {
  orderId: string;
  gymId: string;
  subscriptionId: string;
  planName: string;
  unitAmountCents: number;
  currency: string;
  memberEmail: string;
  successUrlBase: string;
  cancelUrlBase: string;
}) {
  return {
    mode: "payment" as const,
    client_reference_id: orderId,
    customer_email: memberEmail,
    line_items: [{
      price_data: {
        currency,
        unit_amount: unitAmountCents,
        product_data: { name: planName },
      },
      quantity: 1,
    }],
    metadata: { gym_id: gymId, subscription_id: subscriptionId, order_id: orderId },
    success_url: `${successUrlBase}?checkout=${orderId}`,
    cancel_url: cancelUrlBase,
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Lipsește autentificarea" }), { status: 401, headers: CORS });
    }

    const { subscription_plan_id } = await req.json();
    if (!subscription_plan_id) {
      return new Response(JSON.stringify({ error: "Missing subscription_plan_id" }), { status: 400, headers: CORS });
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Token invalid" }), { status: 401, headers: CORS });
    }

    // Toate apelurile RPC (create_subscription) folosesc token-ul membrului,
    // NU service_role - RPC-urile isi fac deja propria verificare de
    // auto-serviciu (Faza 5a); reimplementarea ei aici ar fi redundanta si
    // ar putea diverge de regula reala.
    const memberClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: profile, error: profileErr } = await memberClient
      .from("profiles").select("gym_id, email").eq("id", caller.id).maybeSingle();
    if (profileErr || !profile?.gym_id) {
      return new Response(JSON.stringify({ error: "Profil membru negăsit" }), { status: 404, headers: CORS });
    }

    if (!isGymAllowedForKey({ stripeSecretKey: STRIPE_SECRET_KEY, gymId: profile.gym_id, testModeGymId: TEST_MODE_GYM_ID })) {
      return new Response(JSON.stringify({ error: "Plățile online nu sunt disponibile pentru această sală în mediul de test" }), { status: 403, headers: CORS });
    }

    const { data: settingsRows } = await memberClient
      .from("app_settings").select("key, value").eq("gym_id", profile.gym_id);
    const enabled = settingsRows?.find((s: { key: string }) => s.key === "online_payments_enabled")?.value === "true";
    if (!enabled) {
      return new Response(JSON.stringify({ error: "Plățile online nu sunt activate pentru această sală" }), { status: 403, headers: CORS });
    }
    const pendingOrderExpiryHours = parseFloat(
      settingsRows?.find((s: { key: string }) => s.key === "pending_order_expiry_hours")?.value ?? ""
    ) || DEFAULT_PENDING_ORDER_EXPIRY_HOURS;

    const { data: plan, error: planErr } = await memberClient
      .from("subscription_plans").select("id, name, price").eq("id", subscription_plan_id).eq("gym_id", profile.gym_id).eq("is_active", true).maybeSingle();
    if (planErr || !plan) {
      return new Response(JSON.stringify({ error: "Plan negăsit" }), { status: 404, headers: CORS });
    }

    // Ultimul abonament in asteptare al acestui membru pentru ACELASI plan -
    // singurul caz relevant pentru reutilizare (Sectiunea 2, reviewul Faza 5c).
    const { data: existingSub } = await memberClient
      .from("subscriptions")
      .select("id, plan_id, created_at, orders(id, status, created_at)")
      .eq("gym_id", profile.gym_id)
      .ilike("member_email", profile.email)
      .eq("is_active", false).eq("queued", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingOrder = Array.isArray(existingSub?.orders) ? existingSub?.orders[0] : existingSub?.orders;
    const reuseDecision = decideOrderReuse({
      existingQueued: existingSub && existingOrder ? {
        subscriptionId: existingSub.id,
        planId: existingSub.plan_id,
        orderId: existingOrder.id,
        orderStatus: existingOrder.status,
        orderCreatedAtMs: new Date(existingOrder.created_at).getTime(),
      } : null,
      requestedPlanId: subscription_plan_id,
      nowMs: Date.now(),
      pendingOrderExpiryHours,
    });

    let subscriptionId: string;
    let orderId: string;
    let totalAmount: number;

    if (reuseDecision.reuse) {
      subscriptionId = reuseDecision.subscriptionId;
      orderId = reuseDecision.orderId;
      const { data: order } = await memberClient.from("orders").select("total_amount").eq("id", orderId).maybeSingle();
      totalAmount = Number(order?.total_amount || 0);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const { data: subResult, error: subErr } = await memberClient.rpc("create_subscription", {
        p_member_email: profile.email,
        p_plan_id: subscription_plan_id,
        p_start_date: today,
        p_end_date: today,
        p_amount_paid: null,
        p_currency: "RON",
      });
      if (subErr || !subResult?.[0]) {
        console.error("create_subscription failed:", subErr?.message);
        return new Response(JSON.stringify({ error: "Nu s-a putut crea abonamentul" }), { status: 500, headers: CORS });
      }
      subscriptionId = subResult[0].subscription_id;
      const { data: order } = await memberClient.from("orders").select("id, total_amount").eq("subscription_id", subscriptionId).maybeSingle();
      if (!order) {
        console.error("No order found after create_subscription for", subscriptionId);
        return new Response(JSON.stringify({ error: "Comandă negăsită" }), { status: 500, headers: CORS });
      }
      orderId = order.id;
      totalAmount = Number(order.total_amount || 0);
    }

    // Intoarce membrul pe orice frontend a pornit checkout-ul (localhost in
    // dev, domeniul de productie in prod) - Origin e verificat intai (setat
    // automat de browser, nu poate fi manipulat din JS), Referer e rezerva
    // pentru cazul rar in care Origin lipseste. Niciunul nu e de incredere
    // fara ALLOWED_APP_ORIGINS; fara potrivire, ramane APP_BASE_URL de mai
    // devreme, exact comportamentul dinainte de acest fix.
    const resolvedAppBaseUrl = resolveAppBaseUrl({
      originHeader: req.headers.get("origin"),
      refererHeader: req.headers.get("referer"),
      allowedOrigins: ALLOWED_APP_ORIGINS,
      fallback: APP_BASE_URL,
    });

    const params = buildCheckoutSessionParams({
      orderId,
      gymId: profile.gym_id,
      subscriptionId,
      planName: plan.name,
      unitAmountCents: Math.round(totalAmount * 100),
      currency: "ron",
      memberEmail: profile.email,
      // "/subscription" nu e o ruta reala - aplicatia nu are router (ecranele
      // sunt un state React `screen`, nu path-uri), si nu exista vercel.json
      // cu un rewrite catre index.html pentru alte cai. "/" e singura cale
      // care chiar serveste aplicatia; handler-ul ?checkout= (App.jsx) oricum
      // citeste doar query string-ul, niciodata pathname-ul.
      successUrlBase: resolvedAppBaseUrl,
      cancelUrlBase: resolvedAppBaseUrl,
    });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `checkout_session:${orderId}`,
    });

    if (!session.url) {
      return new Response(JSON.stringify({ error: "Stripe nu a returnat un URL de checkout" }), { status: 502, headers: CORS });
    }

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
