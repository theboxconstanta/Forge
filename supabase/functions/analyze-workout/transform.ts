// Reconstruieste AMBELE forme din raspunsul APLATIZAT al Structured Outputs
// (vezi openaiSchema.ts): forma noua, pe sectiuni ordonate (Workout Engine
// V2 - toWorkoutSections), si forma veche, cu campuri fixe (warmup/skill/
// skill2/cooldown/movements/scaling/classification/guidance - pt
// compatibilitate API, vezi workout-analysis-schema.ts). Ambele derivate
// din ACELASI raspuns AI, nu doua interpretari separate.
//
// Faza 3 (Workout Engine V2): mapa deterministă de mai jos (deriveLegacyFields)
// inlocuieste ce facea inainte prompt-ul (SECTION_GUIDANCE, eliminat din
// prompt.ts) - "care sectiune in plus merge pe skill vs skill2" nu mai e un
// rationament cerut modelului, e cod testabil.
import { SCORE_TYPE_VALUES, WORKOUT_FORMAT_VALUES } from "./openaiSchema.ts";
import { resolveCanonicalMovement } from "./movementCatalog.ts";

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

function toEquipmentItem(e: any) {
  return { name: e?.name ?? "", quantityHint: e?.quantityHint ?? null };
}

function toStage(st: any) {
  // movements e text simplu (vezi openaiSchema.ts, STAGE_DEF) - nu trece
  // prin toMovement.
  return {
    kind: st?.kind === "interval" ? "interval" : "amrap",
    durationSeconds: st?.durationSeconds ?? null,
    intervalSeconds: st?.intervalSeconds ?? null,
    movements: Array.isArray(st?.movements) ? st.movements.filter((m: any) => typeof m === "string" && m.trim()) : [],
  };
}

function toFormatConfig(fc: any) {
  return {
    timeCapMinutes: fc?.timeCapMinutes ?? null,
    rounds: fc?.rounds ?? null,
    intervalSeconds: fc?.intervalSeconds ?? null,
    workSeconds: fc?.workSeconds ?? null,
    restSeconds: fc?.restSeconds ?? null,
    startReps: fc?.startReps ?? null,
    incrementReps: fc?.incrementReps ?? null,
    stages: Array.isArray(fc?.stages) ? fc.stages.map(toStage) : [],
  };
}

function toBenchmarkMetadata(bm: any) {
  return { name: bm?.name ?? null, isBenchmark: !!bm?.isBenchmark, isHero: !!bm?.isHero };
}

function toSectionScalingVersion(sv: any) {
  return {
    level: typeof sv?.level === "string" ? sv.level : "unknown",
    movements: Array.isArray(sv?.movements) ? sv.movements.map(toMovement) : [],
    timeCapMinutes: sv?.timeCapMinutes ?? null,
    notes: sv?.notes ?? null,
  };
}

function toSectionMetadata(md: any) {
  return {
    difficulty: md?.difficulty ?? null,
    primaryEnergySystem: md?.primaryEnergySystem ?? null,
    secondaryEnergySystem: md?.secondaryEnergySystem ?? null,
    dominantMovementPatterns: Array.isArray(md?.dominantMovementPatterns) ? md.dominantMovementPatterns : [],
    muscleGroups: Array.isArray(md?.muscleGroups) ? md.muscleGroups : [],
    priorityMuscles: Array.isArray(md?.priorityMuscles) ? md.priorityMuscles : [],
    mobilityFocus: Array.isArray(md?.mobilityFocus) ? md.mobilityFocus : [],
    tags: Array.isArray(md?.tags) ? md.tags : [],
    stimulus: md?.stimulus ?? null,
    coachNotes: Array.isArray(md?.coachNotes) ? md.coachNotes : [],
    commonFaults: Array.isArray(md?.commonFaults) ? md.commonFaults : [],
    coachingCues: Array.isArray(md?.coachingCues) ? md.coachingCues : [],
    tips: Array.isArray(md?.tips) ? md.tips : [],
    safetyNotes: Array.isArray(md?.safetyNotes) ? md.safetyNotes : [],
  };
}

function toSection(s: any, order: number) {
  return {
    type: typeof s?.type === "string" && s.type ? s.type : "metcon",
    title: s?.title ?? null,
    description: s?.description ?? null,
    order,
    format: s?.format ?? null,
    formatConfig: toFormatConfig(s?.formatConfig),
    movements: Array.isArray(s?.movements) ? s.movements.map(toMovement) : [],
    equipment: Array.isArray(s?.equipment) ? s.equipment.map(toEquipmentItem) : [],
    scalingVersions: Array.isArray(s?.scalingVersions) ? s.scalingVersions.map(toSectionScalingVersion) : [],
    loggingMode: ["none", "optional", "required"].includes(s?.loggingMode) ? s.loggingMode : "none",
    scoreType: s?.scoreType ?? null,
    durationMinutes: s?.durationMinutes ?? null,
    benchmarkMetadata: toBenchmarkMetadata(s?.benchmarkMetadata),
    metadata: toSectionMetadata(s?.metadata),
  };
}

/** flat = raspunsul brut (JSON.parse-uit) al Structured Outputs - forma
 * aplatizata, pe sectiuni, din openaiSchema.ts. Ordinea vine din pozitia in
 * array (nu dintr-un camp separat pe care modelul trebuie sa-l completeze
 * corect - o singura sursa de adevar). */
export function toWorkoutSections(flat: any): any[] {
  return Array.isArray(flat?.sections) ? flat.sections.map((s: any, i: number) => toSection(s, i)) : [];
}

const SECTION_TYPE_TO_WORKOUT_TYPE: Record<string, string> = {
  metcon: "Metcon",
  strength: "Strength",
  weightlifting: "Strength",
  skill: "Skill",
  gymnastics: "Skill",
};

const LEGACY_SCALING_KEYS = ["beginner", "intermediate", "rx", "masters"];

// Reconstruieste o linie de text lizibila dintr-o miscare STRUCTURATA (ex.
// "10 Air Squats (band)") - modelul pune adesea continutul unei sectiuni
// direct in `movements` (structurat, de preferat), nu in `description`
// (text liber) - forma VECHE (content: string[]) trebuie sa ramana populata
// oricum, indiferent care dintre cele doua a completat-o modelul.
function movementToLine(m: any): string {
  const name = m.name || m.canonicalName || "";
  const parts: string[] = [];
  // Evita "10 10 Air Squats" - modelul pune uneori reps-ul deja in `name`
  // (ex. "10 Air Squats") SI separat in campul `reps` - nu-l repeta daca
  // name incepe deja cu acelasi numar.
  const nameAlreadyHasReps = m.reps != null && new RegExp(`^${m.reps}\\b`).test(name.trim());
  if (m.reps != null && !nameAlreadyHasReps) parts.push(String(m.reps));
  parts.push(name);
  if (m.distance) parts.push(`${m.distance.value}${m.distance.unit}`);
  if (m.calories != null) parts.push(`${m.calories} cal`);
  if (m.weight) {
    const w = m.weight.female != null ? `${m.weight.male}/${m.weight.female}${m.weight.unit}` : `${m.weight.male}${m.weight.unit}`;
    parts.push(`@ ${w}`);
  }
  const line = parts.filter(Boolean).join(" ");
  return m.notes ? `${line} (${m.notes})` : line;
}

// Linii de text pt o sectiune - din `description` daca exista, altfel
// sintetizate din `movements` (vezi movementToLine) - niciodata ambele
// (description are prioritate cand exista, ca sa nu duplice acelasi
// continut sub doua forme diferite).
function sectionToTextLines(s: any): string[] {
  if (typeof s?.description === "string" && s.description.trim()) {
    return s.description.split("\n").map((l: string) => l.trim()).filter(Boolean);
  }
  if (Array.isArray(s?.movements) && s.movements.length) {
    return s.movements.map(movementToLine).filter(Boolean);
  }
  return [];
}

function toLegacySectionShape(s: any) {
  if (!s) return null;
  return { title: s.title, content: sectionToTextLines(s), durationMinutes: s.durationMinutes };
}

function toLegacyScaling(scalingVersions: any[]) {
  const scaling: Record<string, any> = { beginner: null, intermediate: null, rx: null, masters: null };
  for (const sv of scalingVersions) {
    // Nivele in afara celor 4 fixe (ex. "on_ramp", custom de sala - vezi
    // Faza 0, workout_scaling_levels) nu au un slot in forma VECHE - raman
    // pe deplin prezente in sections[].scalingVersions (forma noua,
    // aditiva), doar nu apar si aici. Nu e o regresie: forma veche nu a
    // avut niciodata un slot pt "on_ramp".
    if (!LEGACY_SCALING_KEYS.includes(sv.level)) continue;
    scaling[sv.level] = {
      label: sv.level.charAt(0).toUpperCase() + sv.level.slice(1),
      movements: sv.movements,
      timeCapMinutes: sv.timeCapMinutes,
      notes: sv.notes,
    };
  }
  return scaling;
}

function findPrimarySection(sections: any[]) {
  return sections.find((s) => s.loggingMode === "required" && s.format)
    ?? sections.find((s) => s.format)
    ?? null;
}

/** Deriva DETERMINIST forma veche (warmup/skill/skill2/cooldown/movements/
 * scaling/classification/guidance) din array-ul de sectiuni - inlocuieste
 * ce cerea inainte promptul modelului sa faca singur (SECTION_GUIDANCE,
 * eliminat). Aceeasi regula de "overflow in coachNotes" ca varianta veche
 * bazata pe prompt, acum ca si cod, nu ca instructiune AI. */
function deriveLegacyFields(sections: any[]) {
  const warmupSection = sections.find((s) => s.type === "warmup") ?? null;
  const cooldownSection = [...sections].reverse().find((s) => s.type === "cooldown") ?? null;
  const primary = findPrimarySection(sections);

  const extras = sections.filter((s) => s !== warmupSection && s !== cooldownSection && s !== primary);
  const skillSection = extras[0] ?? null;
  const skill2Section = extras[1] ?? null;
  const overflow = extras.slice(2);
  const overflowNotes = overflow
    .filter((s) => s.title || s.description)
    .map((s) => `${s.title || s.type}${s.description ? `: ${s.description}` : ""}`);

  const workoutDescription = primary ? sectionToTextLines(primary) : [];

  return {
    format: primary?.format ?? "Unrecognized",
    workoutType: primary ? (SECTION_TYPE_TO_WORKOUT_TYPE[primary.type] ?? null) : null,
    timeCapMinutes: primary?.formatConfig?.timeCapMinutes ?? null,
    scoreType: primary?.scoreType ?? "Unknown",
    estimatedDurationMinutes: primary?.durationMinutes ?? null,
    warmup: toLegacySectionShape(warmupSection),
    skill: toLegacySectionShape(skillSection),
    skill2: toLegacySectionShape(skill2Section),
    workoutDescription,
    cooldown: toLegacySectionShape(cooldownSection),
    movements: primary?.movements ?? [],
    equipment: primary?.equipment ?? [],
    scaling: toLegacyScaling(primary?.scalingVersions ?? []),
    classification: {
      difficulty: primary?.metadata?.difficulty ?? null,
      primaryEnergySystem: primary?.metadata?.primaryEnergySystem ?? null,
      secondaryEnergySystem: primary?.metadata?.secondaryEnergySystem ?? null,
      dominantMovementPatterns: primary?.metadata?.dominantMovementPatterns ?? [],
      muscleGroups: primary?.metadata?.muscleGroups ?? [],
      priorityMuscles: primary?.metadata?.priorityMuscles ?? [],
      mobilityFocus: primary?.metadata?.mobilityFocus ?? [],
      tags: primary?.metadata?.tags ?? [],
    },
    guidance: {
      stimulus: primary?.metadata?.stimulus ?? null,
      coachNotes: [...(primary?.metadata?.coachNotes ?? []), ...overflowNotes],
      commonFaults: primary?.metadata?.commonFaults ?? [],
      coachingCues: primary?.metadata?.coachingCues ?? [],
      tips: primary?.metadata?.tips ?? [],
      safetyNotes: primary?.metadata?.safetyNotes ?? [],
    },
  };
}

/** flat = raspunsul brut al Structured Outputs. sourceText = textul original
 * trimis de coach (modelul NU il genereaza). Intoarce forma COMPLETA -
 * campurile vechi (derivate determinist) + campul nou `sections` (aditiv). */
export function toWorkoutAnalysis(flat: any, sourceText: string) {
  const sections = toWorkoutSections(flat);
  const legacy = deriveLegacyFields(sections);
  return {
    title: flat?.title ?? null,
    ...legacy,
    sourceText,
    sections,
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
  if (!Array.isArray(a.sections)) errors.push("sections nu e array");
  else if (a.sections.some((s: any) => typeof s?.type !== "string" || !s.type)) errors.push("o secțiune nu are type (string nevid)");
  return errors;
}
