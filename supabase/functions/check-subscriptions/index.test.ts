import { assertEquals } from "@std/assert";
import { isAuthorizedScheduler } from "./index.ts";

const REAL_KEY = "this-is-the-real-service-role-key";

Deno.test("matching bearer token is authorized", () => {
  assertEquals(isAuthorizedScheduler(REAL_KEY, REAL_KEY), true);
});

Deno.test("wrong bearer token is rejected", () => {
  assertEquals(isAuthorizedScheduler("some-other-token", REAL_KEY), false);
});

Deno.test("missing token (null) is rejected", () => {
  assertEquals(isAuthorizedScheduler(null, REAL_KEY), false);
});

Deno.test("empty string token is rejected", () => {
  assertEquals(isAuthorizedScheduler("", REAL_KEY), false);
});

Deno.test("a valid but non-service-role JWT (e.g. a regular member's own session token) is rejected", () => {
  // Regression guard for the actual vulnerability being fixed: verify_jwt=true
  // alone only proves "some valid Supabase JWT" was presented - it does not
  // prove the caller is the service_role. Any other real, well-formed JWT
  // must still be rejected by this check.
  const memberToken = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.fake-signature";
  assertEquals(isAuthorizedScheduler(memberToken, REAL_KEY), false);
});
