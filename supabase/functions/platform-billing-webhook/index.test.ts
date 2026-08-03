import { assertEquals } from "@std/assert";
import { extractPlatformOrderContext, validatePlatformOrderMatch } from "./index.ts";

const orderId = "11111111-1111-1111-1111-111111111111";

Deno.test("extractPlatformOrderContext: ignores unhandled event types", () => {
  const result = extractPlatformOrderContext({ type: "customer.created", data: { object: {} } });
  assertEquals(result, null);
});

Deno.test("extractPlatformOrderContext: extracts orderId, paymentIntentId, amountTotal from a completed session", () => {
  const result = extractPlatformOrderContext({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: orderId, payment_intent: "pi_123", amount_total: 7900 } },
  });
  assertEquals(result, { orderId, paymentIntentId: "pi_123", amountTotal: 7900 });
});

Deno.test("extractPlatformOrderContext: falls back to metadata.order_id when client_reference_id is absent", () => {
  const result = extractPlatformOrderContext({
    type: "checkout.session.completed",
    data: { object: { metadata: { order_id: orderId }, payment_intent: { id: "pi_123" }, amount_total: 7900 } },
  });
  assertEquals(result, { orderId, paymentIntentId: "pi_123", amountTotal: 7900 });
});

Deno.test("extractPlatformOrderContext: missing order id -> null (a real problem, not a retryable one)", () => {
  const result = extractPlatformOrderContext({
    type: "checkout.session.completed",
    data: { object: { amount_total: 7900 } },
  });
  assertEquals(result, null);
});

Deno.test("validatePlatformOrderMatch: order not found", () => {
  const result = validatePlatformOrderMatch({ order: null, context: { orderId, amountTotal: 7900 } });
  assertEquals(result, { ok: false, reason: "order not found" });
});

Deno.test("validatePlatformOrderMatch: already-settled order -> expected duplicate-delivery no-op", () => {
  const result = validatePlatformOrderMatch({
    order: { id: orderId, status: "paid", total_amount: 7900 },
    context: { orderId, amountTotal: 7900 },
  });
  assertEquals(result, { ok: false, reason: "order already paid" });
});

Deno.test("validatePlatformOrderMatch: amount mismatch -> rejected, never trusted", () => {
  const result = validatePlatformOrderMatch({
    order: { id: orderId, status: "pending", total_amount: 7900 },
    context: { orderId, amountTotal: 500 },
  });
  assertEquals(result.ok, false);
});

Deno.test("validatePlatformOrderMatch: genuine match -> ok", () => {
  const result = validatePlatformOrderMatch({
    order: { id: orderId, status: "pending", total_amount: 7900 },
    context: { orderId, amountTotal: 7900 },
  });
  assertEquals(result, { ok: true });
});
