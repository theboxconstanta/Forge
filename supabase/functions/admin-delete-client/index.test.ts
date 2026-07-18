import { assertEquals } from "@std/assert";
import { authorizeClientDeletion } from "./index.ts";

const gymA = "11111111-1111-1111-1111-111111111111";
const gymB = "22222222-2222-2222-2222-222222222222";
const adminGymA = { id: "admin-a", gym_id: gymA };

Deno.test("same-gym delete succeeds", () => {
  const target = { id: "member-1", email: "member@example.com", gym_id: gymA };
  const result = authorizeClientDeletion({ callerAdminRow: adminGymA, target, targetAdminRow: null });
  assertEquals(result, { ok: true });
});

Deno.test("cross-gym delete is rejected with the generic not-found response", () => {
  const target = { id: "member-2", email: "victim@example.com", gym_id: gymB };
  const result = authorizeClientDeletion({ callerAdminRow: adminGymA, target, targetAdminRow: null });
  assertEquals(result, { ok: false, status: 404, error: "Client inexistent" });
});

Deno.test("deleting an admin account is still blocked", () => {
  const target = { id: "admin-2", email: "otheradmin@example.com", gym_id: gymA };
  const result = authorizeClientDeletion({ callerAdminRow: adminGymA, target, targetAdminRow: { id: "admin-2" } });
  assertEquals(result, { ok: false, status: 400, error: "Nu poți șterge un cont de administrator" });
});

Deno.test("non-existent client_id returns the exact same response as a cross-gym client_id", () => {
  const notFound = authorizeClientDeletion({ callerAdminRow: adminGymA, target: null, targetAdminRow: null });
  const crossGym = authorizeClientDeletion({
    callerAdminRow: adminGymA,
    target: { id: "member-2", email: "victim@example.com", gym_id: gymB },
    targetAdminRow: null,
  });
  assertEquals(notFound, { ok: false, status: 404, error: "Client inexistent" });
  assertEquals(notFound, crossGym);
});

Deno.test("caller who is not an admin at all is rejected regardless of target", () => {
  const target = { id: "member-1", email: "member@example.com", gym_id: gymA };
  const result = authorizeClientDeletion({ callerAdminRow: null, target, targetAdminRow: null });
  assertEquals(result, { ok: false, status: 403, error: "Doar administratorii pot șterge clienți" });
});
