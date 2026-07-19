import { assertEquals } from "@std/assert";
import { authorizeNotification, handleRequest } from "./index.ts";

const gymA = "11111111-1111-1111-1111-111111111111";
const gymB = "22222222-2222-2222-2222-222222222222";

const targetInGymA = { gym_id: gymA };
const targetInGymB = { gym_id: gymB };
const noAdmin = null;
const noCoach = null;
const noProfile = null;

// 1. Admin -> same gym -> allowed
Deno.test("admin sending to a member of their own gym is allowed", () => {
  const result = authorizeNotification({
    type: "subscription_added",
    callerAdminRow: { gym_id: gymA },
    callerCoachRow: noCoach,
    callerProfile: noProfile,
    target: targetInGymA,
  });
  assertEquals(result, { ok: true });
});

// 2. Coach -> same gym -> allowed
Deno.test("coach sending to a member of their own gym is allowed", () => {
  const result = authorizeNotification({
    type: "class_added",
    callerAdminRow: noAdmin,
    callerCoachRow: { gym_id: gymA },
    callerProfile: noProfile,
    target: targetInGymA,
  });
  assertEquals(result, { ok: true });
});

// Regression: the other 3 currently-used staff-triggered types, one call
// each - the admin/coach branches are not type-sensitive, but these name
// the exact 5 legitimate production workflows explicitly rather than
// relying on inference from the two tests above.
Deno.test("regression: coach class_removed is allowed", () => {
  const result = authorizeNotification({
    type: "class_removed",
    callerAdminRow: noAdmin,
    callerCoachRow: { gym_id: gymA },
    callerProfile: noProfile,
    target: targetInGymA,
  });
  assertEquals(result, { ok: true });
});

Deno.test("regression: admin subscription_cancelled is allowed", () => {
  const result = authorizeNotification({
    type: "subscription_cancelled",
    callerAdminRow: { gym_id: gymA },
    callerCoachRow: noCoach,
    callerProfile: noProfile,
    target: targetInGymA,
  });
  assertEquals(result, { ok: true });
});

// 3. Member -> legitimate waitlist_booked -> allowed
Deno.test("ordinary member triggering waitlist_booked for a same-gym member is allowed", () => {
  const result = authorizeNotification({
    type: "waitlist_booked",
    callerAdminRow: noAdmin,
    callerCoachRow: noCoach,
    callerProfile: { gym_id: gymA },
    target: targetInGymA,
  });
  assertEquals(result, { ok: true });
});

// 4. Member -> class_added -> rejected
Deno.test("ordinary member cannot trigger class_added for another member", () => {
  const result = authorizeNotification({
    type: "class_added",
    callerAdminRow: noAdmin,
    callerCoachRow: noCoach,
    callerProfile: { gym_id: gymA },
    target: targetInGymA,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

// 5. Member -> subscription_added -> rejected
Deno.test("ordinary member cannot trigger subscription_added for another member", () => {
  const result = authorizeNotification({
    type: "subscription_added",
    callerAdminRow: noAdmin,
    callerCoachRow: noCoach,
    callerProfile: { gym_id: gymA },
    target: targetInGymA,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

// 6. Member -> subscription_cancelled -> rejected
Deno.test("ordinary member cannot trigger subscription_cancelled for another member", () => {
  const result = authorizeNotification({
    type: "subscription_cancelled",
    callerAdminRow: noAdmin,
    callerCoachRow: noCoach,
    callerProfile: { gym_id: gymA },
    target: targetInGymA,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

// 7. Member -> cross-gym waitlist_booked -> rejected
Deno.test("ordinary member cannot trigger waitlist_booked for a member of a different gym", () => {
  const result = authorizeNotification({
    type: "waitlist_booked",
    callerAdminRow: noAdmin,
    callerCoachRow: noCoach,
    callerProfile: { gym_id: gymA },
    target: targetInGymB,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

// 8. Admin -> different gym -> rejected
Deno.test("admin of one gym cannot notify a member of a different gym", () => {
  const result = authorizeNotification({
    type: "subscription_added",
    callerAdminRow: { gym_id: gymA },
    callerCoachRow: noCoach,
    callerProfile: noProfile,
    target: targetInGymB,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

// 9. Unknown notification type -> rejected (for a non-privileged caller;
// only the waitlist_booked branch is type-sensitive, so an unrecognized
// type must not accidentally fall through it)
Deno.test("unknown notification type from an ordinary member is rejected", () => {
  const result = authorizeNotification({
    type: "totally_made_up_type",
    callerAdminRow: noAdmin,
    callerCoachRow: noCoach,
    callerProfile: { gym_id: gymA },
    target: targetInGymA,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

// 10. Unknown member_email (no matching profile) -> rejected
Deno.test("a member_email with no matching profile is rejected even for an admin caller", () => {
  const result = authorizeNotification({
    type: "subscription_added",
    callerAdminRow: { gym_id: gymA },
    callerCoachRow: noCoach,
    callerProfile: noProfile,
    target: null,
  });
  assertEquals(result, { ok: false, status: 403, error: "Nu ai voie să trimiți această notificare" });
});

Deno.test("a target profile with no gym_id (mid-signup) is rejected", () => {
  const result = authorizeNotification({
    type: "subscription_added",
    callerAdminRow: { gym_id: gymA },
    callerCoachRow: noCoach,
    callerProfile: noProfile,
    target: { gym_id: null },
  });
  assertEquals(result.ok, false);
});

// 11. Missing JWT -> handleRequest itself returns 401 before any I/O
// (no network call happens before the token check - see index.ts:150-154 -
// so this is safe to call directly with no live Supabase backend).
Deno.test("request with no Authorization header is rejected with 401 before any I/O", async () => {
  const req = new Request("https://example.invalid/send-notification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_email: "someone@example.com", type: "subscription_added" }),
  });
  const res = await handleRequest(req);
  const body = await res.json();
  assertEquals(res.status, 401);
  assertEquals(body, { error: "Lipsește autentificarea" });
});
