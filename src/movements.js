// Biblioteca de miscari (autocomplete) - fisier separat, fara dependente de
// React/Supabase, ca sa poata fi importat atat din App.jsx cat si din
// FormatConfigEditor.jsx (care nu poate importa din App.jsx fara ciclu de
// dependente - App.jsx importa FormatConfigEditor, nu invers).
export const CARDIO_MISCARI = ['Row', 'Run', 'Bike Erg', 'Assault Bike', 'Air Bike', 'Ski Erg', 'Echo Bike', 'Assault Runner', 'Shuttle Run', 'Swim']
export const CARDIO_CU_CALORII = CARDIO_MISCARI.filter(c => c !== 'Run')

export const MISCARI = [
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
  ...CARDIO_MISCARI,
  'KB Swing', 'Kettlebell Swing', 'Russian Kettlebell Swing', 'American Kettlebell Swing',
  'KB Clean', 'KB Snatch', 'KB Goblet Squat', 'Wall Ball',
  // Completare din biblioteca-miscari-crossfit.md - familiile Snatch/Clean/Jerk
  'Clean', 'Muscle Snatch', 'Muscle Clean', 'Snatch from Blocks', 'Clean from Blocks',
  'Heaving Snatch Balance', 'Pressing Snatch Balance', 'Drop Snatch',
  'Snatch High Pull', 'Clean High Pull', 'Snatch Deadlift', 'Clean Deadlift',
  'Snatch-Grip Push Press', 'Snatch-Grip Behind-the-Neck Press', 'Sotts Press',
  'Squat Jerk', 'Power Jerk', 'Behind-the-Neck Jerk', 'Jerk Dip', 'Jerk Drive', 'Jerk Balance', 'Tall Jerk',
  'Cluster', 'Shoulder-to-Overhead', 'Ground-to-Overhead', 'Bear Complex', 'DT Complex',
  // Barbell Strength
  'Tempo Squat', 'Zercher Squat', 'Bulgarian Split Squat', 'Barbell Lunge',
  'Deficit Deadlift', 'Rack Pull',
  'Close-Grip Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Floor Press', 'Z Press', 'Behind-the-Neck Press',
  'Bent-Over Row', 'Pendlay Row', 'Barbell Shrug', 'Barbell Curl',
  'Landmine Press', 'Landmine Row', 'Landmine Rotation', 'Barbell Rollout',
  // Gymnastics
  'Strict Pull-up', 'Kipping Pull-up', 'Butterfly Pull-up', 'Chin-up', 'Weighted Pull-up',
  'L Pull-up', 'Jumping Pull-up', 'Negative Pull-up', 'Legless Rope Climb', 'Peg Board Ascent',
  'Hand-Release Push-up', 'Deficit Push-up', 'Ring Push-up', 'Parallette Push-up', 'Bench Dip',
  'Strict Handstand Push-up', 'Deficit Handstand Push-up', 'Wall-Facing Handstand Push-up',
  'Freestanding Handstand Push-up', 'Handstand Walk over Obstacle', 'Handstand Pirouette', 'Wall Walk', 'Shoulder Taps',
  'Toes to Ring', 'Hanging Knee Raise', 'Skin the Cat', 'Front Lever', 'Back Lever',
  'Jumping Squat', 'Lunge', 'Jumping Lunge', 'Step-up', 'Vertical Jump',
  'Bar-Facing Burpee', 'Lateral Burpee', 'Burpee Pull-up', 'Burpee to Target',
  'Burpee Box Jump', 'Burpee Box Jump Over', 'Burpee Broad Jump', 'Burpee Muscle-up',
  'Bear Crawl', 'Crab Walk', 'Duck Walk', 'Candlestick Roll', 'Forward Roll',
  // Cardio / Monostructural
  'Triple Under', 'Double Under Crossover', 'Stair Climb', 'Ruck',
  // Dumbbell
  'DB Snatch', 'DB Power Clean', 'DB Hang Clean', 'DB Clean & Jerk', 'DB Push Press', 'DB Push Jerk',
  'DB Strict Press', 'DB Thruster', 'Devil Press', 'Man Makers',
  'DB Front Squat', 'DB Overhead Squat', 'DB Goblet Squat', 'DB Lunge', 'DB Overhead Lunge',
  'DB Box Step-up', 'DB Box Step-over', 'DB Deadlift', 'DB Romanian Deadlift', 'DB Bench Press', 'DB Floor Press',
  'Single-Arm DB Row', 'Renegade Row', 'DB Turkish Get Up', 'DB Farmers Carry', 'DB Overhead Carry',
  'DB Front Rack Carry', 'DB Burpee Deadlift', 'DB Curl', 'Lateral Raise', 'DB Pullover', 'DB Skull Crusher',
  // Kettlebell
  'KB Dead Clean', 'KB Clean & Jerk', 'KB Strict Press', 'KB Push Press', 'Bottoms-Up Press', 'Goblet Squat',
  'Double KB Front Squat', 'KB Thruster', 'KB Deadlift', 'KB Sumo Deadlift', 'KB Sumo Deadlift High Pull', 'KB Lunge',
  'KB Windmill', 'KB Halo', 'Around the World', 'KB Row', 'Gorilla Row', 'KB Farmers Carry',
  'Suitcase Carry', 'Rack Carry', 'Overhead Carry',
  // Wall Ball / Medicine Ball
  'Wall Ball Sit-up', 'Medicine Ball Clean', 'Med Ball Slam', 'Med Ball Toss', 'Med Ball Run',
  'Rotational Med Ball Throw', 'D-Ball over Shoulder',
  // Box
  'Box Jump Over', 'Box Step-up', 'Box Step-over', 'Seated Box Jump', 'Lateral Box Jump', 'Box Dip', 'Depth Jump',
  // Strongman / Odd Objects
  'Sandbag Clean', 'Sandbag to Shoulder', 'Sandbag Carry', 'Sandbag Squat', 'Sandbag Lunge',
  'D-Ball over Bar', 'Atlas Stone Lift', 'Yoke Carry', 'Husafell Carry', 'Sled Push', 'Sled Drag',
  'Tire Flip', 'Sledgehammer Strikes', 'Log Press', 'Axle Bar Deadlift', 'Axle Clean & Press', 'Keg Carry', 'Keg Toss',
  // Core / Midline
  'Sit-up', 'Weighted Sit-up', 'GHD Hip Extension', 'V-up', 'Tuck-up', 'Hollow Hold', 'Hollow Rock',
  'Arch Hold', 'Superman', 'Plank', 'Side Plank', 'Russian Twist', 'Ab Wheel Rollout', 'Dead Bug',
  'Bird Dog', 'Windshield Wipers', 'Dragon Flag', 'Pallof Press', 'Reverse Hyper',
  // Accesorii & Preventie
  'Band Pull-Apart', 'Face Pull', 'Banded Good Morning', 'Nordic Hamstring Curl', 'Glute Ham Raise',
  'Calf Raise', 'Single-Leg RDL', 'Copenhagen Plank', 'Cuban Rotation', 'Scap Pull-up', 'Scap Push-up', 'Ring Support Hold',
  // Girls
  'Angie', 'Annie', 'Amanda', 'Barbara', 'Chelsea', 'Cindy', 'Diane', 'Elizabeth', 'Eva',
  'Fran', 'Grace', 'Helen', 'Isabel', 'Jackie', 'Karen', 'Kelly', 'Linda', 'Lynne', 'Mary', 'Nancy', 'Nicole',
  // Heroes
  'Murph', 'DT', 'Randy', 'Michael', 'Ryan', 'Josh', 'J.T.', 'Nate', 'Danny',
  'Adam', 'Badger', 'Forrest', 'Kalsu', 'Ship', 'Scott', 'Griff', 'Glen', 'Nutts', 'Desforges',
]

// Sugereaza miscari din MISCARI pe masura ce se scrie ultimul cuvant dintr-un
// text liber gen "21 Thrusters @ 43kg" (nu doar potriviri de la inceputul
// stringului, ca la CautareMiscare, fiindca aici textul contine si reps/greutate).
export function miscareSugestii(text) {
  const cuvant = text.trim().split(/\s+/).pop()
  if (!cuvant || cuvant.length < 2) return []
  return MISCARI.filter(m => m.toLowerCase().includes(cuvant.toLowerCase())).slice(0, 5)
}

function titleCase(s) {
  return s.split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(' ')
}

// Recunoaste automat reps + miscare + greutate dintr-o linie de text liber,
// lipita in bloc dintr-o sursa externa (WhatsApp, PDF etc. - "Paste rapid"
// din editorul de variante Admin) - normalizeaza spre acelasi format
// "{reps} {Miscare} @ {greutate}{unit}" pe care il produce si MiscareQuickAdd
// cand adaugi manual o miscare. Nu e doar cosmetic: composePartialText/
// parsePartialText (workoutFormats.js, folosite la For Time/Ladder pt
// reps-ul prescris per miscare) cer exact acest format cu reps-ul la
// inceput ca sa functioneze corect - text lipit in alt format (fara reps la
// inceput) ar strica pre-completarea reps-urilor la logare.
// Miscarea e normalizata la litera mare/mica canonica din MISCARI doar la
// potrivire EXACTA (case-insensitive) - o miscare care nu se potriveste
// (plural, varianta usor diferita, sau complet noua) ramane neschimbata (doar
// title-case), fara sa fie blocata sau semnalata: MISCARI e o lista statica
// din cod (nu un tabel editabil live), nu exista unde sa fie "adaugata" o
// miscare noua la runtime - orice text e acceptat, la fel ca inainte.
export function parseMiscareLinePasta(linie) {
  const text = (linie || '').trim()
  if (!text) return text

  const cardioMatch = CARDIO_MISCARI.find(c => text.toLowerCase().includes(c.toLowerCase()))
  if (cardioMatch) {
    const metriM = text.match(/(\d+(?:\.\d+)?)\s*m\b/i)
    const calM = text.match(/(\d+(?:\.\d+)?)\s*cal/i)
    const parts = []
    if (metriM) parts.push(`${metriM[1]}m`)
    else if (calM) parts.push(`${calM[1]} Cal`)
    parts.push(cardioMatch)
    return parts.join(' ')
  }

  let rest = text
  let reps = ''
  const repsM = rest.match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
  if (repsM) { reps = repsM[1]; rest = repsM[2] }

  let weight = ''
  const weightM = rest.match(/\(?\s*(?:@\s*)?(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)\s*(kg|lbs)\s*\)?\s*$/i)
  if (weightM) {
    weight = `${weightM[1].replace(/\s+/g, '')}${weightM[2].toLowerCase()}`
    rest = rest.slice(0, weightM.index).trim()
  }

  const exact = MISCARI.find(m => m.toLowerCase() === rest.toLowerCase())
  const numeMiscare = exact || titleCase(rest)

  const parts = []
  if (reps) parts.push(reps)
  parts.push(numeMiscare)
  let final = parts.join(' ')
  if (weight) final += ` @ ${weight}`
  return final
}
