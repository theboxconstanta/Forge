// Contract DOAR pt Structured Outputs (Responses API, `text.format`) - NU
// generat la runtime din workout-analysis-schema.ts (Deno n-are acces la
// tipurile TS oricum). NU trebuie sa fie identic structural cu acel fisier:
// acolo e contractul CANONIC, aici e o varianta INTENTIONAT aplatizata, ca
// sa ramana sub limitele de nesting/proprietati ale Structured Outputs
// strict mode. `transform.ts` reconstruieste ambele forme (Workout Engine V2
// sections + shape-ul vechi, pt compatibilitate API - vezi transform.ts)
// din raspunsul aplatizat de aici.
//
// Faza 3 (Workout Engine V2) - schema asta nu mai cere modelului sa
// incadreze antrenamentul in 4 sloturi fixe (warmup/skill/skill2/cooldown,
// forma veche) - modelul produce direct un array ORDONAT de sectiuni,
// exact cum apar in text, fiecare cu propriul tip/format/scoring. Slot-
// fitting-ul de dinainte (SECTION_GUIDANCE in prompt.ts) a fost eliminat
// din prompt - era exact genul de rationament fuzzy pe care un LLM nu-l
// aplica 100% constant, inlocuit acum cu o mapare DETERMINISTA in cod
// (transform.ts) pt raspunsul API vechi, pastrat neschimbat pt
// compatibilitate.
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

// Tipuri de sectiune "cunoscute" - copie din platform defaults ale
// workout_section_types (Faza 0, supabase/migrations/20260715180000_*).
// NU e o constrangere enum in schema (vezi SECTION_DEF mai jos, 'type' e
// text liber) - o sala poate avea tipuri custom, iar modelul nu are acces
// la DB ca sa le cunoasca pe toate. Lista e doar pt prompt.ts (ghidare).
export const SECTION_TYPE_HINTS = [
  'warmup', 'strength', 'skill', 'weightlifting', 'gymnastics', 'metcon',
  'accessory', 'conditioning', 'mobility', 'recovery', 'cooldown', 'coach_notes',
] as const

export const LOGGING_MODE_VALUES = ['none', 'optional', 'required'] as const

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

// O etapa a unui "Chained AMRAP" (ex. "AMRAP 2 STRAIGHT INTO AMRAP 19
// STRAIGHT INTO AMRAP 2") - fiecare etapa isi are propriile miscari,
// separat de lista aplatizata `movements` a sectiunii (care, fara acest
// camp, aduna toate miscarile din toate etapele intr-o singura lista fara
// granite, gasit la explorarea WI-1, 07-17). `kind` distinge cele 2 forme
// care chiar apar inlantuite in WOD-uri reale de conditionare (vezi
// workoutFormats.js, 'Chained AMRAP'.config.stages) - runde+reps partiale
// dintr-o lista de miscari, sau randuri de reps/greutate per interval fix.
// `movements` e text simplu, deja compus ("4 Strict Pull-ups", "Max
// Deadlifts @ 100/70kg") - DELIBERAT nu $ref catre $defs/movement structurat.
// O prima incercare cu miscari structurate (imbricare completa: sectiune ->
// formatConfig -> stages -> movement) a picat cu eroare de la Structured
// Outputs (strict mode are o limita de adancime a nesting-ului) - editorul
// oricum are nevoie de text compus pt StageListField (acelasi shape ca
// MovementListField), nu de obiecte structurate, deci nimic nu se pierde
// din ce chiar foloseste UI-ul.
const STAGE_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['amrap', 'interval'] },
    durationSeconds: { type: ['number', 'null'] },
    intervalSeconds: { type: ['number', 'null'] },
    movements: { type: 'array', items: { type: 'string' } },
  },
  required: ['kind', 'durationSeconds', 'intervalSeconds', 'movements'],
}

const FORMAT_CONFIG_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timeCapMinutes: { type: ['number', 'null'] },
    rounds: { type: ['number', 'null'] },
    intervalSeconds: { type: ['number', 'null'] },
    workSeconds: { type: ['number', 'null'] },
    restSeconds: { type: ['number', 'null'] },
    startReps: { type: ['number', 'null'] },
    incrementReps: { type: ['number', 'null'] },
    // Array GOL (nu null - Structured Outputs strict mode nu accepta
    // type:['array','null'] combinat cu `items`, gasit direct la deploy,
    // eroare "invalid_json_schema") pt orice format in afara de 'Chained
    // AMRAP' - vezi STAGE_DEF. Acelasi tipar ca toate celelalte campuri de
    // tip array din schema asta (ex. movements de mai sus) - niciodata
    // nullable la nivel de tip, gol cand nu se aplica.
    stages: { type: 'array', items: { $ref: '#/$defs/stage' } },
  },
  required: [
    'timeCapMinutes', 'rounds', 'intervalSeconds', 'workSeconds',
    'restSeconds', 'startReps', 'incrementReps', 'stages',
  ],
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

const BENCHMARK_METADATA_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: ['string', 'null'] },
    isBenchmark: { type: 'boolean' },
    isHero: { type: 'boolean' },
  },
  required: ['name', 'isBenchmark', 'isHero'],
}

// Nivelul de scalare ramane text liber (NU enum fix) - Faza 0 face din
// scaling levels un lookup table extensibil per-sala (rx/intermediate/
// beginner/on_ramp implicite + orice adauga sala, ex. "masters"/"teens") -
// o constrangere enum aici ar contrazice exact decizia de arhitectura care
// a introdus lookup table-ul in loc de un set fix.
const SECTION_SCALING_VERSION_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    level: { type: 'string' },
    movements: { type: 'array', items: { $ref: '#/$defs/movement' } },
    timeCapMinutes: { type: ['number', 'null'] },
    notes: { type: ['string', 'null'] },
  },
  required: ['level', 'movements', 'timeCapMinutes', 'notes'],
}

// Metadata unei sectiuni - acelasi continut ca vechile classification +
// guidance (Faza 2B), acum atasat per-sectiune in loc de o singura data pt
// tot WOD-ul. Majoritatea sectiunilor auxiliare vor avea majoritatea
// campurilor null/goale - normal, nu orice sectiune are un "stimulus" de
// coaching distinct.
const SECTION_METADATA_DEF = {
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
    stimulus: { type: ['string', 'null'] },
    coachNotes: { type: 'array', items: { type: 'string' } },
    commonFaults: { type: 'array', items: { type: 'string' } },
    coachingCues: { type: 'array', items: { type: 'string' } },
    tips: { type: 'array', items: { type: 'string' } },
    safetyNotes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'difficulty', 'primaryEnergySystem', 'secondaryEnergySystem', 'dominantMovementPatterns',
    'muscleGroups', 'priorityMuscles', 'mobilityFocus', 'tags', 'stimulus', 'coachNotes',
    'commonFaults', 'coachingCues', 'tips', 'safetyNotes',
  ],
}

const SECTION_DEF = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // Text liber (nu enum) - vezi SECTION_TYPE_HINTS mai sus; o cheie
    // cunoscuta (warmup/strength/skill/...) sau o eticheta scurta custom
    // daca textul descrie o sectiune care nu se potriveste bine cu niciuna.
    type: { type: 'string' },
    title: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    format: { type: ['string', 'null'], enum: [...WORKOUT_FORMAT_VALUES, null] },
    formatConfig: { $ref: '#/$defs/formatConfig' },
    movements: { type: 'array', items: { $ref: '#/$defs/movement' } },
    equipment: { type: 'array', items: { $ref: '#/$defs/equipmentItem' } },
    scalingVersions: { type: 'array', items: { $ref: '#/$defs/sectionScalingVersion' } },
    loggingMode: { type: 'string', enum: [...LOGGING_MODE_VALUES] },
    scoreType: { type: ['string', 'null'], enum: [...SCORE_TYPE_VALUES, null] },
    durationMinutes: { type: ['number', 'null'] },
    benchmarkMetadata: { $ref: '#/$defs/benchmarkMetadata' },
    metadata: { $ref: '#/$defs/sectionMetadata' },
  },
  required: [
    'type', 'title', 'description', 'format', 'formatConfig', 'movements', 'equipment',
    'scalingVersions', 'loggingMode', 'scoreType', 'durationMinutes',
    'benchmarkMetadata', 'metadata',
  ],
}

/** Schema pt `text.format.schema` (Responses API, strict Structured
 * Outputs). Forma FLATTENED, pe sectiuni ordonate - vezi comentariul de la
 * inceputul fisierului. */
export const WORKOUT_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  $defs: {
    movement: MOVEMENT_DEF,
    equipmentItem: EQUIPMENT_ITEM_DEF,
    stage: STAGE_DEF,
    formatConfig: FORMAT_CONFIG_DEF,
    benchmarkMetadata: BENCHMARK_METADATA_DEF,
    sectionScalingVersion: SECTION_SCALING_VERSION_DEF,
    sectionMetadata: SECTION_METADATA_DEF,
    section: SECTION_DEF,
  },
  properties: {
    title: { type: ['string', 'null'] },
    sections: { type: 'array', items: { $ref: '#/$defs/section' } },
  },
  required: ['title', 'sections'],
}
