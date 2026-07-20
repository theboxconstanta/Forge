import { assertEquals } from "@std/assert";
import { extractOrderContext, validateOrderMatch, addMonthsClamped, handleRequest } from "./index.ts";

const orderId = "11111111-1111-1111-1111-111111111111";
const gymId = "22222222-2222-2222-2222-222222222222";
const subId = "33333333-3333-3333-3333-333333333333";
const otherGymId = "44444444-4444-4444-4444-444444444444";

function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: orderId,
        metadata: { gym_id: gymId, subscription_id: subId, order_id: orderId },
        payment_intent: "pi_test_123",
        amount_total: 15000,
        ...overrides,
      },
    },
  };
}

// 1. A fully-formed checkout.session.completed event extracts cleanly
Deno.test("extractOrderContext: well-formed event extracts all fields", () => {
  const result = extractOrderContext(checkoutCompletedEvent());
  assertEquals(result, { orderId, gymId, subscriptionId: subId, paymentIntentId: "pi_test_123", amountTotal: 15000 });
});

// 2. client_reference_id missing -> falls back to metadata.order_id
Deno.test("extractOrderContext: falls back to metadata.order_id when client_reference_id is absent", () => {
  const result = extractOrderContext(checkoutCompletedEvent({ client_reference_id: null }));
  assertEquals(result?.orderId, orderId);
});

// 3. Missing gym_id in metadata -> null (unrecoverable, not a transient failure)
Deno.test("extractOrderContext: missing gym_id metadata returns null", () => {
  const result = extractOrderContext(checkoutCompletedEvent({ metadata: { subscription_id: subId, order_id: orderId } }));
  assertEquals(result, null);
});

// 4. Unhandled event type -> null (the "ack, don't process" path)
Deno.test("extractOrderContext: unrelated event type returns null", () => {
  const result = extractOrderContext({ type: "payment_intent.succeeded", data: { object: {} } });
  assertEquals(result, null);
});

// 5. payment_intent can arrive as an expanded object, not just a string id
Deno.test("extractOrderContext: expanded payment_intent object still extracts the id", () => {
  const result = extractOrderContext(checkoutCompletedEvent({ payment_intent: { id: "pi_expanded_456" } }));
  assertEquals(result?.paymentIntentId, "pi_expanded_456");
});

// 6. Order genuinely not found -> mismatch
Deno.test("validateOrderMatch: order not found is rejected", () => {
  const result = validateOrderMatch({ order: null, context: { orderId, gymId, amountTotal: 15000 } });
  assertEquals(result, { ok: false, reason: "order not found" });
});

// 7. Order already paid (duplicate webhook delivery) -> rejected here, but
// the caller treats this as an expected idempotent no-op, not an error (see
// index.ts's 200-with-warning branch)
Deno.test("validateOrderMatch: already-paid order is rejected as a mismatch (idempotent case)", () => {
  const result = validateOrderMatch({
    order: { id: orderId, gym_id: gymId, status: "paid", total_amount: 150 },
    context: { orderId, gymId, amountTotal: 15000 },
  });
  assertEquals(result, { ok: false, reason: "order already paid" });
});

// 8. Gym mismatch -> rejected (should never happen if metadata was set
// correctly at Session creation, but must be checked, not assumed)
Deno.test("validateOrderMatch: gym mismatch between Order and event metadata is rejected", () => {
  const result = validateOrderMatch({
    order: { id: orderId, gym_id: otherGymId, status: "pending", total_amount: 150 },
    context: { orderId, gymId, amountTotal: 15000 },
  });
  assertEquals(result.ok, false);
});

// 9. Amount mismatch (cents vs. the Order's RON total_amount) -> rejected
Deno.test("validateOrderMatch: amount mismatch is rejected", () => {
  const result = validateOrderMatch({
    order: { id: orderId, gym_id: gymId, status: "pending", total_amount: 150 },
    context: { orderId, gymId, amountTotal: 14999 },
  });
  assertEquals(result.ok, false);
});

// 10. Exact match -> ok
Deno.test("validateOrderMatch: pending order with matching gym and amount is accepted", () => {
  const result = validateOrderMatch({
    order: { id: orderId, gym_id: gymId, status: "pending", total_amount: 150 },
    context: { orderId, gymId, amountTotal: 15000 },
  });
  assertEquals(result, { ok: true });
});

// 11-18. addMonthsClamped: identical cases to src/utils.test.js's suite for
// the same function, to keep the Deno reimplementation provably in sync
// with the frontend's activation-date logic (self-service in-app,
// admin-manual, and now webhook-driven activation must all compute the same
// end_date for the same plan/duration).
Deno.test("addMonthsClamped: Jan 31 + 1 month clamps to Feb 28 (non-leap)", () => {
  assertEquals(addMonthsClamped(new Date("2026-01-31T00:00:00"), 1), "2026-02-28");
});
Deno.test("addMonthsClamped: Jan 31 + 1 month clamps to Feb 29 (leap year)", () => {
  assertEquals(addMonthsClamped(new Date("2024-01-31T00:00:00"), 1), "2024-02-29");
});
Deno.test("addMonthsClamped: Mar 31 + 1 month clamps to Apr 30", () => {
  assertEquals(addMonthsClamped(new Date("2026-03-31T00:00:00"), 1), "2026-04-30");
});
Deno.test("addMonthsClamped: Aug 31 + 1 month clamps to Sep 30", () => {
  assertEquals(addMonthsClamped(new Date("2026-08-31T00:00:00"), 1), "2026-09-30");
});
Deno.test("addMonthsClamped: Nov 30 + 3 months clamps to Feb 28", () => {
  assertEquals(addMonthsClamped(new Date("2026-11-30T00:00:00"), 3), "2027-02-28");
});
Deno.test("addMonthsClamped: Dec 31 + 1 month -> Jan 31 (no clamping needed)", () => {
  assertEquals(addMonthsClamped(new Date("2026-12-31T00:00:00"), 1), "2027-01-31");
});
Deno.test("addMonthsClamped: mid-month date, no clamping needed", () => {
  assertEquals(addMonthsClamped(new Date("2026-05-15T00:00:00"), 1), "2026-06-15");
});
Deno.test("addMonthsClamped: regular case", () => {
  assertEquals(addMonthsClamped(new Date("2026-09-04T00:00:00"), 1), "2026-10-04");
});

// 19. Missing stripe-signature header -> 400 before any I/O (raw body isn't
// even read as trusted data without it)
Deno.test("request with no stripe-signature header is rejected with 400 before any I/O", async () => {
  const req = new Request("https://example.invalid/stripe-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "checkout.session.completed" }),
  });
  const res = await handleRequest(req);
  assertEquals(res.status, 400);
});

// 20. A present but invalid signature is rejected, never parsed as trusted
Deno.test("request with an invalid stripe-signature is rejected with 400", async () => {
  const req = new Request("https://example.invalid/stripe-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=not_a_real_signature" },
    body: JSON.stringify({ type: "checkout.session.completed" }),
  });
  const res = await handleRequest(req);
  assertEquals(res.status, 400);
});
