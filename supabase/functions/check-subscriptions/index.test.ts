import { assertEquals } from "@std/assert";
import { isAuthorizedScheduler } from "./index.ts";

const REAL_SECRET = "sb_secret_this-is-the-real-schedulerv2-key";
const SECRET_KEYS_JSON = JSON.stringify({ schedulerv2: REAL_SECRET });

Deno.test("matching apikey against the schedulerv2 secret key is authorized", () => {
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

Deno.test("valid JSON but no 'schedulerv2' key present is rejected", () => {
  const noScheduler = JSON.stringify({ billing: "sb_secret_something-else" });
  assertEquals(isAuthorizedScheduler(REAL_SECRET, noScheduler), false);
});

// P0.2 - the whole point of moving off "default": the project's other,
// wider-blast-radius secret key (used elsewhere, e.g. PostgREST) must NOT
// authorize this scheduler job, even though it's a valid key in the SAME
// project's SUPABASE_SECRET_KEYS dictionary.
Deno.test("the project's 'default' key no longer authorizes this job, even though it's a real key in the same dictionary", () => {
  const defaultAndScheduler = JSON.stringify({ default: "sb_secret_the-default-key", schedulerv2: REAL_SECRET });
  assertEquals(isAuthorizedScheduler("sb_secret_the-default-key", defaultAndScheduler), false);
  assertEquals(isAuthorizedScheduler(REAL_SECRET, defaultAndScheduler), true);
});

// P0.2 follow-up - the FIRST scheduler key created during this incident
// ("scheduler", superseded by "schedulerv2") must not silently keep working
// either. Only the one name the code is pinned to authorizes.
Deno.test("a superseded 'scheduler' key (predecessor of schedulerv2) no longer authorizes this job", () => {
  const oldAndNew = JSON.stringify({ scheduler: "sb_secret_the-old-superseded-key", schedulerv2: REAL_SECRET });
  assertEquals(isAuthorizedScheduler("sb_secret_the-old-superseded-key", oldAndNew), false);
  assertEquals(isAuthorizedScheduler(REAL_SECRET, oldAndNew), true);
});

Deno.test("multiple named keys present - only 'schedulerv2' is checked, a different named key's value does not match", () => {
  const multi = JSON.stringify({ schedulerv2: REAL_SECRET, billing: "sb_secret_billing-key-value" });
  assertEquals(isAuthorizedScheduler("sb_secret_billing-key-value", multi), false);
  assertEquals(isAuthorizedScheduler(REAL_SECRET, multi), true);
});

Deno.test("empty object JSON (no keys at all) is rejected", () => {
  assertEquals(isAuthorizedScheduler(REAL_SECRET, "{}"), false);
});
