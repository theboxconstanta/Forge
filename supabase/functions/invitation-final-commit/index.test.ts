import { assertEquals } from "@std/assert";
import { isValidOnboardingPreferences, needsMemberReactivation } from "./index.ts";

// M9 Member Preferences & Internationalization increment. Final Commit is
// the only server-side gate on gender/language/weight_unit - members has
// no DB CHECK for gender/language (weight_unit is the one exception), so
// an arbitrary client payload must be rejected here, not trusted merely
// because the DB wouldn't reject it either.

Deno.test("accepts the canonical combination", () => {
  assertEquals(isValidOnboardingPreferences("masculin", "en", "kg"), true);
  assertEquals(isValidOnboardingPreferences("feminin", "ro", "lbs"), true);
});

Deno.test("rejects English-style gender values - masculin/feminin are the only canonical representation", () => {
  assertEquals(isValidOnboardingPreferences("male", "en", "kg"), false);
  assertEquals(isValidOnboardingPreferences("female", "en", "kg"), false);
});

Deno.test("rejects an unsupported language", () => {
  assertEquals(isValidOnboardingPreferences("masculin", "de", "kg"), false);
});

Deno.test("rejects an unsupported weight unit", () => {
  assertEquals(isValidOnboardingPreferences("masculin", "en", "stone"), false);
});

Deno.test("rejects empty/missing values", () => {
  assertEquals(isValidOnboardingPreferences("", "", ""), false);
});

Deno.test("is case-sensitive - does not silently accept differently-cased values", () => {
  assertEquals(isValidOnboardingPreferences("Masculin", "EN", "KG"), false);
});

// 2026-07-30 Removed Member Re-invitation fix. Pure unit coverage for the
// routing decision only - the two RPCs it chooses between
// (m9_final_commit_dormant_member / m9_final_commit_existing_member) are
// SQL, not reachable from this Deno unit-test layer. That real SQL boundary
// (active -> removed -> re-invited -> reactivated, plus double-commit
// idempotency) was instead verified live via a disposable fixture created
// and fully cleaned up against production on 2026-07-30 (commitStatus:
// "ok" on first call, "invalid_invitation" on an immediate second call,
// independently re-confirmed via a fresh membership-row read showing one
// historical 'removed' row and one new 'active' row, zero residual rows
// after cleanup) - documented here as the infrastructure limitation this
// suite can't close on its own (no local Supabase/Postgres available to
// this environment for a true integration test against the real RPCs).
Deno.test("needsMemberReactivation - null profile (should be unreachable given the FK, but fails safe)", () => {
  assertEquals(needsMemberReactivation(null), true);
});

Deno.test("needsMemberReactivation - gym_id null means dormant/removed, needs reactivation", () => {
  assertEquals(needsMemberReactivation({ gym_id: null }), true);
});

Deno.test("needsMemberReactivation - gym_id already set means already active, no reactivation needed", () => {
  assertEquals(needsMemberReactivation({ gym_id: "11111111-1111-1111-1111-111111111111" }), false);
});

Deno.test("needsMemberReactivation - gym_id set to a DIFFERENT gym still means no reactivation here - must not attach a member active elsewhere", () => {
  assertEquals(needsMemberReactivation({ gym_id: "22222222-2222-2222-2222-222222222222" }), false);
});
