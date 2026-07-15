// Contract DOAR pt Structured Outputs (Responses API, `text.format`) - NU
// generat la runtime din workout-analysis-schema.ts (Deno n-are acces la
// tipurile TS oricum, iar cerinta explicita a fost sa nu incercam generare
// automata din interfetele TS). NU trebuie sa fie identic structural cu acel
// fisier: acolo e contractul CANONIC (nested, cu chei numite pt fiecare
// nivel de scalare), aici e o varianta INTENTIONAT aplatizata, ca sa ramana
// clar sub limitele de nesting/proprietati ale Structured Outputs strict
// mode. `transform.ts` reconstruieste forma canonica din raspunsul
// aplatizat inainte ca index.ts sa raspunda clientului - divergenta asta e
// invizibila pt frontend.
//
// Aplatizari fata de workout-analysis-schema.ts:
// - WeightSpec/DistanceSpec (obiecte imbricate in DetectedMovement) devin
//   campuri scalare direct pe miscare (weightMale/weightFemale/weightUnit,
//   distanceValue/distanceUnit) - elimina 2 niveluri de nesting pe fiecare
//   miscare, inclusiv cele din interiorul lui scalingVersions.
// - WorkoutScaling (4 chei numite: beginner/intermediate/rx/masters, fiecare
//   cu propriul array de miscari) devine un singur array `scalingVersions`
//   cu discriminator `level` - elimina 4x duplicarea schemei ScaledVersion.
// - `sourceText` NU e generat de model (ar insemna sa retransmita tot textul
//   original prin structured output - cost de tokeni si risc de
//   parafrazare); index.ts il ataseaza el insusi din inputul original.
//
// Valorile de enum de mai jos sunt o copie literala a union-urilor din
// workout-analysis-schema.ts (WorkoutFormat/ScoreType/DifficultyLevel/
// EnergySystem/MovementPattern/MuscleGroup) - tin manual sincronizate cele
// doua fisiere daca se adauga vreo valoare noua acolo.

export const WORKOUT_FORMAT_VALUES = [
  'AMRAP', 'Ascending AMRAP', 'For Time', 'RFT', 'Chipper', 'Ladder',
  'Partner WOD', 'EMOM', 'Tabata', 'Intervals', 'Death By', 'Death By Weight',
  'Complex', 'Superset', 'Strength Sets', 'Build to Heavy/1RM', 'Weightlifting',
  'Buy-In/Cash-Out', 'AMRAP with Buy-In', 'Chained AMRAP', 'Not For Time',
  'Max Effort', 'Unrecognized',
] as const

export const SCORE_TYPE_VALUES = [
  'Time', 'Rounds + Reps', 'Reps', 'Weight', 'Calories', 'Distance', 'Sets',
  'Completion', 'Unknown',
] as const

export const DIFFICULTY_VALUES = ['Beginner', 'Intermediate', 'Advanced', 'Elite'] as const

export const ENERGY_SYSTEM_VALUES = ['Phosphagen', 'Glycolytic', 'Oxidative'] as const

export const MOVEMENT_PATTERN_VALUES = [
  'Squat', 'Hinge', 'Push', 'Pull', 'Lunge', 'Carry', 'Rotation', 'Gait',
] as const

export const MUSCLE_GROUP_VALUES = [
  'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Chest', 'Back', 'Shoulders',
  'Biceps', 'Triceps', 'Forearms', 'Core', 'Full Body',
] as const

export const SCALING_LEVEL_VALUES = ['beginner', 'intermediate', 'rx', 'masters'] as const

const MOVEMENT_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    canonicalName: { type: ['string', 'null'] },
    reps: { type: ['number', 'null'] },
    weightMale: { type: ['number', 'null'] },
    weightFemale: { type: ['number', 'null'] },
    weightUnit: { type: ['string', 'null'], enum: ['kg', 'lbs', null] },
    distanceValue: { type: ['number', 'null'] },
    distanceUnit: { type: ['string', 'null'], enum: ['m', 'km', 'mi', null] },
    calories: { type: ['number', 'null'] },
    equipment: { type: 'array', items: { type: 'string' } },
    notes: { type: ['string', 'null'] },
  },
  required: [
    'name', 'canonicalName', 'reps', 'weightMale', 'weightFemale', 'weightUnit',
    'distanceValue', 'distanceUnit', 'calories', 'equipment', 'notes',
  ],
}

const SECTION_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: ['string', 'null'] },
    content: { type: 'array', items: { type: 'string' } },
    durationMinutes: { type: ['number', 'null'] },
  },
  required: ['title', 'content', 'durationMinutes'],
}

const EQUIPMENT_ITEM_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    quantityHint: { type: ['string', 'null'] },
  },
  required: ['name', 'quantityHint'],
}

const SCALED_VERSION_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: [...SCALING_LEVEL_VALUES] },
    movements: { type: 'array', items: { $ref: '#/$defs/movement' } },
    timeCapMinutes: { type: ['number', 'null'] },
    notes: { type: ['string', 'null'] },
  },
  required: ['level', 'movements', 'timeCapMinutes', 'notes'],
}

const CLASSIFICATION_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    difficulty: { type: ['string', 'null'], enum: [...DIFFICULTY_VALUES, null] },
    primaryEnergySystem: { type: ['string', 'null'], enum: [...ENERGY_SYSTEM_VALUES, null] },
    secondaryEnergySystem: { type: ['string', 'null'], enum: [...ENERGY_SYSTEM_VALUES, null] },
    dominantMovementPatterns: { type: 'array', items: { type: 'string', enum: [...MOVEMENT_PATTERN_VALUES] } },
    muscleGroups: { type: 'array', items: { type: 'string', enum: [...MUSCLE_GROUP_VALUES] } },
    priorityMuscles: { type: 'array', items: { type: 'string', enum: [...MUSCLE_GROUP_VALUES] } },
    mobilityFocus: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'difficulty', 'primaryEnergySystem', 'secondaryEnergySystem', 'dominantMovementPatterns',
    'muscleGroups', 'priorityMuscles', 'mobilityFocus', 'tags',
  ],
}

const GUIDANCE_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stimulus: { type: ['string', 'null'] },
    coachNotes: { type: 'array', items: { type: 'string' } },
    commonFaults: { type: 'array', items: { type: 'string' } },
    coachingCues: { type: 'array', items: { type: 'string' } },
    tips: { type: 'array', items: { type: 'string' } },
    safetyNotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['stimulus', 'coachNotes', 'commonFaults', 'coachingCues', 'tips', 'safetyNotes'],
}

/** Schema pt `text.format.schema` (Responses API, strict Structured
 * Outputs). Forma FLATTENED - vezi comentariul de la inceputul fisierului -
 * NU forma canonica din workout-analysis-schema.ts. */
export const WORKOUT_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  $defs: {
    movement: MOVEMENT_DEF,
    section: SECTION_DEF,
    equipmentItem: EQUIPMENT_ITEM_DEF,
    scaledVersion: SCALED_VERSION_DEF,
    classification: CLASSIFICATION_DEF,
    guidance: GUIDANCE_DEF,
  },
  properties: {
    title: { type: ['string', 'null'] },
    format: { type: 'string', enum: [...WORKOUT_FORMAT_VALUES] },
    workoutType: { type: ['string', 'null'] },
    timeCapMinutes: { type: ['number', 'null'] },
    scoreType: { type: 'string', enum: [...SCORE_TYPE_VALUES] },
    estimatedDurationMinutes: { type: ['number', 'null'] },
    warmup: { anyOf: [{ $ref: '#/$defs/section' }, { type: 'null' }] },
    skill: { anyOf: [{ $ref: '#/$defs/section' }, { type: 'null' }] },
    skill2: { anyOf: [{ $ref: '#/$defs/section' }, { type: 'null' }] },
    workoutDescription: { type: 'array', items: { type: 'string' } },
    cooldown: { anyOf: [{ $ref: '#/$defs/section' }, { type: 'null' }] },
    movements: { type: 'array', items: { $ref: '#/$defs/movement' } },
    equipment: { type: 'array', items: { $ref: '#/$defs/equipmentItem' } },
    scalingVersions: { type: 'array', items: { $ref: '#/$defs/scaledVersion' } },
    classification: { $ref: '#/$defs/classification' },
    guidance: { $ref: '#/$defs/guidance' },
  },
  required: [
    'title', 'format', 'workoutType', 'timeCapMinutes', 'scoreType', 'estimatedDurationMinutes',
    'warmup', 'skill', 'skill2', 'workoutDescription', 'cooldown', 'movements', 'equipment',
    'scalingVersions', 'classification', 'guidance',
  ],
}
