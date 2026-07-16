// Lista canonica de miscari + rezolvare determinista de alias/abreviere/plural
// - copie statica (nu import) din src/movements.js (MISCARI), acelasi motiv
// ca in prompt.ts: Edge Function-ul ramane self-contained in propriul folder.
//
// De ce exista si o rezolvare la nivel de COD (nu doar prompt): promptul
// (SYSTEM_PROMPT, prompt.ts) instruieste deja modelul sa foloseasca
// abrevierile si sa gaseasca potriviri canonice, dar un LLM nu aplica 100%
// din timp o lista de 30+ alias-uri - resolveCanonicalMovement() e o plasa de
// siguranta determinista, aplicata in transform.ts DOAR cand modelul a lasat
// deja canonicalName: null, nu suprascrie niciodata o potrivire pe care
// modelul a facut-o deja.
export const CANONICAL_MOVEMENTS = [
  'Air Squat', 'Back Squat', 'Front Squat', 'Overhead Squat', 'Box Squat', 'Pause Squat',
  'Shoulder Press', 'Push Press', 'Push Jerk', 'Split Jerk', 'Bench Press', 'Strict Press',
  'Deadlift', 'Romanian Deadlift', 'Sumo Deadlift', 'Sumo Deadlift High Pull', 'Stiff Leg Deadlift',
  'Clean & Jerk', 'Power Clean', 'Hang Clean', 'Hang Power Clean', 'Squat Clean', 'Clean Pull',
  'Snatch', 'Power Snatch', 'Hang Snatch', 'Hang Power Snatch', 'Squat Snatch', 'Snatch Pull', 'Snatch Balance',
  'Thruster', 'Farmers Carry', 'Turkish Get Up', 'Good Morning', 'Hip Thrust',
  'Pull-up', 'Chest to Bar Pull-up', 'Muscle-up', 'Ring Muscle-up', 'Bar Muscle-up',
  'Toes to Bar', 'Knees to Elbow', 'Ring Row', 'Push-up', 'Handstand Push-up',
  'Ring Dip', 'Bar Dip', 'Handstand Hold', 'Handstand Walk', 'L-sit Hold',
  'Box Jump', 'Broad Jump', 'Burpee', 'Double Under', 'Single Under',
  'Pistol Squat', 'Rope Climb', 'GHD Sit-up', 'GHD Back Extension',
  'Walking Lunge', 'Overhead Lunge', 'Front Rack Lunge',
  'Row', 'Run', 'Bike Erg', 'Assault Bike', 'Air Bike', 'Ski Erg', 'Echo Bike', 'Assault Runner', 'Shuttle Run', 'Swim',
  'KB Swing', 'Kettlebell Swing', 'Russian Kettlebell Swing', 'American Kettlebell Swing',
  'KB Clean', 'KB Snatch', 'KB Goblet Squat', 'Wall Ball',
  'Clean', 'Muscle Snatch', 'Muscle Clean', 'Snatch from Blocks', 'Clean from Blocks',
  'Heaving Snatch Balance', 'Pressing Snatch Balance', 'Drop Snatch',
  'Snatch High Pull', 'Clean High Pull', 'Snatch Deadlift', 'Clean Deadlift',
  'Snatch-Grip Push Press', 'Snatch-Grip Behind-the-Neck Press', 'Sotts Press',
  'Squat Jerk', 'Power Jerk', 'Behind-the-Neck Jerk', 'Jerk Dip', 'Jerk Drive', 'Jerk Balance', 'Tall Jerk',
  'Cluster', 'Shoulder-to-Overhead', 'Ground-to-Overhead', 'Bear Complex', 'DT Complex',
  'Tempo Squat', 'Zercher Squat', 'Bulgarian Split Squat', 'Barbell Lunge',
  'Deficit Deadlift', 'Rack Pull',
  'Close-Grip Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Floor Press', 'Z Press', 'Behind-the-Neck Press',
  'Bent-Over Row', 'Pendlay Row', 'Barbell Shrug', 'Barbell Curl',
  'Landmine Press', 'Landmine Row', 'Landmine Rotation', 'Barbell Rollout',
  'Strict Pull-up', 'Kipping Pull-up', 'Butterfly Pull-up', 'Chin-up', 'Weighted Pull-up',
  'L Pull-up', 'Jumping Pull-up', 'Negative Pull-up', 'Legless Rope Climb', 'Peg Board Ascent',
  'Foot-Assisted Pull-up', 'Band-Assisted Pull-up',
  'Hand-Release Push-up', 'Deficit Push-up', 'Ring Push-up', 'Parallette Push-up', 'Bench Dip',
  'Knee Push-up', 'Hand-Elevated Push-up',
  'Strict Handstand Push-up', 'Deficit Handstand Push-up', 'Wall-Facing Handstand Push-up',
  'Freestanding Handstand Push-up', 'Box Handstand Push-up', 'Handstand Walk over Obstacle', 'Handstand Pirouette', 'Wall Walk', 'Shoulder Taps',
  'Toes to Ring', 'Hanging Knee Raise', 'Skin the Cat', 'Front Lever', 'Back Lever',
  'Jumping Squat', 'Lunge', 'Jumping Lunge', 'Step-up', 'Vertical Jump', 'Pull-to-Stand',
  'Bar-Facing Burpee', 'Lateral Burpee', 'Lateral Burpee Over Bar', 'Burpee Pull-up', 'Burpee to Target', 'Box Burpee',
  'Burpee Box Jump', 'Burpee Box Jump Over', 'Burpee Box Step-over', 'Burpee Broad Jump', 'Burpee Muscle-up',
  'Bear Crawl', 'Crab Walk', 'Duck Walk', 'Candlestick Roll', 'Forward Roll',
  'Triple Under', 'Double Under Crossover', 'Stair Climb', 'Ruck',
  'DB Snatch', 'DB Power Clean', 'DB Hang Clean', 'DB Clean & Jerk', 'DB Push Press', 'DB Push Jerk',
  'DB Strict Press', 'DB Thruster', 'Devil Press', 'Man Makers',
  'DB Front Squat', 'DB Overhead Squat', 'DB Goblet Squat', 'DB Lunge', 'DB Overhead Lunge',
  'DB Box Step-up', 'DB Box Step-over', 'DB Deadlift', 'DB Romanian Deadlift', 'DB Bench Press', 'DB Floor Press',
  'Single-Arm DB Row', 'Renegade Row', 'DB Turkish Get Up', 'DB Farmers Carry', 'DB Overhead Carry',
  'DB Front Rack Carry', 'DB Burpee Deadlift', 'DB Curl', 'Lateral Raise', 'DB Pullover', 'DB Skull Crusher',
  'KB Dead Clean', 'KB Clean & Jerk', 'KB Strict Press', 'KB Push Press', 'Bottoms-Up Press', 'Goblet Squat',
  'Double KB Front Squat', 'KB Thruster', 'KB Deadlift', 'KB Sumo Deadlift', 'KB Sumo Deadlift High Pull', 'KB Lunge',
  'KB Windmill', 'KB Halo', 'Around the World', 'KB Row', 'Gorilla Row', 'KB Farmers Carry',
  'Suitcase Carry', 'Rack Carry', 'Overhead Carry',
  'Wall Ball Sit-up', 'Medicine Ball Clean', 'Med Ball Slam', 'Med Ball Toss', 'Med Ball Run',
  'Rotational Med Ball Throw', 'D-Ball over Shoulder',
  'Box Jump Over', 'Box Step-up', 'Box Step-over', 'Seated Box Jump', 'Lateral Box Jump', 'Box Dip', 'Depth Jump',
  'Sandbag Clean', 'Sandbag to Shoulder', 'Sandbag Carry', 'Sandbag Squat', 'Sandbag Lunge',
  'D-Ball over Bar', 'Atlas Stone Lift', 'Yoke Carry', 'Husafell Carry', 'Sled Push', 'Sled Drag',
  'Tire Flip', 'Sledgehammer Strikes', 'Log Press', 'Axle Bar Deadlift', 'Axle Clean & Press', 'Keg Carry', 'Keg Toss',
  'Sit-up', 'Weighted Sit-up', 'GHD Hip Extension', 'V-up', 'Tuck-up', 'Hollow Hold', 'Hollow Rock',
  'Arch Hold', 'Superman', 'Plank', 'Side Plank', 'Russian Twist', 'Ab Wheel Rollout', 'Dead Bug',
  'Bird Dog', 'Windshield Wipers', 'Dragon Flag', 'Pallof Press', 'Reverse Hyper',
  'Band Pull-Apart', 'Face Pull', 'Banded Good Morning', 'Nordic Hamstring Curl', 'Glute Ham Raise',
  'Calf Raise', 'Single-Leg RDL', 'Copenhagen Plank', 'Cuban Rotation', 'Scap Pull-up', 'Scap Push-up', 'Ring Support Hold',
  'Angie', 'Annie', 'Amanda', 'Barbara', 'Chelsea', 'Cindy', 'Diane', 'Elizabeth', 'Eva',
  'Fran', 'Grace', 'Helen', 'Isabel', 'Jackie', 'Karen', 'Kelly', 'Linda', 'Lynne', 'Mary', 'Nancy', 'Nicole',
  'Murph', 'DT', 'Randy', 'Michael', 'Ryan', 'Josh', 'J.T.', 'Nate', 'Danny',
  'Adam', 'Badger', 'Forrest', 'Kalsu', 'Ship', 'Scott', 'Griff', 'Glen', 'Nutts', 'Desforges',
]

// Doar abrevieri NEAMBIGUE, general acceptate in CrossFit - fiecare aplicata
// doar cand tot tokenul normalizat (dupa strip de spatii/punctuatie) se
// potriveste EXACT, nu ca substring liber (altfel "PC" ar potrivi gresit
// in mijlocul altui cuvant). Cheile sunt litere mici, fara spatii/punctuatie.
export const MOVEMENT_ALIASES: Record<string, string> = {
  ttb: 'Toes to Bar', t2b: 'Toes to Bar',
  kte: 'Knees to Elbow',
  hspu: 'Handstand Push-up',
  cj: 'Clean & Jerk', 'c&j': 'Clean & Jerk',
  pu: 'Pull-up',
  c2b: 'Chest to Bar Pull-up', ctb: 'Chest to Bar Pull-up',
  du: 'Double Under', su: 'Single Under',
  ohs: 'Overhead Squat', fs: 'Front Squat', bs: 'Back Squat',
  dl: 'Deadlift', rdl: 'Romanian Deadlift',
  sdhp: 'Sumo Deadlift High Pull',
  kbs: 'KB Swing', wb: 'Wall Ball', wbs: 'Wall Ball Sit-up',
  bj: 'Box Jump',
  mu: 'Muscle-up', rmu: 'Ring Muscle-up', bmu: 'Bar Muscle-up',
  ghd: 'GHD Sit-up', hsw: 'Handstand Walk',
  stoh: 'Shoulder-to-Overhead', gto: 'Ground-to-Overhead',
  pc: 'Power Clean', hc: 'Hang Clean', hpc: 'Hang Power Clean',
  ps: 'Power Snatch', hs: 'Hang Snatch', hps: 'Hang Power Snatch',
  sc: 'Squat Clean', ss: 'Squat Snatch',
  as: 'Air Squat', pp: 'Push Press', pj: 'Push Jerk', sj: 'Split Jerk',
  bp: 'Bench Press', tgu: 'Turkish Get Up',
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9&]/g, '')
}

/** Rezolvare determinista (fara AI) a unui nume liber de miscare catre
 * numele canonic din MISCARI - potrivire exacta, apoi alias/abreviere
 * cunoscuta, apoi forma de plural simpla ("Thrusters" -> "Thruster",
 * "Snatches" -> "Snatch"). null daca nu s-a gasit nimic sigur - NU
 * ghiceste o potrivire aproximativa. */
export function resolveCanonicalMovement(rawName: string): string | null {
  const name = (rawName || '').trim()
  if (!name) return null

  const exact = CANONICAL_MOVEMENTS.find((m) => m.toLowerCase() === name.toLowerCase())
  if (exact) return exact

  const alias = MOVEMENT_ALIASES[normalizeToken(name)]
  if (alias) return alias

  for (const stripped of [name.replace(/es$/i, ''), name.replace(/s$/i, '')]) {
    if (stripped === name) continue
    const match = CANONICAL_MOVEMENTS.find((m) => m.toLowerCase() === stripped.toLowerCase())
    if (match) return match
  }

  return null
}
