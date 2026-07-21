import { assertEquals } from "@std/assert";
import { authorizeMemberRemoval } from "./index.ts";

const gymA = "11111111-1111-1111-1111-111111111111";
const gymB = "22222222-2222-2222-2222-222222222222";
const adminGymA = { id: "admin-a", gym_id: gymA };

Deno.test("same-gym removal succeeds", () => {
  const target = { id: "member-1", email: "member@example.com", gym_id: gymA };
  const result = authorizeMemberRemoval({ callerAdminRow: adminGymA, target, targetAdminRow: null });
  assertEquals(result, { ok: true });
});

Deno.test("cross-gym removal is rejected with the generic not-found response", () => {
  const target = { id: "member-2", email: "victim@example.com", gym_id: gymB };
  const result = authorizeMemberRemoval({ callerAdminRow: adminGymA, target, targetAdminRow: null });
  assertEquals(result, { ok: false, status: 404, error: "Membru inexistent" });
});

Deno.test("removing an admin account is still blocked", () => {
  const target = { id: "admin-2", email: "otheradmin@example.com", gym_id: gymA };
  const result = authorizeMemberRemoval({ callerAdminRow: adminGymA, target, targetAdminRow: { id: "admin-2" } });
  assertEquals(result, { ok: false, status: 400, error: "Nu poți elimina un cont de administrator" });
});

Deno.test("non-existent client_id returns the exact same response as a cross-gym client_id", () => {
  const notFound = authorizeMemberRemoval({ callerAdminRow: adminGymA, target: null, targetAdminRow: null });
  const crossGym = authorizeMemberRemoval({
    callerAdminRow: adminGymA,
    target: { id: "member-2", email: "victim@example.com", gym_id: gymB },
    targetAdminRow: null,
  });
  assertEquals(notFound, { ok: false, status: 404, error: "Membru inexistent" });
  assertEquals(notFound, crossGym);
});

Deno.test("caller who is not an admin at all is rejected regardless of target", () => {
  const target = { id: "member-1", email: "member@example.com", gym_id: gymA };
  const result = authorizeMemberRemoval({ callerAdminRow: null, target, targetAdminRow: null });
  assertEquals(result, { ok: false, status: 403, error: "Doar administratorii pot elimina membri" });
});
