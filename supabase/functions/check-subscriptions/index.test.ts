import { assertEquals } from "@std/assert";
import { isAuthorizedScheduler } from "./index.ts";

const REAL_SECRET = "sb_secret_this-is-the-real-default-key";
const SECRET_KEYS_JSON = JSON.stringify({ default: REAL_SECRET });

Deno.test("matching apikey against the default secret key is authorized", () => {
  assertEquals(isAuthorizedScheduler(REAL_SECRET, SECRET_KEYS_JSON), true);
});

Deno.test("wrong apikey is rejected", () => {
  assertEquals(isAuthorizedScheduler("some-other-key", SECRET_KEYS_JSON), false);
});

Deno.test("missing apikey header (null) is rejected", () => {
  assertEquals(isAuthorizedScheduler(null, SECRET_KEYS_JSON), false);
});

Deno.test("empty string apikey is rejected", () => {
  assertEquals(isAuthorizedScheduler("", SECRET_KEYS_JSON), false);
});

Deno.test("missing SUPABASE_SECRET_KEYS env var (undefined) is rejected - fails closed", () => {
  assertEquals(isAuthorizedScheduler(REAL_SECRET, undefined), false);
});

Deno.test("malformed JSON in SUPABASE_SECRET_KEYS is rejected, not thrown - fails closed", () => {
  assertEquals(isAuthorizedScheduler(REAL_SECRET, "{not valid json"), false);
});

Deno.test("valid JSON but no 'default' key present is rejected", () => {
  const noDefault = JSON.stringify({ billing: "sb_secret_something-else" });
  assertEquals(isAuthorizedScheduler(REAL_SECRET, noDefault), false);
});

Deno.test("multiple named keys present - only 'default' is checked, a different named key's value does not match", () => {
  const multi = JSON.stringify({ default: REAL_SECRET, billing: "sb_secret_billing-key-value" });
  assertEquals(isAuthorizedScheduler("sb_secret_billing-key-value", multi), false);
  assertEquals(isAuthorizedScheduler(REAL_SECRET, multi), true);
});

Deno.test("empty object JSON (no keys at all) is rejected", () => {
  assertEquals(isAuthorizedScheduler(REAL_SECRET, "{}"), false);
});
