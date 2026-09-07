// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Phase C
// Build to Heavy/1RM AI-generation structural fix (transform layer).
//
// ROOT CAUSE / FIX - see src/buildToHeavyGeneration.test.jsx (client half)
// and the openaiSchema.ts/prompt.ts comments this incident added. Mirrors
// transform.test.ts's own setsScheme coverage (the sibling gap already
// fixed once for Strength Sets, commit 12a5f02) for this format's
// dedicated formatConfig.targetRepMax field.
//
// Run: deno test --allow-env --allow-net supabase/functions/analyze-workout/buildToHeavyGeneration.test.ts

import { assertEquals } from "@std/assert";
import { toWorkoutSections } from "./transform.ts";

function buildToHeavySection(overrides: Partial<any> = {}) {
  return {
    type: "strength",
    title: "Strength",
    description: null,
    format: "Build to Heavy/1RM",
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [], targetRepMax: 3, stages: [],
    },
    movements: [
      {
        name: "Front Squat", canonicalName: "Front Squat", reps: null,
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

Deno.test("A/B/C - toWorkoutSections passes targetRepMax through, movement stays clean, no reps/load invented", () => {
  const [section] = toWorkoutSections({ sections: [buildToHeavySection()] });
  assertEquals(section.format, "Build to Heavy/1RM");
  assertEquals(section.formatConfig.targetRepMax, 3);
  assertEquals(section.movements[0].name, "Front Squat");
  assertEquals(section.movements[0].weight, null);
  assertEquals(section.movements[0].reps, null);
});

Deno.test("D - a heavy-single test (targetRepMax=1) passes through unchanged", () => {
  const single = buildToHeavySection();
  single.formatConfig.targetRepMax = 1;
  const [section] = toWorkoutSections({ sections: [single] });
  assertEquals(section.formatConfig.targetRepMax, 1);
});

Deno.test("H - a non-integer/fractional targetRepMax is dropped to null, never rounded/guessed", () => {
  const bad = buildToHeavySection();
  bad.formatConfig.targetRepMax = 3.5;
  const [section] = toWorkoutSections({ sections: [bad] });
  assertEquals(section.formatConfig.targetRepMax, null);
});

Deno.test("H - an out-of-range targetRepMax (0, negative, >30) is dropped to null, never clamped", () => {
  for (const badValue of [0, -3, 31, 100]) {
    const bad = buildToHeavySection();
    bad.formatConfig.targetRepMax = badValue;
    const [section] = toWorkoutSections({ sections: [bad] });
    assertEquals(section.formatConfig.targetRepMax, null, `expected null for targetRepMax=${badValue}`);
  }
});

Deno.test("H - a non-numeric targetRepMax (string/NaN) is dropped to null", () => {
  for (const badValue of ["3", NaN, "3RM"]) {
    const bad = buildToHeavySection();
    bad.formatConfig.targetRepMax = badValue as any;
    const [section] = toWorkoutSections({ sections: [bad] });
    assertEquals(section.formatConfig.targetRepMax, null);
  }
});

Deno.test("H - targetRepMax absent/null from the model stays null (review/default territory), never invented", () => {
  const noTarget = buildToHeavySection();
  noTarget.formatConfig.targetRepMax = null;
  const [section] = toWorkoutSections({ sections: [noTarget] });
  assertEquals(section.formatConfig.targetRepMax, null);
});

Deno.test("I - a non-Build-to-Heavy format's formatConfig is unaffected by the new field", () => {
  const emom = buildToHeavySection({
    format: "EMOM",
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: 60, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [], targetRepMax: null, stages: [],
    },
  });
  const [section] = toWorkoutSections({ sections: [emom] });
  assertEquals(section.formatConfig.intervalSeconds, 60);
  assertEquals(section.formatConfig.targetRepMax, null);
});
