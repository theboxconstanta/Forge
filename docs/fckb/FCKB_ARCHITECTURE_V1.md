# Forge CrossFit Knowledge Base (FCKB) Architecture v1.0

> Preserved verbatim as supplied by the user, 2026-08-05, as the baseline for `FCKB_ARCHITECTURE_REVIEW.md`. Not edited for formatting/content — any correction or extension happens in the review document, not here.

## Purpose

FCKB is the canonical movement and workout-structure knowledge layer used by every Programming feature in Forge.

It is **not** a UI feature.

It is a foundational domain that powers:

* Intelligent Paste
* AI Workout Parser
* Workout Composer V2
* Search
* Templates
* Benchmark recognition
* Hero WOD recognition
* Result scoring
* PR tracking
* Future programming recommendations

The primary goal is:

> Forge must correctly understand any workout written by any CrossFit coach in the world.

---

# Design Principles

## Canonical First

Every movement exists exactly once as a canonical entity.

Example: Power Clean

All variations such as: PC, power clean, power cleans, pwr clean, clean power — resolve to the same canonical movement.

## Alias Resolution

User input is never matched directly to movements.

Pipeline:

Input text → Normalize → Alias resolution → Canonical movement

This allows the parser to remain robust across: abbreviations, plural forms, spelling differences, hyphenation, British/American English, coach-specific shorthand.

## Format-Aware Parsing

Workout formats are independent objects.

A workout is composed of:

Sections → Format → Movements → Rep scheme → Load / intensity

This separation prevents parser ambiguity.

---

# Database Schema

## movements

Canonical movement definitions.

Fields: id, canonical_name, slug, category, subcategory, equipment, movement_pattern, plane, unilateral, bodyweight, scalable, skill_level, description, created_at

## movement_aliases

Every known synonym.

Fields: id, movement_id, alias, normalized_alias, locale, is_abbreviation, priority

Examples:

Power Clean aliases: PC, power clean, power cleans, pwr clean, clean power

Double Under aliases: DU, DUs, double under, double unders, doubles

Chest-to-Bar Pull-up aliases: C2B, CTB, chest to bar, chest-to-bar, chest to bar pullup

Target size: 8,000–12,000 aliases.

## workout_formats

Canonical workout formats.

Examples: AMRAP, EMOM, E2MOM, E3MOM, Every X Minutes, For Time, Rounds For Time, Chipper, Ladder, Ascending Ladder, Descending Ladder, Death By, Tabata, Interval, Work/Rest, Max Reps, Max Distance, Max Load, Partner, Team Relay, Stations, Complex, Superset, Triset, Giant Set, Wave Loading, Tempo, Percentage Work

Fields: id, name, category, scoring_type, description

## rep_patterns

Recognized rep structures.

Examples: 21-15-9, 15-12-9, 30-20-10, 10-9-8-7-6..., 1-2-3-4..., 5x5, 5x3, 3x10, 10x1, Every round add reps, Every round add weight, Buy-in / Cash-out

Fields: id, pattern_type, regex_pattern, parser_hint

## benchmark_workouts

Official CrossFit benchmark workouts. Includes all Girls workouts and named benchmark workouts.

Fields: id, name, workout_format_id, canonical_definition, official_source

## hero_workouts

Official CrossFit Hero workouts.

Fields: id, name, canonical_definition, official_source

## open_workouts

All official CrossFit Open workouts.

Fields: id, season, workout_code, canonical_definition

---

# Movement Taxonomy

## Olympic Weightlifting

Snatch family: Snatch, Power Snatch, Hang Power Snatch, Hang Snatch, Muscle Snatch, Block Snatch, Squat Snatch, Tall Snatch, Snatch Balance, Heaving Snatch Balance, Drop Snatch, Overhead Squat

Clean family: Clean, Power Clean, Hang Power Clean, Hang Clean, Squat Clean, Block Clean, Tall Clean, Muscle Clean

Jerk family: Jerk, Push Jerk, Split Jerk, Power Jerk, Behind-the-Neck Jerk, Clean & Jerk

Olympic complexes: Snatch + OHS, Clean + Jerk, Hang Clean + Front Squat + Jerk, etc.

Estimated canonical movements: 120–150

## Squat Family

Air Squat, Back Squat, Front Squat, Overhead Squat, Zercher Squat, Goblet Squat, Box Squat, Tempo Squat, Pause Squat, Anderson Squat, Bulgarian Split Squat, Reverse Lunge, Walking Lunge, Pistol Squat, Cossack Squat, Step-up

Estimated: 80+

## Hinge Family

Deadlift, Sumo Deadlift, Romanian Deadlift, Stiff Leg Deadlift, Deficit Deadlift, Snatch Grip Deadlift, Clean Grip Deadlift, Good Morning, Hip Thrust, Glute Bridge, Hip Hinge

Estimated: 60+

## Press Family

Strict Press, Push Press, Push Jerk, Split Jerk, Bench Press, Incline Bench Press, Floor Press, Dumbbell Bench Press, Arnold Press, Z Press, Seated Press

Estimated: 70+

## Pull Family

Pull-up, Strict Pull-up, Kipping Pull-up, Butterfly Pull-up, Chest-to-Bar Pull-up, Strict Chest-to-Bar, Chin-up, Bar Muscle-up, Ring Muscle-up, Rope Climb, Legless Rope Climb, Rope Pull

Estimated: 90+

## Gymnastics

Handstand: Handstand Hold, Handstand Walk, Wall Walk, HSPU, Strict HSPU, Kipping HSPU, Deficit HSPU, Pike Push-up

Rings: Ring Dip, Strict Ring Dip, Ring Row, Ring Support Hold, Skin the Cat, False Grip Hang, False Grip Pull-up

Core: Toes-to-Bar, Knees-to-Elbows, Hanging Knee Raise, Hanging Leg Raise, L-Sit, V-Up, Hollow Hold, Hollow Rock, Arch Hold, GHD Sit-up, Hip Extension, Back Extension, Dragon Flag, Plank, Side Plank

Estimated: 150+

## Dumbbell

DB Snatch, Alternating DB Snatch, DB Clean, DB Hang Clean, DB Thruster, DB Push Press, DB Push Jerk, DB Row, Renegade Row, Devil Press, Man Maker, DB Lunge, DB Front Squat, DB Overhead Squat

Estimated: 100+

## Kettlebell

KB Swing, Russian Swing, American Swing, KB Clean, KB Clean & Press, KB Snatch, Goblet Squat, Turkish Get-Up, Windmill, Farmer Carry, Front Rack Carry, Overhead Carry, Suitcase Carry

Estimated: 80+

## Strongman

Sandbag Clean, Sandbag Carry, Bear Hug Carry, Yoke Carry, Farmer Carry, Sled Push, Sled Pull, Tire Flip, Atlas Stone, Zercher Carry, Front Rack Carry, Overhead Carry

Estimated: 80+

## Monostructural

Running: Sprint, Shuttle Run, 100m, 200m, 400m, 800m, 1 mile, 5K, Trail Run, Hill Run

Rowing, SkiErg, BikeErg, Assault Bike, Echo Bike, Air Bike

Jump Rope: Single Unders, Double Unders, Triple Unders, Crossovers

Swimming, Paddle, Stair Climb

Estimated: 100+

## Mobility

Couch Stretch, Pigeon Stretch, PVC Pass Through, Thoracic Rotation, Ankle Dorsiflexion Drill, Banded Lat Stretch, Jefferson Curl, Foam Roll Quads, Foam Roll T-Spine, Banded Ankle Stretch

Estimated: 150+

---

# Parsing Pipeline

Input → Normalize → Section Detection → Workout Format Detection → Rep Pattern Detection → Movement Alias Resolution → Canonical Movements → Load / Intensity Parsing → Structured Workout

---

# Initial Dataset Target

* Canonical movements: 1,200–1,500
* Movement aliases: 8,000–12,000
* Workout formats: 35–40
* Rep patterns: 80–100
* Benchmark workouts: 100+
* Hero workouts: complete official CrossFit catalog
* Open workouts: all official seasons
* Named workouts: 300–500

This database becomes the single source of truth for all Programming features in Forge.
