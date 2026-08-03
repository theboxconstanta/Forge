import { assertEquals } from "@std/assert";
import { decidePlatformOrderReuse, buildIdempotencyKey, resolveAppBaseUrl, buildCheckoutSessionParams, isGymAllowedForKey } from "./index.ts";

const subId = "11111111-1111-1111-1111-111111111111";
const orderId = "22222222-2222-2222-2222-222222222222";
const gymA = "33333333-3333-3333-3333-333333333333";
const gymB = "44444444-4444-4444-4444-444444444444";

Deno.test("isGymAllowedForKey: a live key is unrestricted", () => {
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_live_abc", gymId: gymA, testModeGymId: gymB }), true);
});

Deno.test("isGymAllowedForKey: a test key only allows the designated sandbox gym", () => {
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_test_abc", gymId: gymB, testModeGymId: gymB }), true);
  assertEquals(isGymAllowedForKey({ stripeSecretKey: "sk_test_abc", gymId: gymA, testModeGymId: gymB }), false);
});

const HOUR = 60 * 60 * 1000;

Deno.test("decidePlatformOrderReuse: no existing pending subscription -> create fresh", () => {
  const result = decidePlatformOrderReuse({
    existingPending: null,
    nowMs: Date.now(),
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: false });
});

Deno.test("decidePlatformOrderReuse: fresh pending Order is reused", () => {
  const now = Date.now();
  const result = decidePlatformOrderReuse({
    existingPending: { subscriptionId: subId, orderId, orderCreatedAtMs: now - 1 * HOUR },
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: true, subscriptionId: subId, orderId });
});

Deno.test("decidePlatformOrderReuse: Order older than the configured window is not reused", () => {
  const now = Date.now();
  const result = decidePlatformOrderReuse({
    existingPending: { subscriptionId: subId, orderId, orderCreatedAtMs: now - 25 * HOUR },
    nowMs: now,
    pendingOrderExpiryHours: 24,
  });
  assertEquals(result, { reuse: false });
});

Deno.test("buildIdempotencyKey: same order + same time bucket -> identical key (dedupes a rapid double-click)", () => {
  const t0 = Date.now();
  const keyA = buildIdempotencyKey(orderId, t0, 24);
  const keyB = buildIdempotencyKey(orderId, t0 + 5000, 24);
  assertEquals(keyA, keyB);
});

Deno.test("buildIdempotencyKey: same order, bucket rolled over -> different key (forces a fresh Stripe Session after expiry)", () => {
  const t0 = Date.now();
  const keyA = buildIdempotencyKey(orderId, t0, 24);
  const keyB = buildIdempotencyKey(orderId, t0 + 25 * HOUR, 24);
  if (keyA === keyB) throw new Error("expected a different idempotency key after the session-expiry-width bucket rolled over");
});

Deno.test("resolveAppBaseUrl: allowed Origin header wins", () => {
  const result = resolveAppBaseUrl({
    originHeader: "https://app.example.com",
    refererHeader: null,
    allowedOrigins: ["https://app.example.com"],
    fallback: "https://fallback.example.com",
  });
  assertEquals(result, "https://app.example.com");
});

Deno.test("resolveAppBaseUrl: Origin present but not allowed -> fallback, Referer never tried", () => {
  const result = resolveAppBaseUrl({
    originHeader: "https://evil.example.com",
    refererHeader: "https://app.example.com/page",
    allowedOrigins: ["https://app.example.com"],
    fallback: "https://fallback.example.com",
  });
  assertEquals(result, "https://fallback.example.com");
});

Deno.test("buildCheckoutSessionParams: uses inline price_data, mode=payment, no pre-created Stripe Price", () => {
  const params = buildCheckoutSessionParams({
    orderId,
    planName: "Forge",
    unitAmountCents: 7900,
    currency: "EUR",
    ownerEmail: "owner@example.com",
    successUrlBase: "https://app.example.com",
    cancelUrlBase: "https://app.example.com",
  });
  assertEquals(params.mode, "payment");
  assertEquals(params.line_items[0].price_data.unit_amount, 7900);
  assertEquals(params.line_items[0].price_data.currency, "EUR");
  assertEquals(params.success_url, `https://app.example.com?platform_checkout=${orderId}`);
  assertEquals(params.cancel_url, "https://app.example.com");
});
