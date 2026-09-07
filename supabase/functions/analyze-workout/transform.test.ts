// FORGE - STRENGTH SETS GENERATION STRUCTURAL FAILURE
//
// ROOT CAUSE (forensic, traced through the real transform + client pipeline,
// not assumed to be "the AI's fault"): openaiSchema.ts's FORMAT_CONFIG_DEF
// had NO field for a Strength Sets set/rep scheme, and MOVEMENT_DEF.reps is
// a SINGLE nullable number - there was no structured way for the model to
// express "2 sets x5, 3 sets x4, 2 sets x3" at all. The model (reasonably,
// given the schema) wrote the full description into the movement's `notes`
// field (a real, schema-supported free-text field). The client then
// (workoutIntelligence.js's composeMovementLine) folded name+notes into ONE
// display-line string ("Snatch (2 sets x 5 reps, ...)"), and re-parsing that
// flattened string (hydrateInstancesFromLegacy -> parsePastedMovementLine)
// had no pattern for "N sets x M reps" text, so the ENTIRE string became the
// movement's name - and workoutIntelligence.js's FORMAT_CONFIG_TRANSLATORS
// had no 'Strength Sets' entry at all, so setsScheme was never populated
// regardless. This file proves the FIXED transform layer: a dedicated
// formatConfig.setsScheme field, passed through cleanly.
//
// Run: deno test --allow-env --allow-net supabase/functions/analyze-workout/transform.test.ts

import { assertEquals } from "@std/assert";
import { toWorkoutSections } from "./transform.ts";

function strengthSetsSection(overrides: Partial<any> = {}) {
  return {
    type: "strength",
    title: "Strength",
    description: null,
    format: "Strength Sets",
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [5, 5, 4, 4, 4, 3, 3], stages: [],
    },
    movements: [
      {
        name: "Snatch", canonicalName: "Snatch", reps: null,
        weightMale: null, weightFemale: null, weightUnit: null,
        distanceValue: null, distanceUnit: null, calories: null,
        equipment: [], notes: null,
      },
    ],
    equipment: [], scalingVersions: [], loggingMode: "required", scoreType: "Weight",
    durationMinutes: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false },
    metadata: {},
    ...overrides,
  };
}

Deno.test("A/B/C - toWorkoutSections passes setsScheme through, movement stays clean, load absent", () => {
  const [section] = toWorkoutSections({ sections: [strengthSetsSection()] });
  assertEquals(section.format, "Strength Sets");
  assertEquals(section.formatConfig.setsScheme, [5, 5, 4, 4, 4, 3, 3]);
  assertEquals(section.movements[0].name, "Snatch");
  assertEquals(section.movements[0].weight, null); // no fake load
  assertEquals(section.movements[0].reps, null); // scheme lives at format level, not per-movement
});

Deno.test("G - an explicitly coach-prescribed load is preserved, unaffected by setsScheme handling", () => {
  const withLoad = strengthSetsSection();
  withLoad.movements[0].weightMale = 43;
  withLoad.movements[0].weightFemale = 30;
  const [section] = toWorkoutSections({ sections: [withLoad] });
  assertEquals(section.movements[0].weight, { male: 43, female: 30, unit: "kg" });
});

Deno.test("H - a malformed/negative/non-number setsScheme entry is dropped, not passed through as a fake structure", () => {
  const bad = strengthSetsSection();
  bad.formatConfig.setsScheme = [5, "5", -3, null, 4, NaN, 3];
  const [section] = toWorkoutSections({ sections: [bad] });
  assertEquals(section.formatConfig.setsScheme, [5, 4, 3]);
});

Deno.test("H - setsScheme absent/empty from the model stays an empty array (review-flag territory), never invented", () => {
  const noScheme = strengthSetsSection();
  noScheme.formatConfig.setsScheme = [];
  const [section] = toWorkoutSections({ sections: [noScheme] });
  assertEquals(section.formatConfig.setsScheme, []);
});

Deno.test("I - a non-Strength-Sets format's formatConfig is unaffected by the new field", () => {
  const emom = strengthSetsSection({
    format: "EMOM",
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: 60, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [], stages: [],
    },
  });
  const [section] = toWorkoutSections({ sections: [emom] });
  assertEquals(section.formatConfig.intervalSeconds, 60);
  assertEquals(section.formatConfig.setsScheme, []);
});
