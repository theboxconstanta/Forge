// workout-analysis-schema.ts
//
// Contractul de date intre AI Workout Analysis Engine (Edge Function
// `analyze-workout`, deocamdata cu raspuns MOCK - vezi Pasii 2A/2B) si
// frontend-ul Forge (Admin > WOD). Pure definitii de tip TypeScript, FARA
// cod la runtime - nimic din acest fisier e inca importat/folosit de
// Edge Function sau de frontend (Pasul 3A e strict design).
//
// Nu orice camp de aici are deja o coloana corespondenta in `wods` (Postgres)
// azi - multe sunt "insight-uri" mai bogate (energy systems, coaching cues,
// muscle groups etc.) fara echivalent inca in schema Forge. Maparea acestei
// structuri pe fluxul real de salvare e un pas ULTERIOR, deliberat separat
// de design-ul schemei in sine (vezi Fazele 2-4, "Workout Intelligence
// Engine" - design-ul UX/arhitectura care a precedat acest fisier).
//
// Formatele si scorurile de mai jos sunt aliniate cu catalogul real deja
// existent in aplicatie (src/workoutFormats.js, WORKOUT_FORMATS) - nu o
// taxonomie inventata separat - ca AI-ul sa produca direct ceva ce Forge
// poate deja reprezenta, in loc sa mai fie nevoie de o traducere ulterioara
// intre doua vocabulare diferite.

// --- Format & scor -----------------------------------------------------

/** Formatele pe care Forge le poate reprezenta azi (vezi WORKOUT_FORMATS,
 * src/workoutFormats.js, pt lista exacta/actualizata si config-ul fiecaruia).
 * 'Unrecognized' e raspunsul corect cand AI-ul nu poate incadra antrenamentul
 * cu incredere intr-un format cunoscut - niciodata un fallback ghicit (vezi
 * Faza 2, sectiunea 1 "Detect the workout format" si sectiunea 8
 * "Error Handling").
 */
export type WorkoutFormat =
  | 'AMRAP'
  | 'Ascending AMRAP'
  | 'For Time'
  | 'RFT'
  | 'Chipper'
  | 'Ladder'
  | 'Partner WOD'
  | 'EMOM'
  | 'Tabata'
  | 'Intervals'
  | 'Death By'
  | 'Death By Weight'
  | 'Complex'
  | 'Superset'
  | 'Strength Sets'
  | 'Build to Heavy/1RM'
  | 'Weightlifting'
  | 'Buy-In/Cash-Out'
  | 'AMRAP with Buy-In'
  | 'Chained AMRAP'
  | 'Not For Time'
  | 'Max Effort'
  | 'Unrecognized'

/** Cum se clasifica scorul unui log pt acest antrenament - deriva direct din
 * `format` (fiecare format din catalog are un scoreMode/family fix), nu e o
 * a doua sursa de adevar independenta. Pastrat totusi ca un camp explicit
 * aici (nu doar implicit din `format`) pt ca schema asta trebuie sa
 * ramana utila si pt formate viitoare, inca neadaugate in catalog.
 */
export type ScoreType =
  | 'Time'            // For Time/RFT/Chipper/Ladder terminate
  | 'Rounds + Reps'    // AMRAP si variantele lui, neterminat For Time/RFT/Ladder
  | 'Reps'             // Death By, EMOM pe reps, Tabata/Intervals
  | 'Weight'           // Build to Heavy/1RM, Strength Sets, Complex, Weightlifting
  | 'Calories'         // metcon-uri centrate pe erg/bike
  | 'Distance'         // metcon-uri centrate pe Row/Run/Ski
  | 'Sets'             // Superset si alte formate `family: 'sets'` fara scor unic clar
  | 'Completion'       // Not For Time / For Quality - doar bifat, fara scor numeric
  | 'Unknown'          // AI nu a putut determina scorul cu incredere

export type DifficultyLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Elite'

/** Sistemul energetic dominant solicitat - util pt clasificare/cautare
 * ulterioara (Faza 3, "Future-proofing": recommendations/analytics), nu
 * pt afisare directa membrilor (prea tehnic pt "simplitate" - vezi Faza 3,
 * "Product Philosophy"). */
export type EnergySystem =
  | 'Phosphagen' // ATP-CP, eforturi maxime sub ~10s (1RM, sprint scurt)
  | 'Glycolytic' // anaerob lactic, ~10s-2min (majoritatea WOD-urilor scurte, intense)
  | 'Oxidative'  // aerob, eforturi lungi/sustinute (WOD-uri 15+ minute, cardio lung)

export type MovementPattern =
  | 'Squat'
  | 'Hinge'
  | 'Push'
  | 'Pull'
  | 'Lunge'
  | 'Carry'
  | 'Rotation'
  | 'Gait' // mers/alergare/ciclism/vaslit/inot

export type MuscleGroup =
  | 'Quadriceps'
  | 'Hamstrings'
  | 'Glutes'
  | 'Calves'
  | 'Chest'
  | 'Back'
  | 'Shoulders'
  | 'Biceps'
  | 'Triceps'
  | 'Forearms'
  | 'Core'
  | 'Full Body'

// --- Miscari & echipament ------------------------------------------------

export interface WeightSpec {
  male: number | null
  female: number | null
  unit: 'kg' | 'lbs'
}

export interface DistanceSpec {
  value: number
  unit: 'm' | 'km' | 'mi'
}

/** O singura miscare detectata in text, cu sugestie de mapare pe lista
 * canonica de miscari a Forge (src/movements.js, MISCARI). Distinct de
 * looksLikeMovementLine (App.jsx/movements.js) - acela e un filtru BINAR
 * ("pare o miscare, da/nu"), deja folosit la intrarea manuala; aici avem
 * nevoie de o potrivire NOMINALA (care miscare anume), plus suport pt
 * alias-uri/abrevieri ("T2B" -> "Toes-to-bar", "OHS" -> "Overhead Squat")
 * pe care regex-ul existent nu le rezolva.
 */
export interface DetectedMovement {
  /** Textul asa cum a fost normalizat de AI (ex. "Thruster"). */
  name: string
  /** Numele canonic din MISCARI, daca s-a gasit o potrivire rezonabila
   * (exacta sau prin alias). null = miscare noua/necunoscuta, nu una gresit
   * potrivita - vezi Faza 2, sectiunea 3 ("Detect movements"). */
  canonicalName: string | null
  /** Reps prescrise, daca exista un numar clar in text (ex. "21 Thrusters"
   * -> 21). null pt miscari fara reps fix (ex. "Max reps Deadlifts",
   * "1 min Plank Hold" - vezi si cazul degenerat din Chained AMRAP,
   * src/workoutFormats.js, totalRepsAmrapStage). */
  reps: number | null
  weight: WeightSpec | null
  distance: DistanceSpec | null
  /** Calorii prescrise (ex. Echo Bike/Row pe calorii, nu metri). */
  calories: number | null
  equipment: string[]
  notes: string | null
}

/** Un element de echipament necesar, cu o estimare a cantitatii - util pt
 * "ce trebuie sa pregatesti inainte de antrenament", nu doar o lista seaca
 * de nume. */
export interface EquipmentItem {
  name: string
  /** Text liber, ex. "1 per athlete", "shared, 2 stations". null daca nu
   * se poate deduce din text. */
  quantityHint: string | null
}

// --- Etape / sectiuni ale antrenamentului --------------------------------

/** O sectiune de sine statatoare (Warm-up, Skill, Skill 2, Cooldown) -
 * corespunde direct sectiunilor deja existente in Forge (wods.warmup,
 * wods.skill/skill2 - vezi Faza 2, sectiunea 2 "Detect workout sections").
 * Fiecare sectiune a antrenamentului principal e OPTIONALA - nu orice text
 * lipit contine toate 4.
 */
export interface WorkoutSection {
  title: string | null
  /** Linii individuale, in ordinea din textul original. */
  content: string[]
  durationMinutes: number | null
}

// --- Scalare pe niveluri --------------------------------------------------

/** O varianta scalata a WOD-ului principal - structural paralela cu
 * `WorkoutAnalysis.movements`, dar cu greutati/reps/substitutii proprii
 * pe acel nivel. Corespunde variantelor deja existente in Forge
 * (RX/Intermediate/Beginner/OnRamp - "Masters" nu exista inca azi ca
 * varianta separata, e un camp nou aici, gandit pt gymuri care programeaza
 * si categorii de varsta). */
export interface ScaledVersion {
  label: string // ex. "RX", "Intermediate", "Masters 55+"
  movements: DetectedMovement[]
  /** Time cap propriu, daca difera de cel al WOD-ului principal. null =
   * neschimbat. */
  timeCapMinutes: number | null
  notes: string | null
}

export interface WorkoutScaling {
  beginner: ScaledVersion | null
  intermediate: ScaledVersion | null
  rx: ScaledVersion | null
  masters: ScaledVersion | null
}

// --- Indicatii de coaching -------------------------------------------------

/** Insight-uri de coaching pt WOD-ul principal - domeniu complet nou, fara
 * echivalent azi in `wods` (nicio coloana pt asta) - separat deliberat de
 * datele STRUCTURALE (format/miscari/scor de mai sus), ca sa poata fi
 * afisat/ascuns independent (vezi Faza 3, "Simplicity Rules" - un membru nu
 * are nevoie sa vada toate astea, un coach nou eventual da).
 */
export interface CoachingGuidance {
  /** Ce anume testeaza/antreneaza WOD-ul, nu doar "e greu" - ex. "grip
   * endurance sub fatiga respiratorie". */
  stimulus: string | null
  coachNotes: string[]
  /** Greseli tehnice frecvente, per miscare sau generale la acest WOD. */
  commonFaults: string[]
  /** Indicii scurte, de spus in timpul antrenamentului (ex. "chest up on
   * the squat"). */
  coachingCues: string[]
  tips: string[]
  safetyNotes: string[]
}

// --- Clasificare / taxonomie -----------------------------------------------

/** Metadate de clasificare - nu se afiseaza neaparat membrilor (vezi Faza 3,
 * "avoid dashboards full of statistics"), dar sunt exact fundatia de care
 * are nevoie orice cautare/recomandare/analiza viitoare (Faza 3,
 * "Future-proofing": movement history, recommendations, analytics - toate
 * presupun date clasificate consistent de la inceput, nu adaugate ulterior
 * printr-un backfill).
 */
export interface WorkoutClassification {
  difficulty: DifficultyLevel | null
  primaryEnergySystem: EnergySystem | null
  secondaryEnergySystem: EnergySystem | null
  dominantMovementPatterns: MovementPattern[]
  muscleGroups: MuscleGroup[]
  /** Subset din `muscleGroups` - cele mai solicitate, nu doar atinse tangential. */
  priorityMuscles: MuscleGroup[]
  /** Text liber, ex. "ankle dorsiflexion", "shoulder overhead position". */
  mobilityFocus: string[]
  /** Etichete libere, ex. "benchmark", "hero wod", "no equipment". */
  tags: string[]
}

// --- Structura completa ----------------------------------------------------

/** Raspunsul complet al AI Workout Analysis Engine pt UN SINGUR text de
 * antrenament lipit. Confidence-ul (per camp/sectiune, vezi Faza 2,
 * sectiunea 7 "Confidence") e proiectat DELIBERAT separat de aceasta
 * structura (nu amestecat aici) - schema asta descrie DATELE, nu cat de
 * sigur e AI-ul de ele; un tip `WorkoutAnalysisConfidence` insotitor,
 * cu aceeasi forma dar valori de incredere in loc de date, e pt un pas
 * ulterior.
 */
export interface WorkoutAnalysis {
  title: string | null
  format: WorkoutFormat
  /** Tipul de antrenament la nivel inalt (ex. "Metcon", "Strength", "Skill",
   * "Hybrid") - diferit de `format` (care e formatul de SCOR: un "Strength"
   * poate fi logat, de exemplu, ca formatul "Build to Heavy/1RM"). */
  workoutType: string | null
  timeCapMinutes: number | null
  scoreType: ScoreType
  estimatedDurationMinutes: number | null

  warmup: WorkoutSection | null
  skill: WorkoutSection | null
  skill2: WorkoutSection | null
  /** Textul WOD-ului principal, ca linii individuale, in ordinea din
   * original - reprezentarea TEXT, pt afisare/comparare cu ce a lipit
   * coach-ul. Miscarile STRUCTURATE (cu reps/greutate deja parsate) sunt in
   * `movements`, mai jos, nu aici. */
  workoutDescription: string[]
  cooldown: WorkoutSection | null

  movements: DetectedMovement[]
  equipment: EquipmentItem[]
  scaling: WorkoutScaling

  classification: WorkoutClassification
  guidance: CoachingGuidance

  /** Textul original, EXACT asa cum a fost lipit de coach - pastrat pt
   * referinta/audit; AI-ul nu-l modifica niciodata. */
  sourceText: string
}
