import { assertEquals } from "@std/assert";
import { authorizeMemberRemoval } from "../admin-remove-member/index.ts";

// M7.3 Step 2: admin-transfer-member reuses authorizeMemberRemoval
// verbatim (imported, not reimplemented) - the authorization condition is
// identical to Remove Member's own, per M7.2 Technical Architecture
// Section 12. These tests confirm the imported function behaves
// identically when exercised from this module, mirroring
// admin-remove-member/index.test.ts's own cases one-for-one.

const gymA = "11111111-1111-1111-1111-111111111111";
const gymB = "22222222-2222-2222-2222-222222222222";
const adminGymA = { id: "admin-a", gym_id: gymA };

Deno.test("same-gym transfer succeeds", () => {
  const target = { id: "member-1", email: "member@example.com", gym_id: gymA };
  const result = authorizeMemberRemoval({ callerAdminRow: adminGymA, target, targetAdminRow: null });
  assertEquals(result, { ok: true });
});

Deno.test("cross-gym transfer is rejected with the generic not-found response", () => {
  const target = { id: "member-2", email: "victim@example.com", gym_id: gymB };
  const result = authorizeMemberRemoval({ callerAdminRow: adminGymA, target, targetAdminRow: null });
  assertEquals(result, { ok: false, status: 404, error: "Membru inexistent" });
});

Deno.test("transferring an admin account is still blocked", () => {
  const target = { id: "admin-2", email: "otheradmin@example.com", gym_id: gymA };
  const result = authorizeMemberRemoval({ callerAdminRow: adminGymA, target, targetAdminRow: { id: "admin-2" } });
  assertEquals(result, { ok: false, status: 400, error: "Nu poți elimina un cont de administrator" });
});

Deno.test("caller who is not an admin at all is rejected regardless of target", () => {
  const target = { id: "member-1", email: "member@example.com", gym_id: gymA };
  const result = authorizeMemberRemoval({ callerAdminRow: null, target, targetAdminRow: null });
  assertEquals(result, { ok: false, status: 403, error: "Doar administratorii pot elimina membri" });
});
