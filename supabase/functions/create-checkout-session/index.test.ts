import { assertEquals } from "@std/assert";
import { decideOrderReuse, isGymAllowedForKey, buildCheckoutSessionParams, handleRequest } from "./index.ts";

const planA = "11111111-1111-1111-1111-111111111111";
const planB = "22222222-2222-2222-2222-222222222222";
const subId = "33333333-3333-3333-3333-333333333333";
const orderId = "44444444-4444-4444-4444-444444444444";
const gymA = "55555555-5555-5555-5555-555555555555";
const gymB = "66666666-6666-6666-6666-666666666666";

const HOUR = 60 * 60 * 1000;

// 1. No existing queued subscription -> always a fresh Order
Deno.test("decideOrderReuse: no existing queued subscription -> create fresh", () => {
  const result = decideOrderReuse({
    existingQueued: null,
    requestedPlanId: planA,
    nowMs: Date.now(),
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: false });
});

// 2. Existing, same plan, fresh, still pending -> reuse
Deno.test("decideOrderReuse: fresh pending Order for the same plan is reused", () => {
  const now = Date.now();
  const result = decideOrderReuse({
    existingQueued: { subscriptionId: subId, planId: planA, orderId, orderStatus: "pending", orderCreatedAtMs: now - 1 * HOUR },
    requestedPlanId: planA,
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: true, subscriptionId: subId, orderId });
});

// 3. Existing, but for a DIFFERENT plan -> not reused even if fresh
Deno.test("decideOrderReuse: existing pending Order for a different plan is not reused", () => {
  const now = Date.now();
  const result = decideOrderReuse({
    existingQueued: { subscriptionId: subId, planId: planA, orderId, orderStatus: "pending", orderCreatedAtMs: now - 1 * HOUR },
    requestedPlanId: planB,
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: false });
});

// 4. Existing, same plan, but older than the configured window -> not reused
// (Option A: the stale Order is simply abandoned, never mutated - a fresh
// one is created at whatever the plan's current price is.)
Deno.test("decideOrderReuse: pending Order older than the reuse window is not reused", () => {
  const now = Date.now();
  const result = decideOrderReuse({
    existingQueued: { subscriptionId: subId, planId: planA, orderId, orderStatus: "pending", orderCreatedAtMs: now - 25 * HOUR },
    requestedPlanId: planA,
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: false });
});

// 5. Existing, same plan, fresh, but already paid (a race/rare state) -> not
// reused - a paid Order should never be redirected back into checkout.
Deno.test("decideOrderReuse: an already-paid Order is never reused", () => {
  const now = Date.now();
  const result = decideOrderReuse({
    existingQueued: { subscriptionId: subId, planId: planA, orderId, orderStatus: "paid", orderCreatedAtMs: now - 1 * HOUR },
    requestedPlanId: planA,
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: false });
});

// 6. Boundary: exactly at the window edge is still fresh (inclusive test of
// "not yet past" rather than assuming which side of equality wins)
Deno.test("decideOrderReuse: an Order just under the window boundary is still reused", () => {
  const now = Date.now();
  const result = decideOrderReuse({
    existingQueued: { subscriptionId: subId, planId: planA, orderId, orderStatus: "pending", orderCreatedAtMs: now - (24 * HOUR - 1000) },
    requestedPlanId: planA,
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: true, subscriptionId: subId, orderId });
});

// 7. Test-mode key + sandbox gym -> allowed
Deno.test("isGymAllowedForKey: test-mode key allowed for the designated sandbox gym", () => {
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_test_abc", gymId: gymA, testModeGymId: gymA }), true);
});

// 8. Test-mode key + any other gym -> rejected (the structural environment guard)
Deno.test("isGymAllowedForKey: test-mode key rejected for a non-sandbox gym", () => {
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_test_abc", gymId: gymB, testModeGymId: gymA }), false);
});

// 9. Live-mode key -> allowed for any gym, no restriction
Deno.test("isGymAllowedForKey: live-mode key has no gym restriction", () => {
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_live_abc", gymId: gymB, testModeGymId: gymA }), true);
});

// 10. Test-mode key but no sandbox gym configured at all -> rejected, not
// silently allowed (a misconfiguration must fail closed, not open)
Deno.test("isGymAllowedForKey: test-mode key with no TEST_MODE_GYM_ID configured fails closed", () => {
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_test_abc", gymId: gymA, testModeGymId: "" }), false);
});

// 11. Checkout Session params: client_reference_id and metadata both carry
// the Order id (defense-in-depth per the Faza 5c security model review)
Deno.test("buildCheckoutSessionParams: order id present in both client_reference_id and metadata", () => {
  const params = buildCheckoutSessionParams({
    orderId, gymId: gymA, subscriptionId: subId, planName: "Unlimited",
    unitAmountCents: 15000, currency: "ron", memberEmail: "member@example.com",
    successUrlBase: "https://forge.example/subscription", cancelUrlBase: "https://forge.example/subscription",
  });
  assertEquals(params.client_reference_id, orderId);
  assertEquals(params.metadata, { gym_id: gymA, subscription_id: subId, order_id: orderId });
  assertEquals(params.mode, "payment");
  assertEquals(params.line_items[0].price_data.unit_amount, 15000);
  assertEquals(params.line_items[0].price_data.currency, "ron");
  assertEquals(params.success_url, `https://forge.example/subscription?checkout=${orderId}`);
});

// 12. Missing JWT -> handleRequest itself returns 401 before any I/O (no
// network call happens before the token check, same pattern as
// send-notification's equivalent test).
Deno.test("request with no Authorization header is rejected with 401 before any I/O", async () => {
  const req = new Request("https://example.invalid/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription_plan_id: planA }),
  });
  const res = await handleRequest(req);
  const body = await res.json();
  assertEquals(res.status, 401);
  assertEquals(body, { error: "Lipsește autentificarea" });
});
