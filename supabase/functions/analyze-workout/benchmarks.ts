// Baza locala de WOD-uri "benchmark"/"hero" foarte cunoscute, cu structura
// standard verificata (nu ghicita) - cand textul lipit e (aproape) DOAR
// numele unuia dintre ele, il returnam direct, FARA sa mai apelam OpenAI
// deloc: mai rapid, mai ieftin, si mai corect decat o reconstructie prin AI
// (structura e fixa/canonica de ani de zile, n-are rost sa fie "inteleasa"
// din nou de fiecare data). index.ts incearca matchBenchmark() ÎNAINTE de
// callOpenAiWithRetry() si sare peste apelul AI complet daca gaseste o
// potrivire.
//
// Lista e DELIBERAT mica - doar WOD-urile pe care le putem reproduce cu
// incredere maxima (structura lor RX e documentata identic peste tot,
// neschimbata de ani de zile). Restul WOD-urilor "Girls"/Hero cunoscute
// raman pe mana modelului (vezi BENCHMARK_GUIDANCE in prompt.ts) - mai bine
// niciun shortcut decat unul cu date gresite.
//
// Formatul fiecarei intrari e cel APLATIZAT (acelasi shape pe care l-ar
// intoarce Structured Outputs - vezi openaiSchema.ts) ca sa poata trece prin
// EXACT acelasi toWorkoutAnalysis() din transform.ts ca raspunsul AI, fara
// alta cale de cod separata.

function movement(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    canonicalName: name,
    reps: null,
    weightMale: null,
    weightFemale: null,
    weightUnit: null,
    distanceValue: null,
    distanceUnit: null,
    calories: null,
    equipment: [],
    notes: null,
    ...overrides,
  }
}

const BENCHMARKS: Record<string, any> = {
  fran: {
    title: 'Fran',
    format: 'For Time',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 8,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['21-15-9 reps for time:', 'Thrusters (43/30 kg)', 'Pull-ups'],
    movements: [
      movement('Thruster', { reps: 45, weightMale: 43, weightFemale: 30, weightUnit: 'kg', equipment: ['Barbell'], notes: 'Reps facute 21-15-9 (45 total)' }),
      movement('Pull-up', { reps: 45, equipment: ['Pull-up Bar'], notes: 'Reps facute 21-15-9 (45 total)' }),
    ],
    equipment: [{ name: 'Barbell', quantityHint: '1 per athlete' }, { name: 'Pull-up Bar', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Advanced', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Phosphagen',
      dominantMovementPatterns: ['Squat', 'Pull'], muscleGroups: ['Quadriceps', 'Glutes', 'Shoulders', 'Back'],
      priorityMuscles: ['Quadriceps', 'Shoulders'], mobilityFocus: ['Shoulder overhead position', 'Ankle dorsiflexion'],
      tags: ['Fran', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Intensitate maxima pe un cuplet scurt, sub oboseala de grip si respiratorie',
      coachNotes: ['Unul dintre cele mai cunoscute benchmark-uri CrossFit - scorul se masoara in timp'],
      commonFaults: ['Extensie incompleta a soldului pe thruster', 'Kipping prea devreme, oboseste gripul mai repede'],
      coachingCues: ['Piept sus la fund pe squat', 'Foloseste picioarele sa impingi bara, nu doar bratele'],
      tips: ['Sparge seturile devreme daca nu esti sigur ca duci 21 unbroken'],
      safetyNotes: [],
    },
    sourceText: '',
  },
  grace: {
    title: 'Grace',
    format: 'For Time',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 5,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['30 reps for time:', 'Clean & Jerk (61/43 kg)'],
    movements: [
      movement('Clean & Jerk', { reps: 30, weightMale: 61, weightFemale: 43, weightUnit: 'kg', equipment: ['Barbell'] }),
    ],
    equipment: [{ name: 'Barbell', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Advanced', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Phosphagen',
      dominantMovementPatterns: ['Hinge', 'Squat', 'Push'], muscleGroups: ['Full Body'],
      priorityMuscles: ['Shoulders', 'Back', 'Quadriceps'], mobilityFocus: ['Shoulder overhead position', 'Hip mobility'],
      tags: ['Grace', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Putere si tehnica sub oboseala pe o singura miscare olimpica grea',
      coachNotes: ['Scorul se masoara in timp'],
      commonFaults: ['Pierderea pozitiei de primire pe clean', 'Jerk fara footwork corect'],
      coachingCues: ['Bara aproape de corp', 'Recepteaza jerk-ul cu picioarele active'],
      tips: [],
      safetyNotes: ['Greutate mare - tehnica corecta e prioritara fata de viteza'],
    },
    sourceText: '',
  },
  helen: {
    title: 'Helen',
    format: 'RFT',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 10,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['3 runde for time:', '400m Run', '21 Kettlebell Swings (24/16 kg)', '12 Pull-ups'],
    movements: [
      movement('Run', { distanceValue: 400, distanceUnit: 'm' }),
      movement('KB Swing', { reps: 21, weightMale: 24, weightFemale: 16, weightUnit: 'kg', equipment: ['Kettlebell'] }),
      movement('Pull-up', { reps: 12, equipment: ['Pull-up Bar'] }),
    ],
    equipment: [{ name: 'Kettlebell', quantityHint: '1 per athlete' }, { name: 'Pull-up Bar', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Intermediate', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Oxidative',
      dominantMovementPatterns: ['Gait', 'Hinge', 'Pull'], muscleGroups: ['Full Body'],
      priorityMuscles: ['Hamstrings', 'Glutes', 'Back'], mobilityFocus: ['Shoulder overhead position'],
      tags: ['Helen', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Cardio si grip endurance pe 3 runde repetate',
      coachNotes: [], commonFaults: ['Ritm prea rapid pe primul tur de alergare, oboseala pe swing'],
      coachingCues: ['Foloseste soldul pe kettlebell swing, nu bratele'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
  annie: {
    title: 'Annie',
    format: 'For Time',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 8,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['50-40-30-20-10 reps for time:', 'Double-unders', 'Sit-ups'],
    movements: [
      movement('Double Under', { reps: 150, notes: 'Total pe schema 50-40-30-20-10' }),
      movement('Sit-up', { reps: 150, notes: 'Total pe schema 50-40-30-20-10' }),
    ],
    equipment: [{ name: 'Jump Rope', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Intermediate', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: null,
      dominantMovementPatterns: ['Gait', 'Rotation'], muscleGroups: ['Core', 'Calves'],
      priorityMuscles: ['Core'], mobilityFocus: [], tags: ['Annie', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Coordonare (double-under) sub oboseala de core', coachNotes: [],
      commonFaults: ['Sarituri prea inalte la double-under, consuma energie in plus'],
      coachingCues: ['Sarituri mici, incheieturile fac rotatia corzii'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
  karen: {
    title: 'Karen',
    format: 'For Time',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 10,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['150 Wall Ball Shots for time (9/6 kg la 3/2.7 m)'],
    movements: [
      movement('Wall Ball', { reps: 150, weightMale: 9, weightFemale: 6, weightUnit: 'kg', equipment: ['Medicine Ball'], notes: 'Target 3/2.7 m (10/9 ft)' }),
    ],
    equipment: [{ name: 'Medicine Ball', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Intermediate', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Oxidative',
      dominantMovementPatterns: ['Squat'], muscleGroups: ['Quadriceps', 'Shoulders', 'Glutes'],
      priorityMuscles: ['Quadriceps', 'Shoulders'], mobilityFocus: [], tags: ['Karen', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Volum mare pe o singura miscare - testeaza rezistenta pe picioare/umeri',
      coachNotes: [], commonFaults: ['Squat incomplet (nu ajunge sub paralel)', 'Target ratat des din oboseala'],
      coachingCues: ['Gaseste un ritm sustenabil devreme, nu sprinta primele 50'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
  nancy: {
    title: 'Nancy',
    format: 'RFT',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 12,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['5 runde for time:', '400m Run', '15 Overhead Squats (43/30 kg)'],
    movements: [
      movement('Run', { distanceValue: 400, distanceUnit: 'm' }),
      movement('Overhead Squat', { reps: 15, weightMale: 43, weightFemale: 30, weightUnit: 'kg', equipment: ['Barbell'] }),
    ],
    equipment: [{ name: 'Barbell', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Advanced', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Oxidative',
      dominantMovementPatterns: ['Gait', 'Squat'], muscleGroups: ['Quadriceps', 'Shoulders', 'Core'],
      priorityMuscles: ['Shoulders', 'Quadriceps'], mobilityFocus: ['Shoulder overhead position', 'Ankle dorsiflexion', 'Thoracic mobility'],
      tags: ['Nancy', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Stabilitate overhead sub oboseala cardiovasculara', coachNotes: [],
      commonFaults: ['Pierderea pozitiei overhead pe squat spre finalul rundei'],
      coachingCues: ['Bara pe umeri/spate, nu inainte', 'Priveste inainte, nu in jos'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
  dt: {
    title: 'DT',
    format: 'RFT',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 12,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['5 runde for time (70/47.5 kg):', '12 Deadlifts', '9 Hang Power Cleans', '6 Push Jerks'],
    movements: [
      movement('Deadlift', { reps: 60, weightMale: 70, weightFemale: 47.5, weightUnit: 'kg', equipment: ['Barbell'], notes: '12 per runda x 5 runde' }),
      movement('Hang Power Clean', { reps: 45, weightMale: 70, weightFemale: 47.5, weightUnit: 'kg', equipment: ['Barbell'], notes: '9 per runda x 5 runde' }),
      movement('Push Jerk', { reps: 30, weightMale: 70, weightFemale: 47.5, weightUnit: 'kg', equipment: ['Barbell'], notes: '6 per runda x 5 runde' }),
    ],
    equipment: [{ name: 'Barbell', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Advanced', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Phosphagen',
      dominantMovementPatterns: ['Hinge', 'Push'], muscleGroups: ['Back', 'Shoulders', 'Glutes', 'Hamstrings'],
      priorityMuscles: ['Back', 'Shoulders'], mobilityFocus: ['Shoulder overhead position'],
      tags: ['DT', 'benchmark', 'hero-wod'],
    },
    guidance: {
      stimulus: 'Rezistenta pe bara grea, fara sa lasi bara jos intre miscari daca se poate',
      coachNotes: ['Hero WOD in memoria SSG Timothy P. Davis'],
      commonFaults: ['Prea multe pauze intre miscari, pierde ritmul'],
      coachingCues: ['Foloseste hang power clean ca sa treci direct in push jerk fara sa scapi bara'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
  murph: {
    title: 'Murph',
    format: 'Chipper',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Time',
    estimatedDurationMinutes: 40,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: [
      'For time:', '1 mile Run', '100 Pull-ups', '200 Push-ups', '300 Air Squats', '1 mile Run',
      'Partitioneaza pull-ups/push-ups/air squats dupa nevoie. Cu vesta de greutate (RX).',
    ],
    movements: [
      movement('Run', { distanceValue: 1609, distanceUnit: 'm', notes: '1 mile - inceput' }),
      movement('Pull-up', { reps: 100, equipment: ['Pull-up Bar'] }),
      movement('Push-up', { reps: 200 }),
      movement('Air Squat', { reps: 300 }),
      movement('Run', { distanceValue: 1609, distanceUnit: 'm', notes: '1 mile - final' }),
    ],
    equipment: [
      { name: 'Pull-up Bar', quantityHint: '1 per athlete' },
      { name: 'Weight Vest', quantityHint: 'RX: 9/6 kg (20/14 lb)' },
    ],
    scalingVersions: [],
    classification: {
      difficulty: 'Elite', primaryEnergySystem: 'Oxidative', secondaryEnergySystem: 'Glycolytic',
      dominantMovementPatterns: ['Gait', 'Pull', 'Push', 'Squat'], muscleGroups: ['Full Body'],
      priorityMuscles: ['Shoulders', 'Quadriceps', 'Back'], mobilityFocus: [],
      tags: ['Murph', 'benchmark', 'hero-wod'],
    },
    guidance: {
      stimulus: 'Rezistenta de volum mare pe durata lunga, sub oboseala cumulata',
      coachNotes: ['Hero WOD in memoria LT Michael Murphy - traditional de Memorial Day', 'Multe box-uri permit partitionare libera a celor 300 de reps'],
      commonFaults: ['Ritm prea rapid la primul mile, epuizeaza rezervele pt reps'],
      coachingCues: ['Alege o schema de partitionare sustenabila inainte de start (ex. 20 runde de 5-10-15)'],
      tips: ['Poate fi scalat fara vesta sau cu jumatate din volum'], safetyNotes: ['Volum foarte mare - hidratare si incalzire corecta obligatorii'],
    },
    sourceText: '',
  },
  cindy: {
    title: 'Cindy',
    format: 'AMRAP',
    workoutType: 'Metcon',
    timeCapMinutes: 20,
    scoreType: 'Rounds + Reps',
    estimatedDurationMinutes: 20,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: ['AMRAP 20 minute:', '5 Pull-ups', '10 Push-ups', '15 Air Squats'],
    movements: [
      movement('Pull-up', { reps: 5, equipment: ['Pull-up Bar'] }),
      movement('Push-up', { reps: 10 }),
      movement('Air Squat', { reps: 15 }),
    ],
    equipment: [{ name: 'Pull-up Bar', quantityHint: '1 per athlete' }],
    scalingVersions: [],
    classification: {
      difficulty: 'Intermediate', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Oxidative',
      dominantMovementPatterns: ['Pull', 'Push', 'Squat'], muscleGroups: ['Full Body'],
      priorityMuscles: ['Shoulders', 'Quadriceps'], mobilityFocus: [], tags: ['Cindy', 'benchmark', 'girls'],
    },
    guidance: {
      stimulus: 'Ritm sustenabil pe un triplet bodyweight, 20 de minute', coachNotes: [],
      commonFaults: ['Pornire prea rapida, ritm nesustenabil dupa runda 10'],
      coachingCues: ['Gaseste un ritm pe care il poti tine constant tot AMRAP-ul'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
  'fightgonebad': {
    title: 'Fight Gone Bad',
    format: 'Intervals',
    workoutType: 'Metcon',
    timeCapMinutes: null,
    scoreType: 'Reps',
    estimatedDurationMinutes: 17,
    warmup: null, skill: null, skill2: null, cooldown: null,
    workoutDescription: [
      '3 runde, 1 minut per statie, 1 minut pauza intre runde:',
      'Wall Ball (9/6 kg la 3/2.7 m)', 'Sumo Deadlift High Pull (34/25 kg)', 'Box Jump (61/51 cm cutie)',
      'Push Press (34/25 kg)', 'Row (calorii)', 'Scor = total reps pe toate statiile/rundele (calorii = reps la Row)',
    ],
    movements: [
      movement('Wall Ball', { weightMale: 9, weightFemale: 6, weightUnit: 'kg', equipment: ['Medicine Ball'], notes: '1 minut, target 3/2.7 m' }),
      movement('Sumo Deadlift High Pull', { weightMale: 34, weightFemale: 25, weightUnit: 'kg', equipment: ['Barbell'], notes: '1 minut' }),
      movement('Box Jump', { equipment: ['Box'], notes: '1 minut, cutie 61/51 cm (24/20 in)' }),
      movement('Push Press', { weightMale: 34, weightFemale: 25, weightUnit: 'kg', equipment: ['Barbell'], notes: '1 minut' }),
      movement('Row', { calories: null, equipment: ['Rower'], notes: '1 minut, scor in calorii' }),
    ],
    equipment: [
      { name: 'Medicine Ball', quantityHint: '1 per athlete' }, { name: 'Barbell', quantityHint: '1 per athlete' },
      { name: 'Box', quantityHint: '1 per athlete' }, { name: 'Rower', quantityHint: '1 per athlete' },
    ],
    scalingVersions: [],
    classification: {
      difficulty: 'Advanced', primaryEnergySystem: 'Glycolytic', secondaryEnergySystem: 'Oxidative',
      dominantMovementPatterns: ['Squat', 'Hinge', 'Push'], muscleGroups: ['Full Body'],
      priorityMuscles: ['Shoulders', 'Quadriceps'], mobilityFocus: [], tags: ['Fight Gone Bad', 'benchmark'],
    },
    guidance: {
      stimulus: 'Putere repetata sub interval fix, 5 statii diferite, minim de recuperare',
      coachNotes: ['Scor total = suma reps pe toate cele 3 runde x 5 statii (Row in calorii, numarat ca reps)'],
      commonFaults: ['Tranzitii lente intre statii consuma timp util de lucru'],
      coachingCues: ['Miscare-te repede intre statii, fiecare secunda conteaza'], tips: [], safetyNotes: [],
    },
    sourceText: '',
  },
}

/** Detecteaza daca textul lipit e (aproape) DOAR numele unui WOD cunoscut -
 * NU un match pe un cuvant incidental dintr-un text mult mai lung (ar
 * insemna sa ignoram o varianta reala, posibil modificata, scrisa de coach).
 * Accepta un prefix trivial ("WOD:", "Today's WOD -", o data la inceput).
 * null daca nu e un match sigur - cade inapoi pe fluxul normal cu AI. */
export function matchBenchmark(rawText: string): any | null {
  const trimmed = (rawText || '').trim()
  if (!trimmed || trimmed.length > 40) return null

  const cleaned = trimmed
    .replace(/^(wod|workout|today'?s?\s*wod|antrenament(ul)?)\s*[:\-–]?\s*/i, '')
    .replace(/^[\d./\-\s]{0,12}[:\-–]\s*/, '')
    .trim()
  if (!cleaned || cleaned.length > 30) return null

  const key = cleaned.toLowerCase().replace(/[^a-z]/g, '')
  const found = BENCHMARKS[key]
  return found ? found : null
}
