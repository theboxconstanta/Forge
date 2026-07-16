// Reconstruieste forma CANONICA (workout-analysis-schema.ts, WorkoutAnalysis)
// din raspunsul APLATIZAT al Structured Outputs (vezi openaiSchema.ts pt de
// ce e aplatizat) - singurul loc care cunoaste ambele forme. Restul
// Edge Function-ului (si tot ce e in afara ei) vede doar forma canonica.
import { SCALING_LEVEL_VALUES, SCORE_TYPE_VALUES, WORKOUT_FORMAT_VALUES } from "./openaiSchema.ts";
import { resolveCanonicalMovement } from "./movementCatalog.ts";

const SCALING_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  rx: "RX",
  masters: "Masters",
};

function toWeightSpec(male: number | null, female: number | null, unit: string | null) {
  if (male == null && female == null) return null;
  return { male: male ?? null, female: female ?? null, unit: unit === "lbs" ? "lbs" : "kg" };
}

function toDistanceSpec(value: number | null, unit: string | null) {
  if (value == null) return null;
  return { value, unit: unit === "km" || unit === "mi" ? unit : "m" };
}

function toMovement(m: any) {
  const name = typeof m?.name === "string" ? m.name : "";
  // Plasa de siguranta determinista - daca modelul a lasat canonicalName
  // null, mai incercam o potrivire exacta/alias/plural pe cod (vezi
  // movementCatalog.ts) inainte sa acceptam null definitiv. Nu suprascrie
  // niciodata o valoare pe care modelul a completat-o deja.
  const canonicalName = m?.canonicalName ?? resolveCanonicalMovement(name);
  return {
    name,
    canonicalName,
    reps: m?.reps ?? null,
    weight: toWeightSpec(m?.weightMale ?? null, m?.weightFemale ?? null, m?.weightUnit ?? null),
    distance: toDistanceSpec(m?.distanceValue ?? null, m?.distanceUnit ?? null),
    calories: m?.calories ?? null,
    equipment: Array.isArray(m?.equipment) ? m.equipment : [],
    notes: m?.notes ?? null,
  };
}

function toSection(s: any) {
  if (!s) return null;
  return {
    title: s.title ?? null,
    content: Array.isArray(s.content) ? s.content : [],
    durationMinutes: s.durationMinutes ?? null,
  };
}

function toScaling(list: any) {
  const scaling: Record<string, any> = { beginner: null, intermediate: null, rx: null, masters: null };
  if (!Array.isArray(list)) return scaling;
  for (const item of list) {
    const level = item?.level;
    if (!SCALING_LEVEL_VALUES.includes(level)) continue;
    scaling[level] = {
      label: SCALING_LABELS[level],
      movements: Array.isArray(item.movements) ? item.movements.map(toMovement) : [],
      timeCapMinutes: item.timeCapMinutes ?? null,
      notes: item.notes ?? null,
    };
  }
  return scaling;
}

/** flat = raspunsul brut (JSON.parse-uit) al Structured Outputs, forma
 * aplatizata din openaiSchema.ts. sourceText = textul original trimis de
 * coach (modelul NU il genereaza - vezi openaiSchema.ts). */
export function toWorkoutAnalysis(flat: any, sourceText: string) {
  return {
    title: flat?.title ?? null,
    format: flat?.format ?? "Unrecognized",
    workoutType: flat?.workoutType ?? null,
    timeCapMinutes: flat?.timeCapMinutes ?? null,
    scoreType: flat?.scoreType ?? "Unknown",
    estimatedDurationMinutes: flat?.estimatedDurationMinutes ?? null,
    warmup: toSection(flat?.warmup),
    skill: toSection(flat?.skill),
    skill2: toSection(flat?.skill2),
    workoutDescription: Array.isArray(flat?.workoutDescription) ? flat.workoutDescription : [],
    cooldown: toSection(flat?.cooldown),
    movements: Array.isArray(flat?.movements) ? flat.movements.map(toMovement) : [],
    equipment: Array.isArray(flat?.equipment)
      ? flat.equipment.map((e: any) => ({ name: e?.name ?? "", quantityHint: e?.quantityHint ?? null }))
      : [],
    scaling: toScaling(flat?.scalingVersions),
    classification: {
      difficulty: flat?.classification?.difficulty ?? null,
      primaryEnergySystem: flat?.classification?.primaryEnergySystem ?? null,
      secondaryEnergySystem: flat?.classification?.secondaryEnergySystem ?? null,
      dominantMovementPatterns: Array.isArray(flat?.classification?.dominantMovementPatterns) ? flat.classification.dominantMovementPatterns : [],
      muscleGroups: Array.isArray(flat?.classification?.muscleGroups) ? flat.classification.muscleGroups : [],
      priorityMuscles: Array.isArray(flat?.classification?.priorityMuscles) ? flat.classification.priorityMuscles : [],
      mobilityFocus: Array.isArray(flat?.classification?.mobilityFocus) ? flat.classification.mobilityFocus : [],
      tags: Array.isArray(flat?.classification?.tags) ? flat.classification.tags : [],
    },
    guidance: {
      stimulus: flat?.guidance?.stimulus ?? null,
      coachNotes: Array.isArray(flat?.guidance?.coachNotes) ? flat.guidance.coachNotes : [],
      commonFaults: Array.isArray(flat?.guidance?.commonFaults) ? flat.guidance.commonFaults : [],
      coachingCues: Array.isArray(flat?.guidance?.coachingCues) ? flat.guidance.coachingCues : [],
      tips: Array.isArray(flat?.guidance?.tips) ? flat.guidance.tips : [],
      safetyNotes: Array.isArray(flat?.guidance?.safetyNotes) ? flat.guidance.safetyNotes : [],
    },
    sourceText,
  };
}

/** Verificare usoara, fara librarie de JSON Schema - Structured Outputs
 * strict deja garanteaza shape-ul brut de la OpenAI; asta e doar o plasa de
 * siguranta pt transformarea din transform.ts si pt raspunsuri neasteptate. */
export function validateWorkoutAnalysis(a: any): string[] {
  const errors: string[] = [];
  if (!a || typeof a !== "object") return ["răspunsul nu e un obiect"];
  if (!WORKOUT_FORMAT_VALUES.includes(a.format)) errors.push(`format necunoscut: ${a.format}`);
  if (!SCORE_TYPE_VALUES.includes(a.scoreType)) errors.push(`scoreType necunoscut: ${a.scoreType}`);
  if (!Array.isArray(a.workoutDescription)) errors.push("workoutDescription nu e array");
  if (!Array.isArray(a.movements)) errors.push("movements nu e array");
  else if (a.movements.some((m: any) => typeof m?.name !== "string" || !m.name)) errors.push("o mișcare nu are name (string nevid)");
  if (!Array.isArray(a.equipment)) errors.push("equipment nu e array");
  if (!a.scaling || typeof a.scaling !== "object") errors.push("scaling lipsește");
  if (!a.classification || typeof a.classification !== "object") errors.push("classification lipsește");
  if (!a.guidance || typeof a.guidance !== "object") errors.push("guidance lipsește");
  if (typeof a.sourceText !== "string" || !a.sourceText) errors.push("sourceText lipsește");
  return errors;
}
