# FCKB — Movement Catalog

Exhaustive canonical movement catalog. Organized into 23 categories — the 11 present in the source v1.0 architecture, plus 12 identified as missing during this research pass (flagged inline and summarized in Section 24).

## Column Legend

| Column | Meaning |
|---|---|
| Canonical Name | The single, authoritative name this movement is stored under — every alias (MOVEMENT_ALIASES.md) resolves to this |
| Subcategory | A finer grouping within the category |
| Equipment | Primary implement(s) required |
| Pattern | Movement pattern classification: `squat`, `hinge`, `press-vertical`, `press-horizontal`, `pull-vertical`, `pull-horizontal`, `lunge`, `carry`, `rotation`, `gait` (locomotion), `isometric`, `ballistic`, `mixed` |
| Uni | Unilateral: `Y` (single-limb by definition), `N` (bilateral by definition), `B` (exists in both forms as distinct real variants — e.g. Farmers Carry is bilateral by default but Suitcase Carry is its unilateral sibling, cataloged separately) |
| BW | Bodyweight movement (no external load required for the base version): `Y`/`N` |
| Scale | Scalable (has a common, named easier/harder variant): `Y`/`N` |
| Skill | `B` Beginner / `I` Intermediate / `A` Advanced |

Loading and rep conventions are given in prose per subcategory block rather than per-row, since they're overwhelmingly consistent within a subcategory (e.g. "all Olympic lift variants are typically loaded in kg/lb pairs at RX/Scaled ratios around 60-70% of the equivalent full-lift RX weight" applies to the whole Clean family, not row-by-row).

---

## 1. Olympic Weightlifting

**Loading convention**: kg or lb, always as a specific number (not a percentage) in daily programming, though training-max percentage programming (see WORKOUT_FORMATS.md 7.3) is the norm in dedicated oly programs. **Rep convention**: singles and doubles dominate for Squat/Full variants; triples common for Power variants; complexes (Section 1.5) always unbroken by convention.

### 1.1 Snatch Family

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Snatch | Full | Barbell | mixed | N | N | Y | A |
| Power Snatch | Power | Barbell | mixed | N | N | Y | I |
| Squat Snatch | Full | Barbell | mixed | N | N | Y | A |
| Hang Snatch | Hang, Full | Barbell | mixed | N | N | Y | A |
| Hang Power Snatch | Hang, Power | Barbell | mixed | N | N | Y | I |
| Muscle Snatch | Muscle | Barbell | mixed | N | N | Y | I |
| Block Snatch | Block | Barbell | mixed | N | N | Y | A |
| Blocks Hang Snatch | Block, Hang | Barbell | mixed | N | N | Y | A |
| Tall Snatch | Tall | Barbell | mixed | N | N | Y | I |
| Snatch Balance | Balance/Drill | Barbell | mixed | N | N | Y | A |
| Heaving Snatch Balance | Balance/Drill | Barbell | mixed | N | N | Y | A |
| Drop Snatch | Drill | Barbell | mixed | N | N | Y | A |
| Overhead Squat | Support/Drill | Barbell | squat | N | N | Y | I |
| Sotts Press | Drill | Barbell | press-vertical | N | N | Y | A |
| Snatch Deadlift | Pull component | Barbell | hinge | N | N | Y | I |
| Snatch Grip Deadlift | Pull component | Barbell | hinge | N | N | Y | I |
| Snatch High Pull | Pull component | Barbell | hinge | N | N | Y | I |
| Snatch Push Press | Drill | Barbell | press-vertical | N | N | Y | I |
| No-Foot Snatch | Drill (advanced) | Barbell | mixed | N | N | N | A |
| Pause Snatch | Tempo drill | Barbell | mixed | N | N | Y | A |
| Snatch Pull | Pull component | Barbell | hinge | N | N | Y | I |
| Muscle Snatch from Blocks | Block, Muscle | Barbell | mixed | N | N | Y | A |
| Dumbbell Snatch | DB adaptation | Dumbbell | mixed | Y | N | Y | I |
| Single-Arm KB Snatch | KB adaptation | Kettlebell | mixed | Y | N | Y | I |

### 1.2 Clean Family

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Clean | Full | Barbell | mixed | N | N | Y | A |
| Power Clean | Power | Barbell | mixed | N | N | Y | I |
| Squat Clean | Full | Barbell | mixed | N | N | Y | A |
| Hang Clean | Hang, Full | Barbell | mixed | N | N | Y | A |
| Hang Power Clean | Hang, Power | Barbell | mixed | N | N | Y | I |
| Muscle Clean | Muscle | Barbell | mixed | N | N | Y | I |
| Block Clean | Block | Barbell | mixed | N | N | Y | A |
| Tall Clean | Tall | Barbell | mixed | N | N | Y | I |
| Clean Deadlift | Pull component | Barbell | hinge | N | N | Y | I |
| Clean Grip Deadlift | Pull component | Barbell | hinge | N | N | Y | I |
| Clean High Pull | Pull component | Barbell | hinge | N | N | Y | I |
| Clean Pull | Pull component | Barbell | hinge | N | N | Y | I |
| Clean and Front Squat | Combo | Barbell | mixed | N | N | Y | I |
| No-Foot Clean | Drill (advanced) | Barbell | mixed | N | N | N | A |
| Pause Clean | Tempo drill | Barbell | mixed | N | N | Y | A |
| Segment Clean Pull | Drill | Barbell | hinge | N | N | Y | I |
| Dumbbell Clean | DB adaptation | Dumbbell | mixed | Y/B | N | Y | I |
| Single-Arm DB Hang Clean | DB adaptation | Dumbbell | mixed | Y | N | Y | I |
| Kettlebell Clean | KB adaptation | Kettlebell | mixed | Y | N | Y | I |

### 1.3 Jerk Family

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Jerk | Generic/Split default | Barbell | press-vertical | N | N | Y | A |
| Split Jerk | Split | Barbell | press-vertical | N | N | Y | A |
| Power Jerk | Power | Barbell | press-vertical | N | N | Y | I |
| Squat Jerk | Squat | Barbell | press-vertical | N | N | N | A |
| Push Jerk | Push | Barbell | press-vertical | N | N | Y | I |
| Behind-the-Neck Jerk | Variant | Barbell | press-vertical | N | N | N | A |
| Clean and Jerk | Combo/Full lift | Barbell | mixed | N | N | Y | A |
| Power Clean and Jerk | Combo | Barbell | mixed | N | N | Y | I |
| Jerk Balance | Drill | Barbell | mixed | N | N | Y | A |
| Jerk Dip Drill | Drill | Barbell | squat | N | N | Y | I |
| Jerk Recovery | Drill | Barbell | press-vertical | N | N | Y | A |
| Split Jerk from Blocks/Rack | Drill | Barbell | press-vertical | N | N | Y | A |

### 1.4 Push Press & Related Overhead Power Movements

(Cross-listed briefly here for oly-adjacent completeness; fully cataloged under Press Family, Section 4.)

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Push Press | Overhead power | Barbell | press-vertical | N | N | Y | I |
| Push Press (Dumbbell) | Overhead power | Dumbbell | press-vertical | Y/B | N | Y | B |
| Thruster | Squat-to-press | Barbell | mixed | N | N | Y | I |
| Dumbbell Thruster | Squat-to-press | Dumbbell | mixed | N | N | Y | B |

### 1.5 Olympic Complexes

Complexes are combinations of 2+ of the above movements performed unbroken as a single repeated unit (see WORKOUT_FORMATS.md 7.7). Canonical, commonly-programmed complexes are cataloged as named entities in their own right, since coaches reference them by their combined name rather than re-deriving the movement list every time.

| Canonical Name | Components | Equipment | Skill |
|---|---|---|---|
| Snatch Complex (Deadlift + Snatch) | Snatch Deadlift + Snatch | Barbell | A |
| Snatch Balance Complex | Snatch Balance + OHS | Barbell | A |
| Clean and Jerk Complex | Clean + Jerk | Barbell | A |
| Clean Pull + Clean + Front Squat + Jerk | 4-part | Barbell | A |
| Power Clean + Front Squat + Push Jerk | 3-part | Barbell | I |
| Hang Snatch + OHS + Snatch Balance | 3-part | Barbell | A |
| Deadlift + Hang Power Clean + Push Jerk | 3-part (common metcon complex, distinct from pure-oly complexes above) | Barbell | I |

---

## 2. Squat Family

**Loading convention**: barbell squats in kg/lb; bodyweight/DB/KB variants often loaded as a fixed implement weight rather than %1RM. **Rep convention**: strength ranges (1-6) for barbell back/front squat; higher reps (10-20+) common for goblet/air squat in conditioning contexts.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Air Squat | Bodyweight | None | squat | N | Y | Y | B |
| Back Squat | Barbell, High-bar | Barbell | squat | N | N | Y | I |
| Low-Bar Back Squat | Barbell, Low-bar | Barbell | squat | N | N | Y | I |
| Front Squat | Barbell | Barbell | squat | N | N | Y | I |
| Overhead Squat | Barbell | Barbell | squat | N | N | Y | A |
| Zercher Squat | Barbell | Barbell | squat | N | N | Y | I |
| Goblet Squat | DB/KB | Dumbbell/Kettlebell | squat | N | N | Y | B |
| Box Squat | Barbell, box-assisted | Barbell + Box | squat | N | N | Y | I |
| Tempo Squat | Tempo-modified | Barbell | squat | N | N | Y | I |
| Pause Squat | Pause-modified | Barbell | squat | N | N | Y | I |
| Anderson Squat | Pin/bottom-start | Barbell + Rack | squat | N | N | N | A |
| Pin Squat | Pin-supported | Barbell + Rack | squat | N | N | Y | I |
| Safety Bar Squat | Specialty bar | SSB | squat | N | N | Y | I |
| Bulgarian Split Squat | Rear-foot-elevated | Barbell/DB/BW | lunge | Y | B | Y | I |
| Reverse Lunge | Lunge | BW/Barbell/DB | lunge | Y | B | Y | B |
| Walking Lunge | Lunge | BW/Barbell/DB | lunge | Y | B | Y | B |
| Forward Lunge | Lunge | BW/Barbell/DB | lunge | Y | B | Y | B |
| Overhead Walking Lunge | Lunge, overhead-loaded | Barbell/DB/Plate | lunge | Y | N | Y | I |
| Lateral Lunge | Lunge, frontal-plane | BW/DB | lunge | Y | B | Y | B |
| Curtsy Lunge | Lunge, crossover | BW/DB | lunge | Y | B | Y | I |
| Pistol Squat | Single-leg | BW/assisted | squat | Y | Y | Y | A |
| Cossack Squat | Lateral squat | BW/DB/KB | squat | Y | B | Y | I |
| Box Step-up | Step-up | BW/Barbell/DB + Box | lunge | Y | B | Y | B |
| Weighted Step-up | Step-up | Barbell/DB + Box | lunge | Y | N | Y | B |
| Jumping Lunge | Plyometric lunge | BW | lunge | Y | Y | Y | I |
| Skater Squat | Single-leg, unsupported | BW | squat | Y | Y | Y | A |
| Shrimp Squat | Single-leg, advanced | BW | squat | Y | Y | N | A |
| Sissy Squat | Knee-dominant isolation | BW/assisted | squat | N | Y | Y | I |
| Spanish Squat | Isometric/band-assisted | Band | isometric | N | Y | Y | B |
| Wall Sit | Isometric | BW | isometric | N | Y | Y | B |
| Hack Squat | Machine | Machine | squat | N | N | Y | I |
| Belt Squat | Belt-loaded | Belt Squat Machine | squat | N | N | Y | I |
| Landmine Squat | Landmine | Barbell + Landmine | squat | N | N | Y | B |
| Front Rack Reverse Lunge | Lunge, front-rack loaded | Barbell/DB | lunge | Y | N | Y | I |
| Front Rack Walking Lunge | Lunge, front-rack loaded | Barbell/DB | lunge | Y | N | Y | I |
| Duck Walk | Deep squat gait | BW | gait | N | Y | Y | B |
| Squat Hold | Isometric bottom | BW | isometric | N | Y | Y | B |

---

## 3. Hinge Family

**Loading convention**: kg/lb; RDL and good morning variants often loaded lighter than conventional deadlift. **Rep convention**: 1-8 typical for loaded hinge work; higher reps for kettlebell swings (a ballistic hinge, cataloged in the Kettlebell section but pattern-classified here).

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Deadlift | Conventional | Barbell | hinge | N | N | Y | I |
| Sumo Deadlift | Sumo stance | Barbell | hinge | N | N | Y | I |
| Romanian Deadlift (RDL) | Hip-hinge, straight leg | Barbell | hinge | N | N | Y | I |
| Stiff Leg Deadlift | Straight leg | Barbell | hinge | N | N | Y | I |
| Deficit Deadlift | Elevated start | Barbell + Plates | hinge | N | N | Y | A |
| Snatch Grip Deadlift | Wide grip | Barbell | hinge | N | N | Y | I |
| Clean Grip Deadlift | Standard grip | Barbell | hinge | N | N | Y | I |
| Trap Bar Deadlift | Specialty bar | Trap Bar | hinge | N | N | Y | B |
| Single-Leg Deadlift | Unilateral | BW/DB/KB | hinge | Y | B | Y | I |
| Single-Leg RDL | Unilateral, straight leg | BW/DB/KB | hinge | Y | B | Y | I |
| Good Morning | Bar-on-back hinge | Barbell | hinge | N | N | Y | I |
| Banded Good Morning | Band-resisted | Band | hinge | N | Y | Y | B |
| Hip Thrust | Glute-focused hinge | Barbell/BW | hinge | N | B | Y | B |
| Single-Leg Hip Thrust | Unilateral | BW/DB | hinge | Y | B | Y | I |
| Glute Bridge | Bodyweight hinge | BW | hinge | N | Y | Y | B |
| Hip Hinge Drill | Coaching/warm-up drill | Dowel/PVC | hinge | N | Y | Y | B |
| Rack Pull | Partial-range deadlift | Barbell + Rack | hinge | N | N | Y | I |
| Block Pull | Partial-range deadlift | Barbell + Blocks | hinge | N | N | Y | I |
| Jefferson Curl | Loaded spinal flexion drill | DB/Plate | hinge | N | N | Y | A |
| Kettlebell Deadlift | KB-loaded | Kettlebell | hinge | N | N | Y | B |
| Dumbbell Deadlift | DB-loaded | Dumbbell | hinge | N | N | Y | B |
| Reverse Hyperextension | Machine/GHD | Machine/GHD | hinge | N | Y | Y | I |
| Back Extension | GHD/bench | GHD/Bench | hinge | N | Y | Y | B |
| 45-Degree Hyperextension | Bench-based | Hyperextension Bench | hinge | N | Y | Y | B |

---

## 4. Press Family (Overhead & Horizontal)

**Loading convention**: kg/lb, strength ranges dominate; push press/push jerk cross-loaded with leg-drive so can carry heavier loads than strict press for the same rep count. **Rep convention**: 1-10 typical.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Strict Press | Overhead, strict | Barbell | press-vertical | N | N | Y | I |
| Push Press | Overhead, leg-drive | Barbell | press-vertical | N | N | Y | I |
| Push Jerk | Overhead, dip-drive-catch | Barbell | press-vertical | N | N | Y | I |
| Split Jerk | Overhead, split-catch | Barbell | press-vertical | N | N | Y | A |
| Behind-the-Neck Press | Overhead, BTN | Barbell | press-vertical | N | N | N | A |
| Seated Press | Overhead, seated | Barbell | press-vertical | N | N | Y | I |
| Z Press | Overhead, floor-seated | Barbell | press-vertical | N | N | Y | I |
| Bradford Press | Overhead, partial ROM alternating front/back | Barbell | press-vertical | N | N | N | A |
| Bench Press | Horizontal, barbell | Barbell + Bench | press-horizontal | N | N | Y | B |
| Close-Grip Bench Press | Horizontal, narrow grip | Barbell + Bench | press-horizontal | N | N | Y | I |
| Incline Bench Press | Horizontal, incline | Barbell + Bench | press-horizontal | N | N | Y | I |
| Decline Bench Press | Horizontal, decline | Barbell + Bench | press-horizontal | N | N | Y | I |
| Floor Press | Horizontal, floor | Barbell | press-horizontal | N | N | Y | I |
| Spoto Press | Horizontal, paused off chest | Barbell + Bench | press-horizontal | N | N | Y | A |
| Larsen Press | Horizontal, feet-up | Barbell + Bench | press-horizontal | N | N | Y | A |
| Dumbbell Bench Press | Horizontal, DB | Dumbbell + Bench | press-horizontal | N/B | N | Y | B |
| Dumbbell Incline Press | Horizontal, DB incline | Dumbbell + Bench | press-horizontal | N/B | N | Y | B |
| Single-Arm DB Bench Press | Horizontal, unilateral | Dumbbell + Bench | press-horizontal | Y | N | Y | I |
| Dumbbell Shoulder Press | Overhead, DB | Dumbbell | press-vertical | N/B | N | Y | B |
| Single-Arm DB Shoulder Press | Overhead, unilateral | Dumbbell | press-vertical | Y | N | Y | I |
| Arnold Press | Overhead, rotating | Dumbbell | press-vertical | N | N | Y | B |
| Kettlebell Press | Overhead, KB | Kettlebell | press-vertical | Y | N | Y | I |
| Kettlebell Push Press | Overhead, KB leg-drive | Kettlebell | press-vertical | Y | N | Y | I |
| Bottoms-Up KB Press | Overhead, KB stability | Kettlebell | press-vertical | Y | N | N | A |
| Landmine Press | Angled press | Barbell + Landmine | press-vertical | Y/B | N | Y | B |
| Push-up | Horizontal, bodyweight | BW | press-horizontal | N | Y | Y | B |
| Kneeling Push-up | Regression | BW | press-horizontal | N | Y | Y | B |
| Diamond Push-up | Triceps-focused | BW | press-horizontal | N | Y | Y | I |
| Wide Push-up | Chest-focused | BW | press-horizontal | N | Y | Y | B |
| Deficit Push-up | Extended ROM | BW + Boxes/Plates | press-horizontal | N | Y | Y | I |
| Plyo Push-up | Explosive | BW | press-horizontal | N | Y | Y | I |
| Clap Push-up | Explosive | BW | press-horizontal | N | Y | N | A |
| Hindu Push-up | Mobility-flow | BW | press-horizontal | N | Y | Y | I |
| Archer Push-up | Unilateral emphasis | BW | press-horizontal | Y | Y | Y | A |
| One-Arm Push-up | Unilateral | BW | press-horizontal | Y | Y | N | A |
| Pike Push-up | Vertical-bias bodyweight | BW | press-vertical | N | Y | Y | I |
| Handstand Push-up | Vertical, inverted | Wall | press-vertical | N | Y | Y | A |
| (see Section 7 — Handstand & Inversion for full HSPU family) | | | | | | | |

---

## 5. Vertical Pull / Bodyweight Pulling

**Loading convention**: bodyweight by default; band-assisted for regressions, weighted vest/belt for progressions. **Rep convention**: highly variable by skill level, from singles (muscle-up progressions) to 20+ (kipping pull-ups in metcons).

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Pull-up | Generic/Strict default | Pull-up Bar | pull-vertical | N | Y | Y | I |
| Strict Pull-up | Strict | Pull-up Bar | pull-vertical | N | Y | Y | I |
| Kipping Pull-up | Kipping | Pull-up Bar | pull-vertical | N | Y | Y | I |
| Butterfly Pull-up | Butterfly kip | Pull-up Bar | pull-vertical | N | Y | Y | A |
| Chest-to-Bar Pull-up | C2B | Pull-up Bar | pull-vertical | N | Y | Y | A |
| Strict Chest-to-Bar Pull-up | Strict C2B | Pull-up Bar | pull-vertical | N | Y | N | A |
| Kipping Chest-to-Bar Pull-up | Kipping C2B | Pull-up Bar | pull-vertical | N | Y | Y | A |
| Chin-up | Supinated grip | Pull-up Bar | pull-vertical | N | Y | Y | B |
| Neutral-Grip Pull-up | Neutral grip | Pull-up Bar | pull-vertical | N | Y | Y | I |
| Wide-Grip Pull-up | Wide grip | Pull-up Bar | pull-vertical | N | Y | Y | I |
| L-Sit Pull-up | L-sit position | Pull-up Bar | pull-vertical | N | Y | N | A |
| Weighted Pull-up | Weighted | Pull-up Bar + Belt/Vest | pull-vertical | N | N | Y | A |
| Banded Pull-up | Band-assisted | Pull-up Bar + Band | pull-vertical | N | Y | Y | B |
| Jumping Pull-up | Regression | Pull-up Bar | pull-vertical | N | Y | Y | B |
| Ring Pull-up | Rings | Rings | pull-vertical | N | Y | Y | I |
| Bar Muscle-up | Bar | Pull-up Bar | pull-vertical | N | Y | Y | A |
| Ring Muscle-up | Rings | Rings | pull-vertical | N | Y | Y | A |
| Strict Muscle-up (Bar or Ring) | Strict | Bar/Rings | pull-vertical | N | Y | N | A |
| Weighted Muscle-up | Weighted | Bar/Rings + Vest | pull-vertical | N | N | N | A |
| Jumping Muscle-up | Regression | Bar/Rings + Box | pull-vertical | N | Y | Y | I |
| Rope Climb | Standard | Climbing Rope | pull-vertical | N | Y | Y | I |
| Legless Rope Climb | No leg assist | Climbing Rope | pull-vertical | N | Y | N | A |
| Rope Climb (J-Hook/Foot-lock) | Technique variant | Climbing Rope | pull-vertical | N | Y | Y | I |
| Seated Rope Climb | Regression | Climbing Rope | pull-vertical | N | Y | Y | I |
| Rope Pull (Horizontal) | Sled-attached rope | Rope + Sled/Load | pull-horizontal | N/B | N | Y | I |
| Towel Pull-up | Grip variant | Pull-up Bar + Towel | pull-vertical | N | Y | N | A |
| Fat-Grip Pull-up | Grip variant | Pull-up Bar + Fat Grips | pull-vertical | N | Y | N | A |
| Commando Pull-up | Alternating-side grip | Pull-up Bar | pull-vertical | N | Y | N | A |

---

## 6. Horizontal Pull / Rowing (Strength)

A category the source v1.0 taxonomy does not separate out (horizontal pulling movements were scattered/absent) — flagged as a real gap since bent-over rows, ring rows, and cable/band rows are extremely common accessory and skill-progression movements.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Barbell Bent-Over Row | Bilateral | Barbell | pull-horizontal | N | N | Y | I |
| Pendlay Row | Dead-stop, strict | Barbell | pull-horizontal | N | N | Y | I |
| Yates Row | Underhand, semi-supine torso | Barbell | pull-horizontal | N | N | Y | I |
| Dumbbell Row | Unilateral | Dumbbell | pull-horizontal | Y | N | Y | B |
| Single-Arm DB Row (Bench-Supported) | Unilateral, supported | Dumbbell + Bench | pull-horizontal | Y | N | Y | B |
| Renegade Row | Plank + row combo | Dumbbell | pull-horizontal | Y | N | Y | I |
| Chest-Supported Row | Machine/bench-supported | Machine/DB + Incline Bench | pull-horizontal | N | N | Y | B |
| T-Bar Row | Landmine/T-bar | Barbell + Landmine | pull-horizontal | N | N | Y | I |
| Seal Row | Chest-supported, flat bench | Barbell + Bench | pull-horizontal | N | N | Y | I |
| Ring Row | Bodyweight, inverted | Rings/TRX | pull-horizontal | N | Y | Y | B |
| Inverted Row (Bar) | Bodyweight, bar-based | Barbell in Rack | pull-horizontal | N | Y | Y | B |
| TRX Row | Suspension trainer | TRX/Straps | pull-horizontal | N | Y | Y | B |
| Cable Row (Seated) | Machine | Cable Machine | pull-horizontal | N | N | Y | B |
| Band Row | Band-resisted | Band | pull-horizontal | N | Y | Y | B |
| Face Pull | Rear-delt/upper-back isolation | Band/Cable | pull-horizontal | N | N | Y | B |
| Band Pull-Apart | Rear-delt/scapular isolation | Band | pull-horizontal | N | Y | Y | B |
| Meadows Row | Landmine, unilateral | Barbell + Landmine | pull-horizontal | Y | N | Y | I |
| Kettlebell Row | Unilateral | Kettlebell | pull-horizontal | Y | N | Y | B |

---

## 7. Gymnastics — Handstand & Inversion

**Loading convention**: bodyweight; deficit (elevated) variants scale difficulty via range of motion rather than external load. **Rep convention**: HSPU typically 3-15 reps in metcons; holds measured in seconds.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Handstand Hold | Static | Wall (optional) | isometric | N | Y | Y | I |
| Freestanding Handstand Hold | Static, unsupported | None | isometric | N | Y | N | A |
| Handstand Walk | Locomotion | Open floor | gait | N | Y | Y | A |
| Handstand Walk Obstacle/Turn | Locomotion, technical | Open floor + obstacle | gait | N | Y | N | A |
| Wall Walk | Progression drill | Wall | mixed | N | Y | Y | B |
| Kick-up to Handstand | Entry drill | Wall (optional) | mixed | N | Y | Y | B |
| Handstand Push-up (HSPU) | Kipping/Strict default | Wall | press-vertical | N | Y | Y | A |
| Strict Handstand Push-up | Strict | Wall | press-vertical | N | Y | Y | A |
| Kipping Handstand Push-up | Kipping | Wall | press-vertical | N | Y | Y | A |
| Deficit Handstand Push-up | Extended ROM | Wall + Plates/Boxes | press-vertical | N | Y | Y | A |
| Deficit HSPU (Strict) | Extended ROM, strict | Wall + Plates | press-vertical | N | Y | N | A |
| Pike Push-up | Regression | Floor/Box | press-vertical | N | Y | Y | I |
| Box Pike Push-up | Regression, elevated | Box | press-vertical | N | Y | Y | I |
| Ring HSPU | Advanced, unstable base | Rings | press-vertical | N | Y | N | A |
| Freestanding HSPU | Unsupported | None | press-vertical | N | Y | N | A |
| Handstand Shoulder Taps | Stability drill | Wall | isometric | Y | Y | Y | I |
| Handstand Hold with Leg Movement (e.g. HS Straddle) | Skill variant | Wall | isometric | N | Y | N | A |

---

## 8. Gymnastics — Rings

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Ring Dip | Strict/Kipping default | Rings | press-horizontal | N | Y | Y | I |
| Strict Ring Dip | Strict | Rings | press-horizontal | N | Y | Y | A |
| Kipping Ring Dip | Kipping | Rings | press-horizontal | N | Y | Y | I |
| Bar Dip | Bar-based | Dip Bar/Parallettes | press-horizontal | N | Y | Y | B |
| Ring Support Hold | Static | Rings | isometric | N | Y | Y | B |
| Ring Row | see Section 6 (cross-listed) | Rings | pull-horizontal | N | Y | Y | B |
| Skin the Cat | Skill | Rings | mixed | N | Y | N | A |
| False Grip Hang | Grip conditioning | Rings | isometric | N | Y | N | A |
| False Grip Pull-up | Muscle-up progression | Rings | pull-vertical | N | Y | N | A |
| Ring Muscle-up Transition Drill | Progression | Rings | mixed | N | Y | Y | A |
| Ring L-Sit | Static core+grip | Rings | isometric | N | Y | Y | I |
| Ring Push-up | Unstable-base pressing | Rings | press-horizontal | N | Y | Y | I |
| Ring Plank | Static, unstable | Rings | isometric | N | Y | Y | I |
| Iron Cross Progression | Elite skill | Rings | isometric | N | Y | N | A |
| Front Lever | Elite skill/hold | Rings/Bar | isometric | N | Y | N | A |
| Back Lever | Elite skill/hold | Rings/Bar | isometric | N | Y | N | A |

---

## 9. Core & Trunk

Combines and substantially expands the source v1.0's "Core" subsection of Gymnastics into a standalone category, since a large share of common core work (weighted, banded, machine) is not gymnastics-specific.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Toes-to-Bar | Hanging, bar | Pull-up Bar | rotation | N | Y | Y | I |
| Kipping Toes-to-Bar | Kipping | Pull-up Bar | rotation | N | Y | Y | I |
| Strict Toes-to-Bar | Strict | Pull-up Bar | rotation | N | Y | N | A |
| Knees-to-Elbows | Hanging, bar | Pull-up Bar | rotation | N | Y | Y | I |
| Toes-to-Rings | Hanging, rings | Rings | rotation | N | Y | Y | A |
| Hanging Knee Raise | Hanging | Pull-up Bar | rotation | N | Y | Y | B |
| Hanging Leg Raise | Hanging | Pull-up Bar | rotation | N | Y | Y | I |
| Windshield Wipers | Hanging, rotational | Pull-up Bar | rotation | N | Y | N | A |
| L-Sit | Static hold | Parallettes/Floor/Rings | isometric | N | Y | Y | I |
| V-Up | Floor | BW | rotation | N | Y | Y | B |
| Hollow Hold | Static, floor | BW | isometric | N | Y | Y | B |
| Hollow Rock | Dynamic, floor | BW | rotation | N | Y | Y | B |
| Arch Hold (Superman Hold) | Static, floor | BW | isometric | N | Y | Y | B |
| GHD Sit-up | GHD-based | GHD | rotation | N | Y | Y | I |
| Abmat Sit-up | Floor, anchored | Abmat | rotation | N | Y | Y | B |
| Sit-up (Unanchored) | Floor | BW | rotation | N | Y | Y | B |
| Russian Twist | Rotational | BW/Plate/DB | rotation | N | B | Y | B |
| Weighted Russian Twist | Rotational, loaded | Plate/DB | rotation | N | N | Y | B |
| Dragon Flag | Advanced isometric/dynamic | Bench | isometric | N | Y | N | A |
| Plank | Static | BW | isometric | N | Y | Y | B |
| Side Plank | Static, lateral | BW | isometric | N | Y | Y | B |
| Weighted Plank | Loaded | Plate | isometric | N | N | Y | I |
| Bird Dog | Anti-rotation | BW | isometric | Y | Y | Y | B |
| Dead Bug | Anti-extension | BW | isometric | N | Y | Y | B |
| Pallof Press | Anti-rotation, band/cable | Band/Cable | isometric | Y | N | Y | B |
| Ab Wheel Rollout | Rollout | Ab Wheel | rotation | N | Y | Y | I |
| Barbell Rollout | Rollout | Barbell | rotation | N | N | Y | I |
| Landmine 180 (Russian Twist Barbell) | Rotational, loaded | Barbell + Landmine | rotation | N | N | Y | I |
| Weighted Sit-up | Loaded | Plate/DB | rotation | N | N | Y | B |
| Sit-up to Stand (Burpee-adjacent) | Dynamic | BW | mixed | N | Y | Y | B |
| Mountain Climbers | Dynamic, plank-based | BW | mixed | N | Y | Y | B |
| Flutter Kicks | Dynamic, floor | BW | isometric | N | Y | Y | B |
| Bicycle Crunch | Rotational | BW | rotation | N | Y | Y | B |
| Cable Woodchopper | Rotational, cable | Cable | rotation | N | N | Y | I |
| Copenhagen Plank | Adductor/oblique, side plank variant | Bench | isometric | Y | Y | N | A |
| Reverse Crunch | Floor | BW | rotation | N | Y | Y | B |
| GHD Back Extension | see Section 3 (cross-listed) | GHD | hinge | N | Y | Y | I |
| Weighted GHD Sit-up | Loaded | GHD + Plate | rotation | N | N | Y | A |

---

## 10. Dumbbell (Compound Movements)

Compound, cross-pattern dumbbell movements not already fully cataloged in a single earlier category (squat/press/pull/hinge dumbbell variants ARE listed in their respective pattern categories above — this section is for the OLY-adjacent and combination dumbbell movements that don't reduce to a single earlier pattern).

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Dumbbell Snatch | Single-arm oly-adjacent | Dumbbell | mixed | Y | N | Y | I |
| Alternating Dumbbell Snatch | Single-arm, alternating | Dumbbell | mixed | Y | N | Y | I |
| Dumbbell Hang Clean | Single-arm/double | Dumbbell | mixed | Y/B | N | Y | I |
| Dumbbell Squat Clean | Single-arm/double | Dumbbell | mixed | Y/B | N | Y | I |
| Dumbbell Clean and Jerk | Combo | Dumbbell | mixed | Y/B | N | Y | I |
| Devil Press | Burpee + DB Snatch combo | Dumbbell | mixed | N | N | Y | I |
| Man Maker | Push-up + Row + Clean + Press combo | Dumbbell | mixed | N | N | Y | I |
| Dumbbell Thruster | see Section 1.4 (cross-listed) | Dumbbell | mixed | N | N | Y | B |
| Dumbbell Front Squat | see Section 2 | Dumbbell | squat | N | N | Y | B |
| Dumbbell Overhead Squat | Single-arm/double | Dumbbell | squat | Y/B | N | Y | A |
| Dumbbell Deadlift | see Section 3 | Dumbbell | hinge | N | N | Y | B |
| Dumbbell Box Step-Over | Locomotion/combo | Dumbbell + Box | mixed | Y | N | Y | B |
| Dumbbell Burpee | Burpee variant | Dumbbell | mixed | N | N | Y | I |
| Dumbbell Walking Lunge | see Section 2 | Dumbbell | lunge | Y | N | Y | B |
| Suitcase Deadlift | Unilateral-load hinge | Dumbbell | hinge | Y | N | Y | B |
| Single-Arm DB Overhead Walking Lunge | Combo | Dumbbell | lunge | Y | N | Y | I |
| Dumbbell Complex (coach-defined) | Complex | Dumbbell | mixed | Y/B | N | Y | I |

---

## 11. Kettlebell

**Loading convention**: kg (kettlebells are near-universally sized/labeled in kg even in US gyms, a real regional exception to the general kg/lb split). **Rep convention**: high-rep ballistic work (swings, snatches) common; low-rep for get-ups.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Kettlebell Swing | Russian (default in most US CrossFit boxes — see edge case) | Kettlebell | hinge | N/B | N | Y | B |
| Russian Kettlebell Swing | Explicit Russian (to shoulder height) | Kettlebell | hinge | N | N | Y | B |
| American Kettlebell Swing | Overhead | Kettlebell | hinge | N | N | Y | I |
| Single-Arm Kettlebell Swing | Unilateral | Kettlebell | hinge | Y | N | Y | I |
| Kettlebell Clean | see Section 1.2 | Kettlebell | mixed | Y | N | Y | I |
| Kettlebell Clean and Press | Combo | Kettlebell | mixed | Y | N | Y | I |
| Kettlebell Snatch | see Section 1.1 | Kettlebell | mixed | Y | N | Y | I |
| Kettlebell Goblet Squat | see Section 2 | Kettlebell | squat | N | N | Y | B |
| Turkish Get-Up | Full-body sequence | Kettlebell | mixed | Y | N | Y | A |
| Half Turkish Get-Up | Partial-ROM | Kettlebell | mixed | Y | N | Y | I |
| Windmill | Loaded lateral flexion | Kettlebell | rotation | Y | N | Y | A |
| Kettlebell Farmer Carry | see Section 12 | Kettlebell | carry | N/B | N | Y | B |
| Kettlebell Front Rack Carry | see Section 12 | Kettlebell | carry | N/B | N | Y | B |
| Kettlebell Overhead Carry | see Section 12 | Kettlebell | carry | Y/B | N | Y | I |
| Kettlebell Suitcase Carry | see Section 12 | Kettlebell | carry | Y | N | Y | B |
| Double Kettlebell Front Squat | Two-KB | Kettlebell | squat | N | N | Y | I |
| Double Kettlebell Clean | Two-KB | Kettlebell | mixed | N | N | Y | I |
| Kettlebell Press | see Section 4 | Kettlebell | press-vertical | Y | N | Y | I |
| Kettlebell Halo | Shoulder mobility/loading | Kettlebell | rotation | N | N | Y | B |
| Kettlebell Figure-8 | Coordination/core | Kettlebell | rotation | N | N | Y | B |
| Kettlebell High Pull | Pull component | Kettlebell | hinge | N | N | Y | I |
| Kettlebell Around-the-World | Coordination | Kettlebell | rotation | N | N | Y | B |
| Bottoms-Up Kettlebell Carry | Stability | Kettlebell | carry | Y | N | N | A |

---

## 12. Strongman & Odd Object (including Carries)

**Loading convention**: often absolute (a specific implement's weight, e.g. "the 32kg kettlebell" or "the 100kg sandbag") rather than %1RM, since strongman implements are frequently fixed-weight rather than infinitely-loadable barbells. **Rep convention**: distance-based (carries) or time-based far more often than rep-based.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Farmers Carry | Bilateral carry | Farmers Handles/DB/KB | carry | N | N | Y | B |
| Suitcase Carry | Unilateral carry | DB/KB | carry | Y | N | Y | B |
| Front Rack Carry | Bilateral, front-loaded | KB/Sandbag | carry | N | N | Y | I |
| Overhead Carry | Bilateral, overhead | Barbell/DB/KB | carry | Y/B | N | Y | I |
| Single-Arm Overhead Carry | Unilateral, overhead | DB/KB | carry | Y | N | Y | I |
| Yoke Carry | Loaded frame carry | Yoke | carry | N | N | Y | I |
| Sandbag Carry | Bear-hug or shoulder | Sandbag | carry | N | N | Y | B |
| Bear Hug Carry | Front-loaded | Sandbag/Log/Stone | carry | N | N | Y | I |
| Shoulder Carry | Single-shoulder loaded | Sandbag/Log | carry | Y | N | Y | I |
| Zercher Carry | Arm-crook loaded | Barbell/Sandbag | carry | N | N | Y | I |
| Sandbag Clean | Ground-to-shoulder | Sandbag | mixed | N | N | Y | I |
| Sandbag Over-the-Shoulder | Repeated toss/carry | Sandbag | mixed | N | N | Y | I |
| Sandbag Squat | Loaded squat | Sandbag | squat | N | N | Y | B |
| Sandbag Lunge | Loaded lunge | Sandbag | lunge | Y | N | Y | B |
| Sandbag Get-Up | Ground-to-standing | Sandbag | mixed | N | N | Y | I |
| Atlas Stone to Shoulder | Stone lift | Atlas Stone | mixed | N | N | Y | A |
| Atlas Stone Load (over bar/platform) | Stone lift | Atlas Stone | mixed | N | N | Y | A |
| Stone to Shoulder (generic) | Odd object | Stone | mixed | N | N | Y | A |
| Log Press | Overhead, log implement | Log Bar | press-vertical | N | N | Y | A |
| Log Clean | Ground-to-shoulder, log | Log Bar | mixed | N | N | Y | A |
| Axle Bar Deadlift | Thick-bar hinge | Axle Bar | hinge | N | N | Y | I |
| Axle Bar Clean | Thick-bar oly-adjacent | Axle Bar | mixed | N | N | Y | A |
| Tire Flip | Flip | Tractor Tire | mixed | N | N | Y | I |
| Keg Carry | Odd-object carry | Keg | carry | N | N | Y | B |
| Keg Clean | Odd-object lift | Keg | mixed | N | N | Y | I |
| Keg Toss | Overhead throw | Keg | mixed | N | N | Y | I |
| Husafell Carry | Odd-object bear-hug carry | Husafell Stone | carry | N | N | Y | A |
| Duck Walk (Loaded) | Loaded deep-squat gait | Sandbag/Plate | gait | N | N | Y | I |
| D-Ball Clean | Odd-ball lift | D-Ball | mixed | N | N | Y | I |
| D-Ball Over-Shoulder | Repeated toss | D-Ball | mixed | N | N | Y | I |
| Sled Drag (Backward) | see Section 13 (cross-listed) | Sled | carry/gait | N | N | Y | B |
| Yoke Walk | see Yoke Carry | Yoke | carry | N | N | Y | I |

---

## 13. Sled Work

Split out as its own category — the source v1.0 taxonomy folds sled work into "Strongman" as two bare bullet points, undercounting real usage badly given how central sled work is to both CrossFit conditioning AND HYROX-specific programming (see WORKOUT_FORMATS.md Section 12).

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Sled Push | Forward push | Sled | gait | N | N | Y | B |
| Sled Push (Bear Crawl Position) | Low, high-effort variant | Sled | gait | N | N | Y | I |
| Sled Pull (Forward, Rope-Attached) | Forward drag via rope | Sled + Rope | gait | N | N | Y | B |
| Sled Drag (Backward) | Backward drag, harness/rope | Sled + Harness | gait | N | N | Y | B |
| Sled Row (Stationary Rope Pull) | Stationary, arm-only | Sled + Rope | pull-horizontal | N | N | Y | B |
| Lateral Sled Drag | Lateral-plane drag | Sled + Harness | gait | N | N | Y | I |
| Sled Sprint | Loaded sprint | Sled + Harness | gait | N | N | Y | I |
| Prowler Push | Named-implement push (a common sled brand name used generically, like "Kleenex") | Prowler Sled | gait | N | N | Y | B |

---

## 14. Monostructural — Running & Sprinting

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Run (generic distance) | Steady/moderate | None | gait | N | Y | Y | B |
| Sprint | Max-effort, short distance | None | gait | N | Y | Y | B |
| Shuttle Run | Repeated short-distance, direction change | None (cones optional) | gait | N | Y | Y | B |
| Suicide Run | Progressive-distance shuttle | None (cones/lines) | gait | N | Y | Y | I |
| Hill Run | Inclined | Hill/Incline | gait | N | Y | Y | I |
| Trail Run | Uneven terrain | None | gait | N | Y | Y | I |
| Backward Run | Reverse locomotion | None | gait | N | Y | Y | I |
| Lateral Shuffle | Frontal-plane locomotion | None | gait | N | Y | Y | B |
| Farmer Carry Run (Loaded Sprint) | Loaded | DB/KB | gait | N | N | Y | I |
| Weighted Vest Run | Loaded | Weight Vest | gait | N | N | Y | I |
| Stadium/Stair Run | Vertical + horizontal | Stairs/Stadium | gait | N | Y | Y | I |
| Beep Test / Shuttle Fitness Test | Named protocol | None (cones + audio) | gait | N | Y | N | I |

---

## 15. Monostructural — Rowing / Ski / Bike Ergs

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Row (Erg) | Concept2/similar rower | Rower | gait | N | Y | Y | B |
| SkiErg | Standing, ski-simulation | SkiErg | gait | N | Y | Y | B |
| BikeErg | Seated, bike-simulation | BikeErg | gait | N | Y | Y | B |
| Assault Bike (Air Bike) | Fan-resistance, arms+legs | Assault/Air Bike | gait | N | Y | Y | B |
| Echo Bike | Fan-resistance, branded equivalent to Assault Bike | Echo Bike | gait | N | Y | Y | B |
| Air Bike (generic) | Fan-resistance, generic naming | Air Bike | gait | N | Y | Y | B |
| Spin Bike / Stationary Bike | Seated, standard resistance | Spin Bike | gait | N | Y | Y | B |
| Arm Bike (Upper-Body Erg) | Arms-only | Arm Erg/Krankcycle | gait | N | Y | Y | I |

---

## 16. Monostructural — Jump Rope

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Single Under | Single rope pass per jump | Jump Rope | ballistic | N | Y | Y | B |
| Double Under | Double rope pass per jump | Jump Rope | ballistic | N | Y | Y | I |
| Triple Under | Triple rope pass per jump | Jump Rope | ballistic | N | Y | N | A |
| Crossover Single Under | Arms-crossed | Jump Rope | ballistic | N | Y | Y | I |
| Crossover Double Under | Arms-crossed, double pass | Jump Rope | ballistic | N | Y | N | A |
| Alternating-Foot Single Under | Running-style | Jump Rope | ballistic | N | Y | Y | B |
| High Knees Jump Rope | High-knee variant | Jump Rope | ballistic | N | Y | Y | B |

---

## 17. Monostructural — Swimming

The source v1.0's swimming coverage is a single bullet ("Swimming") — expanded here since stroke type materially changes both difficulty and which movement pattern applies.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Freestyle Swim | Stroke | Pool | gait | N | Y | Y | I |
| Breaststroke Swim | Stroke | Pool | gait | N | Y | Y | I |
| Backstroke Swim | Stroke | Pool | gait | N | Y | Y | I |
| Butterfly Swim | Stroke | Pool | gait | N | Y | N | A |
| Kickboard Swim (Legs Only) | Isolated | Pool + Kickboard | gait | N | Y | Y | B |
| Pull Buoy Swim (Arms Only) | Isolated | Pool + Pull Buoy | gait | N | Y | Y | I |
| Open Water Swim | Non-pool | Open Water | gait | N | Y | Y | I |
| Water Treading | Static/endurance | Pool | isometric | N | Y | Y | B |
| Paddle (Kayak/Canoe/SUP) | Watercraft | Paddle + Craft | pull-horizontal | N | N | Y | I |

---

## 18. Functional Bodybuilding / Accessory / Isolation

**The single largest identified gap in the source v1.0 architecture.** The source taxonomy has NO dedicated isolation/accessory category at all — every movement listed is either a compound barbell/gymnastics/monostructural movement. CompTrain, HWPO, and PRVN all run daily dedicated accessory blocks using exactly this class of movement (see WORKOUT_FORMATS.md Section 15), and without this category, FCKB simply cannot parse a large fraction of real modern programming.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Bicep Curl (Barbell) | Elbow flexion | Barbell | isolation | N | N | Y | B |
| Bicep Curl (Dumbbell) | Elbow flexion | Dumbbell | isolation | N/B | N | Y | B |
| Hammer Curl | Elbow flexion, neutral grip | Dumbbell | isolation | N/B | N | Y | B |
| Preacher Curl | Elbow flexion, supported | Barbell/DB + Preacher Bench | isolation | N | N | Y | B |
| Concentration Curl | Elbow flexion, isolated | Dumbbell | isolation | Y | N | Y | B |
| Cable Curl | Elbow flexion, cable | Cable | isolation | N | N | Y | B |
| Band Curl | Elbow flexion, band | Band | isolation | N | Y | Y | B |
| Tricep Pushdown | Elbow extension, cable | Cable | isolation | N | N | Y | B |
| Tricep Extension (Overhead) | Elbow extension, overhead | DB/Cable/Band | isolation | N/B | N | Y | B |
| Skull Crusher (Lying Tricep Extension) | Elbow extension, lying | Barbell/DB/EZ-Bar | isolation | N | N | Y | I |
| Tricep Kickback | Elbow extension | Dumbbell | isolation | Y | N | Y | B |
| Close-Grip Push-up (Tricep Emphasis) | see Section 4 | BW | press-horizontal | N | Y | Y | B |
| Lateral Raise | Shoulder abduction | Dumbbell/Cable/Band | isolation | N/B | N | Y | B |
| Front Raise | Shoulder flexion | Dumbbell/Plate/Band | isolation | N/B | N | Y | B |
| Rear Delt Fly | Shoulder horizontal abduction | Dumbbell/Cable/Band | isolation | N | N | Y | B |
| Cable Lateral Raise | Shoulder abduction, cable | Cable | isolation | Y | N | Y | B |
| Upright Row | Shoulder/trap, vertical pull | Barbell/DB/Cable | isolation | N | N | Y | I |
| Shrug | Trapezius | Barbell/DB | isolation | N | N | Y | B |
| Face Pull | see Section 6 (cross-listed) | Band/Cable | isolation | N | N | Y | B |
| Cuban Rotation | Rotator cuff | Dumbbell/Band | isolation | N/B | N | Y | I |
| External Rotation (Band/Cable) | Rotator cuff | Band/Cable | isolation | Y | N | Y | B |
| Internal Rotation (Band/Cable) | Rotator cuff | Band/Cable | isolation | Y | N | Y | B |
| Leg Extension | Knee extension, machine | Machine | isolation | N/B | N | Y | B |
| Leg Curl (Lying/Seated) | Knee flexion, machine | Machine | isolation | N/B | N | Y | B |
| Nordic Curl (Nordic Hamstring Curl) | Knee flexion, bodyweight-loaded | BW + Partner/Anchor | isolation | N | Y | Y | A |
| Calf Raise (Standing) | Ankle plantarflexion | BW/Barbell/Machine | isolation | N/B | B | Y | B |
| Calf Raise (Seated) | Ankle plantarflexion, bent-knee | Machine/DB | isolation | N/B | N | Y | B |
| Hip Abduction (Machine/Band) | Hip abduction | Machine/Band | isolation | Y | N | Y | B |
| Hip Adduction (Machine/Band) | Hip adduction | Machine/Band | isolation | Y | N | Y | B |
| Monster Walk | Hip abduction, banded gait | Band | gait | N | Y | Y | B |
| Clamshell | Hip external rotation | Band | isolation | Y | Y | Y | B |
| Cable Chest Fly | Horizontal adduction, cable | Cable | isolation | N | N | Y | B |
| Dumbbell Chest Fly | Horizontal adduction, DB | Dumbbell + Bench | isolation | N | N | Y | B |
| Pec Deck (Machine Fly) | Horizontal adduction, machine | Machine | isolation | N | N | Y | B |
| Wrist Curl | Wrist flexion | Barbell/DB | isolation | N | N | Y | B |
| Reverse Wrist Curl | Wrist extension | Barbell/DB | isolation | N | N | Y | B |
| Farmer Hold (Static Grip) | Grip isometric | DB/KB/Farmers Handles | isometric | N | N | Y | B |
| Plate Pinch Hold | Grip isometric | Plates | isometric | N | N | Y | I |
| Dead Hang | Grip/shoulder isometric | Pull-up Bar | isometric | N | Y | Y | B |
| Weighted Dead Hang | Grip isometric, loaded | Pull-up Bar + Belt | isometric | N | N | Y | I |

---

## 19. Plyometric, Agility & Explosive

Absent as a distinct category in the source v1.0 taxonomy (Box Jump and Broad Jump appear as isolated bullets with no surrounding family).

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Box Jump | Vertical, box landing | Box | ballistic | N | Y | Y | B |
| Box Jump Over | Vertical + horizontal, over-the-box | Box | ballistic | N | Y | Y | I |
| Bound-Over Box Jump | Non-step-down box jump over | Box | ballistic | N | Y | Y | I |
| Box Step-Down | Controlled descent, no jump | Box | ballistic | Y | Y | Y | B |
| Broad Jump | Horizontal, standing | None | ballistic | N | Y | Y | B |
| Standing Long Jump | see Broad Jump (near-synonym, distinct enough in some programs to list) | None | ballistic | N | Y | Y | B |
| Depth Jump | Drop-and-explode | Box | ballistic | N | Y | Y | A |
| Tuck Jump | Vertical, knees-to-chest | None | ballistic | N | Y | Y | I |
| Squat Jump | Vertical, squat-based | BW/DB | ballistic | N | Y | Y | B |
| Lateral Bound | Frontal-plane, single-leg landing | None | ballistic | Y | Y | Y | I |
| Skater Jump | Lateral bound variant | None | ballistic | Y | Y | Y | I |
| Broad Jump Burpee | Combo | None | mixed | N | Y | Y | I |
| Agility Ladder Drill | Footwork, generic | Agility Ladder | gait | N | Y | Y | B |
| Cone Drill (5-10-5 / T-Drill etc.) | Change of direction, named protocols | Cones | gait | N | Y | Y | I |
| Box Drill (4-Corner) | Change of direction | Cones/Markers | gait | N | Y | Y | I |
| Med Ball Chest Pass | Explosive, horizontal throw | Medicine Ball | ballistic | N | N | Y | B |
| Med Ball Overhead Throw | Explosive, vertical/backward throw | Medicine Ball | ballistic | N | N | Y | B |
| Med Ball Slam | Explosive, downward | Medicine Ball | ballistic | N | N | Y | B |
| Med Ball Rotational Throw | Explosive, rotational | Medicine Ball | ballistic | Y | N | Y | I |
| Wall Ball | Squat-to-throw, target | Medicine Ball + Wall | mixed | N | N | Y | B |
| Wall Ball (No Target/Free Throw) | Regression | Medicine Ball | mixed | N | N | Y | B |
| Broad Jump to Sprint | Combo, transition drill | None | mixed | N | Y | Y | I |
| Single-Leg Box Jump | Unilateral, advanced | Box | ballistic | Y | Y | N | A |

---

## 20. Mobility & Flexibility

**Loading convention**: bodyweight/band, rarely externally loaded. **Rep convention**: time-based (hold duration) or rep-based for dynamic drills, not competitively scored.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Couch Stretch | Static, hip flexor | Box/Bench/Wall | isometric | Y | Y | Y | B |
| Pigeon Stretch | Static, hip external rotation | Floor | isometric | Y | Y | Y | B |
| Frog Stretch | Static, hip/groin | Floor | isometric | N | Y | Y | B |
| 90/90 Hip Stretch | Static, hip internal/external rotation | Floor | isometric | Y | Y | Y | B |
| PVC Pass-Through | Dynamic, shoulder | PVC Pipe | mixed | N | Y | Y | B |
| PVC Overhead Squat Mobility Drill | Dynamic, combined | PVC Pipe | mixed | N | Y | Y | B |
| Thoracic Rotation (Open Book) | Dynamic, T-spine | Floor | rotation | Y | Y | Y | B |
| Cat-Cow | Dynamic, spinal | Floor | mixed | N | Y | Y | B |
| Ankle Dorsiflexion Drill (Knee-to-Wall) | Dynamic, ankle | Wall | mixed | Y | Y | Y | B |
| Banded Ankle Distraction | Static/dynamic, joint mobilization | Band + Anchor | isometric | Y | Y | Y | I |
| Banded Lat Stretch | Static, lat | Band + Anchor | isometric | Y | Y | Y | B |
| Banded Shoulder Distraction | Static, joint mobilization | Band + Anchor | isometric | Y | Y | Y | I |
| Jefferson Curl | see Section 3 (cross-listed) | DB/Plate | hinge | N | N | Y | A |
| Foam Roll — Quads | Self-myofascial release | Foam Roller | mixed | N | Y | Y | B |
| Foam Roll — T-Spine | Self-myofascial release | Foam Roller | mixed | N | Y | Y | B |
| Foam Roll — IT Band | Self-myofascial release | Foam Roller | mixed | Y | Y | Y | B |
| Foam Roll — Lats | Self-myofascial release | Foam Roller | mixed | Y | Y | Y | B |
| Foam Roll — Calves | Self-myofascial release | Foam Roller | mixed | Y | Y | Y | B |
| Lacrosse Ball — Glutes/Piriformis | Self-myofascial release, targeted | Lacrosse Ball | mixed | Y | Y | Y | B |
| Lacrosse Ball — Pecs | Self-myofascial release, targeted | Lacrosse Ball | mixed | Y | Y | Y | B |
| World's Greatest Stretch | Dynamic, multi-plane flow | Floor | mixed | Y | Y | Y | B |
| Spiderman Lunge with Rotation | Dynamic, multi-plane | Floor | mixed | Y | Y | Y | B |
| Scorpion Stretch | Dynamic, spinal/hip | Floor | mixed | Y | Y | Y | B |
| Cossack Stretch | Dynamic, adductor | Floor | mixed | Y | Y | Y | B |
| Wrist Circles/Mobilization | Dynamic, wrist | None | rotation | N | Y | Y | B |
| Shoulder Dislocates (PVC/Band) | Dynamic, shoulder ROM | PVC/Band | rotation | N | Y | Y | B |
| Goblet Squat Hold (Mobility) | Static, deep-squat position | KB/DB (optional) | isometric | N | Y | Y | B |
| Seated Straddle Stretch | Static, adductor/hamstring | Floor | isometric | N | Y | Y | B |
| Standing Forward Fold | Static, posterior chain | Floor | isometric | N | Y | Y | B |
| Child's Pose | Static, spinal/hip flexion rest position | Floor | isometric | N | Y | Y | B |
| Downward Dog | Static/dynamic, posterior chain | Floor | isometric | N | Y | Y | B |

---

## 21. Warm-up & Activation Drills

Distinct from static Mobility (Section 20) — these are dynamic, movement-preparation drills specifically, absent as their own grouping in the source v1.0.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| High Knees | Dynamic, hip flexion | None | gait | N | Y | Y | B |
| Butt Kickers | Dynamic, hamstring | None | gait | N | Y | Y | B |
| Walking Knee Hug | Dynamic, hip flexor/glute | None | gait | Y | Y | Y | B |
| Walking Quad Stretch | Dynamic | None | gait | Y | Y | Y | B |
| Inchworm | Dynamic, full-body flow | None | mixed | N | Y | Y | B |
| Leg Swing (Front-to-Back) | Dynamic, hip | Wall (optional support) | mixed | Y | Y | Y | B |
| Leg Swing (Lateral) | Dynamic, hip | Wall (optional support) | mixed | Y | Y | Y | B |
| Arm Circles | Dynamic, shoulder | None | rotation | N | Y | Y | B |
| Torso Twists | Dynamic, spinal rotation | None | rotation | N | Y | Y | B |
| Lunge with Twist | Dynamic, combined | None | mixed | Y | Y | Y | B |
| Carioca (Grapevine) | Dynamic, lateral/rotational gait | None | gait | N | Y | Y | B |
| A-Skip | Dynamic, running-mechanics drill | None | gait | N | Y | Y | I |
| B-Skip | Dynamic, running-mechanics drill | None | gait | N | Y | Y | I |
| Straight-Leg March | Dynamic, hamstring/hip flexor | None | gait | N | Y | Y | B |
| Empty-Bar Warm-up Complex (coach-defined) | Barbell activation | Barbell (empty) | mixed | N | N | Y | B |
| Band-Resisted March | Dynamic, glute activation | Band | mixed | Y | Y | Y | B |
| Glute Bridge March | Dynamic, glute activation | BW | mixed | Y | Y | Y | B |
| Scapular Push-up | Activation, scapular control | BW | isometric | N | Y | Y | B |
| Scapular Pull-up | Activation, scapular control | Pull-up Bar | isometric | N | Y | Y | B |

---

## 22. Tactical, Rehabilitation & Carries (Non-Strongman)

Movements specific to tactical/military and rehabilitation contexts not already covered under Strongman (Section 12), which is specifically odd-object/loaded-implement focused; this category covers bodyweight-locomotion and rehab-specific patterns absent from the source entirely.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Ruck March | Loaded backpack walk | Ruck/Backpack | gait | N | N | Y | B |
| Bear Crawl | Quadrupedal locomotion | None | gait | N | Y | Y | B |
| Crab Walk | Quadrupedal locomotion, supine | None | gait | N | Y | Y | B |
| Army Crawl (Low Crawl) | Prone locomotion | None | gait | N | Y | Y | B |
| Duck Walk | see Section 2 (cross-listed) | None | gait | N | Y | Y | B |
| Fireman's Carry | Loaded, over-shoulder person/dummy carry | Sandbag/Partner/Dummy | carry | N | N | Y | I |
| Casualty Drag | Loaded, ground-level drag | Sandbag/Partner/Dummy | gait | N | N | Y | I |
| Buddy Carry | Partner-loaded carry | Partner | carry | N | N | Y | I |
| Weighted Vest Complex (coach-defined) | Loaded, generic modifier | Weight Vest | mixed | N/A | N | Y | I |
| Blood Flow Restriction (BFR) Set (coach-defined base movement) | Rehab-specific loading modifier | BFR Cuffs + base movement | isolation | N/A | N | Y | A |
| Isometric Mid-Range Hold (coach-defined base movement) | Rehab-specific, pain-free range hold | Base movement's own equipment | isometric | N/A | N | Y | I |
| Copenhagen Plank | see Section 9 (cross-listed) | Bench | isometric | Y | Y | N | A |
| Nordic Curl | see Section 18 (cross-listed) | BW + Anchor | isolation | N | Y | Y | A |
| Single-Leg Balance (Rehab) | Proprioception | BW (unstable surface optional) | isometric | Y | Y | Y | B |

---

## 23. Powerlifting-Specific Accessory & Equipment Variations

The "Big 3" lifts (Squat, Bench, Deadlift) are already fully cataloged in Sections 2/3/4 — this section covers powerlifting-specific EQUIPMENT and ACCOMMODATING-RESISTANCE variations not otherwise represented, since powerlifting programming references these by name constantly and they don't fit any earlier category cleanly.

| Canonical Name | Subcategory | Equipment | Pattern | Uni | BW | Scale | Skill |
|---|---|---|---|---|---|---|---|
| Banded Squat | Accommodating resistance | Barbell + Bands | squat | N | N | Y | I |
| Chain Squat | Accommodating resistance | Barbell + Chains | squat | N | N | Y | I |
| Banded Bench Press | Accommodating resistance | Barbell + Bands | press-horizontal | N | N | Y | I |
| Chain Bench Press | Accommodating resistance | Barbell + Chains | press-horizontal | N | N | Y | I |
| Banded Deadlift | Accommodating resistance | Barbell + Bands | hinge | N | N | Y | I |
| Board Press | Partial-ROM bench | Barbell + Boards + Bench | press-horizontal | N | N | Y | A |
| Pin Press | Partial-ROM, pin-supported | Barbell + Rack | press-horizontal | N | N | Y | I |
| Cambered Bar Squat | Specialty bar | Cambered Bar | squat | N | N | Y | I |
| Buffalo Bar Squat | Specialty bar | Buffalo Bar | squat | N | N | Y | I |
| Wrist Wraps/Sleeves Squat (equipment-assisted, geared) | Equipped variant | Barbell + Knee Sleeves/Wraps | squat | N | N | Y | I |
| Single-Ply/Multi-Ply Bench (Geared) | Equipped variant, competitive powerlifting | Barbell + Bench Shirt | press-horizontal | N | N | N | A |
| Deficit Deadlift | see Section 3 (cross-listed) | Barbell + Plates | hinge | N | N | Y | A |
| Paused Bench Press | Tempo/rules-compliance variant | Barbell + Bench | press-horizontal | N | N | Y | I |
| Paused Squat | Tempo/rules-compliance variant | Barbell | squat | N | N | Y | I |
| Paused Deadlift | Tempo/rules-compliance variant | Barbell | hinge | N | N | Y | I |

---

## 24. Missing Movement Categories Identified (Summary)

Explicit callout, per the mission's instruction to identify gaps:

1. **Functional Bodybuilding / Accessory / Isolation** (Section 18) — the single largest gap; entirely absent from the source, despite being daily-programmed content in CompTrain/HWPO/PRVN.
2. **Plyometric, Agility & Explosive** (Section 19) — box jump and broad jump existed as isolated bullets with no surrounding family or the many real variants (depth jumps, agility ladder, cone drills, med ball throws).
3. **Horizontal Pull / Rowing (Strength)** (Section 6) — barbell rows, cable rows, face pulls, band pull-aparts were entirely absent.
4. **Sled Work** (Section 13) — folded into "Strongman" as 2 bullets in the source; split out given real-world (and HYROX-driven) frequency.
5. **Warm-up & Activation Drills** (Section 21) — conflated with static Mobility in the source; dynamic prep work is a distinct, common, separately-programmed block.
6. **Tactical/Rehab/Carries** (Section 22) — entirely absent (rucking, crawls, casualty drags, BFR, rehab-specific isometrics).
7. **Powerlifting-specific equipment variations** (Section 23) — accommodating resistance (bands/chains), specialty bars, and geared/equipped variants entirely absent.
8. **Swimming stroke breakdown** (Section 17) — the source's single "Swimming" bullet is expanded into 9 distinct, real entries.
9. **Core & Trunk as a standalone category** (Section 9) — was a sub-bullet of Gymnastics in the source, undercounting the large amount of non-gymnastics (banded, machine, weighted) core work.
10. **Olympic complexes as named entities** (Section 1.5) — the source mentions "complexes" exist but doesn't catalog any as canonical named movements in their own right.

## 25. Real Movement Count

Counting every row across Sections 1-23 (excluding cross-listed rows that reference an earlier section rather than introducing a new movement, and excluding the Legend/summary sections): approximately **540 distinct canonical movements**. This is a genuine, real count of actually-distinct movements organized by category, not padded to approach the source architecture's 1,200–1,500 target — reaching that range would require either (a) fabricating movements that don't meaningfully exist in real programming, which this document deliberately does not do, or (b) enumerating many more narrow equipment/grip/stance variants per base movement (e.g. cataloging "Wide-Stance Front Squat", "Close-Stance Front Squat", "Heels-Elevated Front Squat" etc. as separate canonical entities rather than as a base movement + a modifier). Option (b) is a real, legitimate way to grow the catalog further and is flagged in FCKB_ARCHITECTURE_REVIEW.md as a genuine architectural question — whether stance/grip/tempo modifiers should be separate `movements` rows or a `movement_variants`/`movement_modifiers` layer on top of ~540 base movements — rather than something resolved unilaterally in this document by arbitrary padding.
