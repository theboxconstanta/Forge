import { assertEquals } from "@std/assert";
import { isValidOnboardingPreferences } from "./index.ts";

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
