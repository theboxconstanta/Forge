# FCKB — Workout Formats

Exhaustive catalog of workout formats across CrossFit (affiliate, Games, Open, Quarterfinals/Semifinals), CrossFit CAP, Mayhem, CompTrain, HWPO, PRVN, Invictus, Training Think Tank, HYROX, Olympic weightlifting programming, powerlifting programming, general strength & conditioning, tactical/military fitness, and endurance programming.

Each format entry follows the same template:

- **Canonical name**
- **Aliases** — every real-world spelling/shorthand a coach might actually write
- **Category** — which family this belongs to (used for `workout_formats.category`)
- **Scoring method** — see the Scoring Method Taxonomy (Section 20) for the canonical scoring-type vocabulary this references
- **Structural characteristics** — what a workout in this format is actually composed of
- **Metadata requirements** — fields the format needs to be fully specified (not just named)
- **Parser examples** — real-world text as a coach would actually type/paste it
- **Edge cases** — where this format gets ambiguous or collides with another

A note on the source architecture's own format list: it enumerates ~35 names as a flat list. That undercounts real-world usage badly — many of those names (e.g. "Interval", "Work/Rest") are actually *format categories* containing many distinct sub-formats with different scoring and metadata needs, and several major families are missing entirely (most of Sections 11–19 below). This document treats the flat list as a floor, not a ceiling.

---

## 1. For Time Family

The single most common CrossFit format family — a prescribed amount of work, completed as fast as possible, scored by elapsed time.

### 1.1 For Time (Single Round / Sequence)

- **Aliases**: "For Time", "FT", "ft.", "For time:", "AFAP" (as fast as possible), no explicit label at all (a bare movement/rep list with no header is conventionally read as For Time)
- **Category**: for_time
- **Scoring method**: time_ascending (lower time wins); if a time cap exists and isn't met, score converts to reps_completed (see 1.4)
- **Structural characteristics**: one pass through a list of movements, each with a fixed rep count (or a rep scheme like 21-15-9, see REP_PATTERNS.md); no repetition of the whole sequence unless explicitly structured as Rounds For Time (1.2)
- **Metadata requirements**: `time_cap_sec` (optional), `sequential_partial: true` (if unfinished, score is a reps-completed breakdown per movement, not a single number)
- **Parser examples**:
  - `For Time:\n21-15-9\nThrusters (43/30kg)\nPull-ups`
  - `21-15-9 Thrusters, Pull-ups` (no header — format inferred from the bare rep-movement structure)
  - `AFAP: 50 Burpees`
- **Edge cases**: a For Time workout with a time cap and a coach who writes "20 min cap" without the word "cap" (e.g. "Time limit: 20:00"); a For Time workout embedded with a Buy-In/Cash-Out (Section 8) still scores as one For Time unit overall.

### 1.2 Rounds For Time (RFT)

- **Aliases**: "RFT", "Rounds For Time", "X Rounds For Time", "X RFT", "for time, X rounds of:", "complete X rounds for time"
- **Category**: for_time
- **Scoring method**: time_ascending
- **Structural characteristics**: a fixed number of rounds, each round identical in composition, repeated back-to-back; the round count is *known in advance* (unlike AMRAP, where round count is the score)
- **Metadata requirements**: `rounds` (integer, required), `time_cap_sec` (optional), `shared_rep_scheme` (optional — some RFTs also carry a descending scheme per round, e.g. "5 rounds, each round: 21-15-9-6-3 reps decreasing per round" — rare but real)
- **Parser examples**:
  - `5 Rounds For Time:\n10 Deadlifts (100/70kg)\n15 Box Jumps (24/20")`
  - `7 RFT: 3 Muscle-ups, 21 Burpees` (Ryan)
  - `For time, 3 rounds of:\n400m Run\n21 KB Swings`
- **Edge cases**: "For Time" with a rounds prefix that looks identical to a bare For Time list until the round count is spotted (e.g. "5 rounds: ..." vs "5 Thrusters, ..." — the former is RFT, the latter is a single round's rep count); a coach writing "5x" as shorthand for 5 rounds (collides with strength set notation, see REP_PATTERNS.md Section 6).

### 1.3 Chipper

- **Aliases**: "Chipper", "chip through", "chip away at"
- **Category**: for_time
- **Scoring method**: time_ascending; unfinished → reps_completed per movement (sequential_partial)
- **Structural characteristics**: structurally identical to a single-round For Time (1.1) — a long list of *distinct* movements, each done once, in sequence; the only real difference from 1.1 is length/intent (a chipper is conventionally 8+ movements, "chipping away" at a large total workload) — this is a naming/intent distinction, not a structural one, and the parser should not require a minimum movement count to classify something as a chipper
- **Metadata requirements**: same as 1.1
- **Parser examples**:
  - `Chipper:\n50 Wall Balls\n40 SDHP\n30 Box Jumps\n20 Burpees\n10 Muscle-ups`
- **Edge cases**: a "chipper" that's actually a repeated-rounds structure mislabeled by the coach (rare, but happens — parser should still detect round-repetition if present, regardless of the chipper label).

### 1.4 For Time with Time Cap (capped, unfinished scoring)

- **Aliases**: "Time cap: X", "cap at X", "X min cap", "TC: X"
- **Category**: for_time
- **Scoring method**: time_ascending if finished under cap; reps_completed (with a breakdown per movement/round) if capped out
- **Structural characteristics**: modifies 1.1/1.2/1.3, not a standalone structure
- **Metadata requirements**: `time_cap_sec` (required for this variant to make sense as a distinct entity — otherwise it's redundant with the base format)
- **Parser examples**: `RFT, 12 min cap:`, `Cap: 20:00`
- **Edge cases**: a time cap stated as a countdown ("you have 12 minutes") vs. a stated maximum ("must finish by 12:00") — same meaning, different phrasing; a cap given in a different unit than the rest of the workout (e.g. "720 seconds").

---

## 2. AMRAP Family

Scored by total work completed within a fixed time window — the mirror image of For Time (time is fixed, output varies).

### 2.1 AMRAP (standard)

- **Aliases**: "AMRAP", "AMRAP X", "As Many Rounds As Possible", "As Many Reps As Possible" (ambiguous — see edge cases), "As Many Rounds/Reps as possible in X minutes"
- **Category**: amrap
- **Scoring method**: rounds_and_reps (rounds completed + partial reps into the next round, e.g. "14 rounds + 5 reps")
- **Structural characteristics**: one or more movements repeated in a fixed sequence for a fixed duration; round composition never changes round-to-round (unlike Ascending AMRAP, 2.2)
- **Metadata requirements**: `duration_sec` (required)
- **Parser examples**:
  - `AMRAP 20:\n5 Pull-ups\n10 Push-ups\n15 Air Squats` (Cindy)
  - `AMRAP 12 minutes:`
  - `As Many Rounds As Possible in 15:00`
- **Edge cases**: "AMRAP" genuinely means two different things depending on whether the workout is a single continuous movement ("AMRAP of burpees in 5 min" → a rep count is the score, not rounds+reps) vs. a multi-movement round ("AMRAP: 5 pull-ups, 10 push-ups..." → rounds+reps is the score). The parser must disambiguate on movement count: 1 movement → AMRAP-single (2.3), 2+ movements → AMRAP-rounds (2.1).

### 2.2 Ascending AMRAP

- **Aliases**: no single standard name — coaches describe it structurally ("each round add X reps", "increasing every round"), sometimes "Ladder AMRAP"; FCKB's own internal name from prior Forge work: "Ascending AMRAP"
- **Category**: amrap
- **Scoring method**: rounds_and_reps, but the *reps-per-round target itself increases every round* (e.g. round 1 = 3 reps, round 2 = 6 reps, round 3 = 9 reps...), so scoring must track total accumulated reps, not just "rounds completed", since rounds are unequal size
- **Structural characteristics**: movements stay the same round-to-round; only the rep count per movement increases by a fixed increment each round
- **Metadata requirements**: `duration_sec`, `start_reps`, `increment_reps`
- **Parser examples**:
  - `AMRAP 12: 3-6-9-12-15... Burpees, Deadlifts (+3 each round)`
  - `AVALANCHE: increasing by 3 each round, burpees + deadlifts, 12 min AMRAP`
- **Edge cases**: this is the single most commonly *mis-scored* format in the real world (confirmed from a real gym's own historical data — see PARSER_EDGE_CASES.md Section 9) because the UI/scoring logic must recompute the *current* round's target dynamically rather than using round 1's target for every round. A coach may also write the increment as a percentage ("+10% each round") instead of a fixed number — a real variant not covered by the base metadata.

### 2.3 AMRAP — Single Movement (Max Reps in Time)

- **Aliases**: "AMRAP of", "Max reps of X in Y minutes", "As Many Reps As Possible"
- **Category**: amrap
- **Scoring method**: reps_total (a single number, not rounds+reps)
- **Structural characteristics**: one movement, repeated continuously for a fixed duration
- **Metadata requirements**: `duration_sec`
- **Parser examples**: `Max rep Push-ups in 2:00`, `AMRAP of Double Unders, 5 min`
- **Edge cases**: overlaps with Max Reps (Section 6.1) — the distinction is purely whether a *time window* is specified (AMRAP-single) vs. unlimited time to a failure point (Max Reps proper).

### 2.4 AMRAP with Buy-In

- **Aliases**: "Buy in then AMRAP", "AMRAP after buy-in"
- **Category**: mixed
- **Scoring method**: rounds_and_reps, but total duration is fixed and buy-in time counts against the clock (i.e. the AMRAP portion's *effective* duration shrinks by however long the buy-in takes — this is the defining structural difference from Buy-In/Cash-Out, Section 8, where buy-in and cash-out are OUTSIDE the timed/scored portion)
- **Structural characteristics**: single continuous clock; buy-in work happens once at the start, then the remaining time is spent on AMRAP rounds
- **Metadata requirements**: `total_duration_sec`, `buy_in_movements` (list)
- **Parser examples**: `20 min AMRAP: Buy-in 30 Cal Row, then AMRAP: 10 Wall Balls, 10 Box Jumps`
- **Edge cases**: coaches sometimes write this identically to Buy-In/Cash-Out (Section 8) with no clear signal which scoring model applies — the disambiguator is whether there's a SECOND fixed block at the end (cash-out) or whether the clock just runs out mid-AMRAP (buy-in variant).

---

## 3. EMOM / Interval-Start Family

Work assigned to specific, recurring start times within a clock, rather than a continuous clock.

### 3.1 EMOM (Every Minute On the Minute)

- **Aliases**: "EMOM", "EMOM X" (X = total minutes), "Every Minute on the Minute", "on the minute", "E1MOM" (rare, disambiguating explicitly from E2MOM etc.)
- **Category**: interval
- **Scoring method**: reps_per_interval (Total Reps or Lowest Reps, coach-selectable) OR max_weight (if the EMOM is loading-focused, e.g. "EMOM 10: 1 Clean, build")
- **Structural characteristics**: a fixed interval (1 minute) repeated N times; work prescribed per interval must fit inside that interval, with rest = whatever time remains after the work is done
- **Metadata requirements**: `total_rounds` (or `total_duration_sec` + `interval_sec`=60), `movement_per_interval` (optional — some EMOMs alternate movements by interval, e.g. odd/even, see Section 3.4)
- **Parser examples**:
  - `EMOM 20:\nMin 1: 15 Cal Row\nMin 2: 10 Burpees`
  - `EMOM 12: 3 Squat Cleans (build to heavy)`
- **Edge cases**: an EMOM with a movement that sometimes can't be completed within 60 seconds by a given athlete — the score model must support "did not complete the prescribed work in the interval" as a distinct outcome, not just a null.

### 3.2 E2MOM / E3MOM / EXMOM (Every N Minutes on the Minute)

- **Aliases**: "E2MOM", "Every 2 Minutes", "E90MOM" or "E90SOM" (every 90 seconds — a real, if less common, variant using a non-minute interval), "Every X Min on the Min"
- **Category**: interval
- **Scoring method**: same as 3.1
- **Structural characteristics**: same as 3.1, with `interval_sec` != 60
- **Metadata requirements**: `interval_sec` (required, arbitrary — not limited to whole minutes), `total_rounds`
- **Parser examples**: `E3MOM x 6: 5 Deadlifts @ 80%`, `Every 90 sec x 8: 10 Wall Balls`
- **Edge cases**: "E90MOM" is a genuinely ambiguous abbreviation — could parse as "every 90 [seconds]" or be misread as "every 9-0" nonsense; the parser needs an explicit rule that a number immediately followed by "MOM" or "SOM" with no unit is seconds if ≥ 30, minutes if < 30 and a whole number... this heuristic itself is a documented edge case (see PARSER_EDGE_CASES.md Section 13).

### 3.3 Death By

- **Aliases**: "Death By", "DB [movement]" (collides badly with "Deadlift" and "Dumbbell" abbreviations — see PARSER_EDGE_CASES.md), "Ladder EMOM", "Death By X"
- **Category**: interval
- **Scoring method**: reps_total (last interval completed × its target, plus any partial) — score is effectively "how many rounds before you couldn't keep up", converted to a rep total
- **Structural characteristics**: interval-based like EMOM, but the rep target *increases by a fixed amount every interval* (usually +1) until the athlete fails to complete the prescribed reps within the interval, at which point the workout ends
- **Metadata requirements**: `start_reps`, `increment_reps`, `interval_sec`
- **Parser examples**: `Death By Burpees` (implicit: start at 1, +1 every minute, standard), `Death By Cleans, +1 every min starting at 1, 135lb`
- **Edge cases**: "Death By Weight" (a real, distinct sub-variant — see 3.3.1) uses the identical interval/failure structure but increases *load* instead of *reps*; a coach who writes just "Death By [movement]" with no explicit increment is using the community-default of "+1 rep/round starting at 1" — the parser needs this as a hardcoded default, not a required field.

#### 3.3.1 Death By Weight

- **Aliases**: "Death By Weight", "ascending EMOM load", "Death By [movement], +X kg each round"
- **Category**: interval
- **Scoring method**: max_weight (heaviest interval successfully completed)
- **Structural characteristics**: same interval/failure structure as 3.3, but the *rep count per interval is fixed* (usually 1) and the *load* increases every interval instead
- **Metadata requirements**: `start_weight`, `increment_weight`, `interval_sec`
- **Parser examples**: `Death By Clean: start @ 40kg, +5kg every minute, 1 rep/round`
- **Edge cases**: none beyond the Death By ambiguity already noted in 3.3.

### 3.4 Alternating / Odd-Even EMOM

- **Aliases**: "Odd/Even EMOM", "alternating minutes", "Odd min: X / Even min: Y"
- **Category**: interval
- **Scoring method**: reps_per_interval (per movement, tracked separately) or max_weight depending on content
- **Structural characteristics**: two (or more) distinct blocks of work, assigned to alternating intervals rather than every interval carrying identical content
- **Metadata requirements**: `intervals` (a list, one entry per distinct interval-slot content — not just one `movement_per_interval` string, since alternating patterns can have 3+ distinct rotating slots, e.g. "min 1: squats, min 2: pull-ups, min 3: rest", a 3-way rotation, not just odd/even)
- **Parser examples**: `EMOM 20 (alternating):\nOdd: 12 KB Swings\nEven: 10 Box Jumps`
- **Edge cases**: a 3-way or 4-way rotation is genuinely common (not just odd/even 2-way) and the "Odd/Even" naming convention breaks down entirely for those — parser must not assume exactly 2 rotating slots.

### 3.5 EMOM with Rest Intervals (Work/Rest structured as EMOM subset)

- **Aliases**: "EMOM (work X, rest remainder)" — explicitly stating a fixed work duration inside the minute, e.g. "EMOM 12: 40s work / 20s rest, Wall Balls"
- **Category**: interval
- **Scoring method**: reps_per_interval
- **Structural characteristics**: identical to standard EMOM except the work duration inside each interval is explicitly bounded (not "however long it takes"), meaning rest is fixed rather than variable — this matters for scoring since a coach may want "reps in the 40s window" as the score, not "did you finish"
- **Metadata requirements**: `interval_sec`, `work_sec` (< `interval_sec`)
- **Parser examples**: `EMOM 10: 40 on / 20 off, Max Cal Bike`
- **Edge cases**: this is structurally identical to Tabata (Section 4) except Tabata has fixed, community-standard work/rest ratios (20/10) over a fixed 8-round count — a generalized work/rest EMOM with arbitrary ratios is NOT Tabata and should not be auto-classified as such just because it has a work/rest split.

---

## 4. Tabata

- **Aliases**: "Tabata", "Tabata [movement]", "Tabata Intervals"
- **Category**: interval
- **Scoring method**: reps_per_interval — canonically "Lowest Reps" (the worst of the 8 rounds is the score, per the original Tabata protocol's intent of measuring sustained repeatable output), but "Total Reps" is also commonly used by coaches who want a cumulative score instead
- **Structural characteristics**: exactly 8 rounds of 20 seconds work / 10 seconds rest (this specific ratio and round count is what makes it "Tabata" rather than a generic interval — a coach changing the ratio should NOT be classified as Tabata, see Generalized Intervals, 4.1)
- **Metadata requirements**: `rounds` (default 8, but real-world Tabata variants do exist with different round counts — see edge cases), `work_sec` (default 20), `rest_sec` (default 10), `scoring_mode` (Lowest Reps | Total Reps)
- **Parser examples**: `Tabata Squats`, `Tabata: 20 Air Squats / 10 sec rest x 8`, `4-movement Tabata: Squats, Push-ups, Sit-ups, Air Squats (8 rounds each, 32 total rounds)`
- **Edge cases**: **the 4-movement Tabata rotation** (a real, extremely common CrossFit affiliate variant — 4 movements, each done for its own full 8-round Tabata block, totaling 32 rounds/16 minutes) is structurally distinct from single-movement Tabata and needs its own metadata shape (a *list* of movements, each independently scored, not one aggregate score); a "Tabata" with 6 rounds instead of 8 (some coaches shorten it) still gets called Tabata by name even though it breaks the canonical protocol — the parser must accept an explicit `rounds` override rather than hard-failing on non-8.

### 4.1 Generalized Work/Rest Intervals

- **Aliases**: "Intervals", "Work/Rest", "X on / Y off", "interval training"
- **Category**: interval
- **Scoring method**: reps_per_interval (Lowest Reps or Total Reps, coach-selectable, same as Tabata) or, for monostructural intervals, distance_per_interval or calories_per_interval
- **Structural characteristics**: identical shape to Tabata (fixed work, fixed rest, fixed round count) but with arbitrary work/rest ratios and round counts rather than the canonical 20/10 × 8
- **Metadata requirements**: `rounds`, `work_sec`, `rest_sec`, `scoring_mode`
- **Parser examples**: `Intervals: 30s on / 30s off x 10, Max Cal Row`, `6x 2:00 on / 1:00 off Bike`
- **Edge cases**: distinguishing this from EMOM-with-rest (3.5) is mostly cosmetic (both are "fixed work inside a fixed total interval") — the real distinguishing signal a parser should use is whether the coach frames it as "every minute" (→ EMOM-family) or as "X on / Y off, repeat N times" (→ Intervals-family); they are scored identically and could reasonably share one canonical format with a display-label variant rather than being two "different" formats — flagged as a possible simplification for the architecture review.

---

## 5. Ladder Family

### 5.1 Ascending Ladder

- **Aliases**: "Ascending Ladder", "ladder up", "add a rep each round"
- **Category**: ladder
- **Scoring method**: time_ascending (if for time) or rounds_and_reps (if capped/AMRAP-style)
- **Structural characteristics**: a rep scheme that increases every round by a fixed step (1-2-3-4-5... or 2-4-6-8...) until a target ceiling, or until time/rounds run out
- **Metadata requirements**: `start_reps`, `increment_reps`, `end_reps` (optional — some ladders are open-ended, bounded only by a time cap)
- **Parser examples**: `Ladder: 1-2-3-4-5-6-7-8-9-10 reps, Thrusters + Burpees, for time`
- **Edge cases**: an ascending ladder that RESETS partway through into a different climb (a "wave ladder", see 5.4) rather than climbing monotonically to a single ceiling.

### 5.2 Descending Ladder

- **Aliases**: "Descending Ladder", "ladder down", the classic "21-15-9" IS a descending ladder but is conventionally treated as its own named rep-scheme pattern rather than described as "descending ladder" explicitly — see REP_PATTERNS.md Section 1 for the canonical rep-scheme catalog; this entry covers the *format* concept independent of which specific scheme is used
- **Category**: ladder
- **Scoring method**: time_ascending typically
- **Structural characteristics**: mirror image of 5.1 — reps decrease every round by a fixed step down to a floor (often 1 or 3)
- **Metadata requirements**: `start_reps`, `decrement_reps`, `end_reps`
- **Parser examples**: `21-15-9`, `50-40-30-20-10`, `10 to 1 descending`
- **Edge cases**: overlaps entirely with REP_PATTERNS.md's ladder schemes — the FCKB architecture review should resolve whether "descending ladder" is a `workout_format` or purely a `rep_pattern`; this document's position (elaborated in FCKB_ARCHITECTURE_REVIEW.md) is that it is fundamentally a rep pattern, and "For Time" or "RFT" remains the actual workout_format wrapping it — a real normalization gap in the source v1.0 architecture.

### 5.3 Ascending-Descending ("Pyramid") Ladder

- **Aliases**: "Pyramid", "Up and Down Ladder", "Asc-Desc"
- **Category**: ladder
- **Scoring method**: time_ascending
- **Structural characteristics**: climbs to a peak, then descends back down, either symmetrically (1-2-3-4-5-4-3-2-1) or asymmetrically
- **Metadata requirements**: `start_reps`, `peak_reps`, `increment_reps`, `symmetric` (bool)
- **Parser examples**: `Pyramid: 1-2-3-4-5-4-3-2-1, Power Cleans (increasing weight up, decreasing weight down — see Reverse Pyramid loading, REP_PATTERNS.md Section 4)`
- **Edge cases**: a *loading* pyramid (weight goes up as reps go down, a strength-training convention — see REP_PATTERNS.md 4.2) is a completely different concept sharing the same name as a *rep-count* pyramid (this document's 5.3) — real, frequent source of confusion in coach-written programming, must be disambiguated by whether the varying quantity is reps or load.

### 5.4 Wave Ladder

- **Aliases**: "Wave", "Waves", "3-wave ladder"
- **Category**: ladder
- **Scoring method**: max_weight per wave, or time per wave
- **Structural characteristics**: a short ascending (or descending) sequence repeated multiple times as discrete "waves", each wave resetting to (or near) the starting point rather than one continuous monotonic climb — extremely common in Olympic weightlifting and powerlifting programming (e.g. "3 waves of 3-2-1 @ increasing %", where each wave restarts at a slightly higher base weight than the last wave's start)
- **Metadata requirements**: `wave_pattern` (the reps-per-set sequence within one wave, e.g. [3,2,1]), `wave_count`, `intra_wave_load_progression`, `inter_wave_load_progression` (how the starting point shifts wave-to-wave)
- **Parser examples**: `3 waves: 3-2-1 @ 75-80-85%, then repeat wave 2 at +5%`
- **Edge cases**: this is the format most likely to be COMPLETELY missed by a naive parser trained only on metcon-style workouts, since it's near-exclusively used in strength programming (CompTrain, HWPO, PRVN's own strength blocks, and virtually all pure oly/powerlifting programs) rather than affiliate WODs — a real gap the source v1.0 architecture's format list doesn't address at all.

---

## 6. Max Effort Formats

### 6.1 Max Reps

- **Aliases**: "Max Reps", "AMRAP" (single-movement, unlimited time — see 2.3 for the *timed* version of this concept; this entry is the untimed version), "Max effort reps", "to failure"
- **Category**: scored
- **Scoring method**: reps_total
- **Structural characteristics**: one continuous, unbroken (or broken, coach's choice) set of a single movement to failure, no time limit
- **Metadata requirements**: none required beyond the movement itself; `unbroken_required` (bool, optional — some coaches specifically want max UNBROKEN reps, a materially different score than max total reps with breaks)
- **Parser examples**: `Max Rep Pull-ups`, `Max unbroken Wall Balls`
- **Edge cases**: unbroken vs. broken is a real, frequently-lost distinction — a workout titled "Max reps" with no qualifier is ambiguous by default and the parser should not assume either.

### 6.2 Max Distance

- **Aliases**: "Max Distance", "furthest", "longest"
- **Category**: scored
- **Scoring method**: distance_total
- **Structural characteristics**: a fixed time or fixed number of attempts, scored by distance covered
- **Metadata requirements**: `time_cap_sec` OR `attempts`
- **Parser examples**: `Max Distance Broad Jump, 3 attempts`, `Max Distance in 60 seconds: Sled Push`
- **Edge cases**: distance events sometimes score the SUM across attempts (e.g. total distance across 3 broad jumps) vs. the BEST single attempt — must be disambiguated per prescription, since both are real conventions.

### 6.3 Max Load (1RM / Rep-Max testing)

- **Aliases**: "Max Load", "1RM", "Find your 1RM", "Build to a heavy X", "Max [movement]", "XRM" (X = any rep count — 3RM, 5RM, etc.), "Heavy Single/Double/Triple"
- **Category**: strength
- **Scoring method**: max_weight
- **Structural characteristics**: progressive, self-selected loading across multiple sets, working toward a single heaviest successful lift at a target rep count
- **Metadata requirements**: `target_rep_max` (1 for a true 1RM, but 2/3/5 etc. are equally common and must be tracked distinctly — a 3RM and a 1RM are NOT comparable scores for the same movement), `time_cap_sec` (optional, some are capped e.g. "in 15 minutes, find your heaviest clean")
- **Parser examples**: `Build to a heavy 1 Clean & Jerk`, `Find 3RM Back Squat`, `Heavy Double Snatch, 12 min cap`
- **Edge cases**: "Max" alone, with no rep-max qualifier, defaults to 1RM by community convention but this is an assumption the parser is making, not something explicitly stated — should be flagged as a lower-confidence inference, not treated as certain.

### 6.4 Max Height

- **Aliases**: "Max Height", "Highest Box Jump"
- **Category**: scored
- **Scoring method**: height_total
- **Structural characteristics**: progressive attempts at increasing height
- **Metadata requirements**: none beyond the movement
- **Parser examples**: `Max Height Box Jump`
- **Edge cases**: rare enough in mainstream CrossFit that a naive parser will likely never see it, but it IS a real, named CrossFit Games event category historically (max box jump events) and belongs in the taxonomy for completeness even at low real-world frequency.

---

## 7. Strength & Loading Programming Formats

This entire family is **substantially underrepresented** in the source v1.0 architecture, which lists strength-adjacent concepts ("Wave Loading", "Tempo", "Percentage Work") as bare format names with no structural definition. CompTrain, HWPO, PRVN, and Training Think Tank all run daily strength blocks that are the PRIMARY content of their programming (metcons are often secondary), so this family needs to be a first-class citizen, not an afterthought.

### 7.1 Straight Sets (Sets x Reps)

- **Aliases**: "5x5", "3x10", "4 sets of 8", "SxR" notation generally
- **Category**: strength
- **Scoring method**: max_weight (typically the top/working set's load) or completed (pass/fail against a prescribed load)
- **Structural characteristics**: N identical sets of M reps each, same load throughout (or coach-directed "add weight if possible" progression, which is a soft version of 7.2)
- **Metadata requirements**: `sets`, `reps_per_set`, `rest_sec` (between sets), `load_prescription` (fixed weight | %1RM | RPE | bodyweight-relative | "as heavy as possible for the reps")
- **Parser examples**: `5x5 Back Squat @ 70%`, `4 sets x 8 reps Bench Press`, `Back Squat: 5-5-5-5-5`
- **Edge cases**: `5x5` collides visually with rep-scheme ladder notation and with Death By's "5 x 5min" style duration notation — disambiguation depends entirely on surrounding context (a lone "5x5 [movement name]" with no "for time"/"AMRAP" framing is strength-format by default).

### 7.2 Progressive/Ascending Loading Sets

- **Aliases**: "Working sets, building", "ramp up", "build to a heavy set of X", "ascending sets"
- **Category**: strength
- **Scoring method**: max_weight (top set)
- **Structural characteristics**: multiple sets of the same rep count, load increases set-to-set, no fixed final target (self-limited by the athlete's own ceiling that day)
- **Metadata requirements**: `sets`, `reps_per_set`, `starting_load_prescription` (optional)
- **Parser examples**: `Build to a heavy set of 3 Front Squats across 5 sets`
- **Edge cases**: overlaps with Wave Loading (7.4) when the "sets" reset partway rather than climbing monotonically — same disambiguation issue as Ladder vs. Wave Ladder (5.1 vs 5.4).

### 7.3 Percentage-Based Programming

- **Aliases**: "%1RM", "@ 70%", "percentage work", "based on your 1RM"
- **Category**: strength
- **Scoring method**: completed (the load itself is prescribed, not discovered) — score is typically pass/fail or RPE-logged, not a weight PR
- **Structural characteristics**: load for each set is computed as a percentage of a previously-established 1RM (or training max, see 7.3.1), rather than being self-selected
- **Metadata requirements**: `percentage` (or a per-set list of percentages), `reference_lift` (which movement's 1RM this percentage is taken from — NOT always the same movement being performed, e.g. "Front Squat @ 90% of Back Squat 1RM" is a real, if less common, cross-referencing pattern)
- **Parser examples**: `Back Squat 5x3 @ 80%`, `Snatch @ 75-80-85%, 1 rep each`
- **Edge cases**: **training max vs. true 1RM** (7.3.1) — many percentage-based programs (5/3/1 most famously, see 7.6) deliberately use a "training max" (typically 85-90% of a true 1RM) as the percentage base rather than the true max, and a percentage written against training max is NOT the same absolute weight as the same percentage against a true 1RM — this distinction is invisible in the raw text and can only be resolved via the athlete's own profile data (which reference max — true or training — is on file), a real cross-cutting concern between FCKB and PR-tracking.

### 7.4 Wave Loading

See 5.4 (Wave Ladder) — wave loading is the same underlying concept applied to load rather than reps-in-a-round; cataloged once there to avoid duplicating the structural definition; cross-referenced here because "Wave Loading" is the term the source architecture uses explicitly.

### 7.5 Cluster Sets

- **Aliases**: "Cluster", "Cluster Set", "singles with rest"
- **Category**: strength
- **Scoring method**: max_weight
- **Structural characteristics**: a set is broken into multiple mini-reps (often singles) with a short intra-set rest (10-20s) between each rep, allowing heavier loading than a traditional unbroken set of the same total rep count
- **Metadata requirements**: `reps_per_cluster`, `intra_cluster_rest_sec`, `clusters_per_set`, `inter_set_rest_sec`
- **Parser examples**: `Cluster: 1+1+1 (15s rest between singles) x 5 sets, Squat Clean`
- **Edge cases**: notated many different ways ("1.1.1", "1+1+1", "3x[1-1-1]") with no single dominant convention — a genuinely hard parsing target requiring several regex patterns rather than one.

### 7.6 Named Strength Progression Systems

A distinct sub-family: multi-week, named programming systems with their own internal structure, common in serious strength-focused affiliate and individual programming. These are NOT single-day formats but the source architecture's flat, day-scoped `workout_formats` table has no way to represent a system that spans weeks — flagged as a real architectural gap (see FCKB_ARCHITECTURE_REVIEW.md).

- **5/3/1 (Wendler)**: 4-week wave cycle (5s/3s/1+ week structure) against a training max; canonical, extremely widely used by name
- **Westside Conjugate Method**: max-effort day + dynamic-effort (speed) day per lift category per week; "ME" and "DE" are real, common shorthand a parser will encounter standalone
- **Sheiko**: high-frequency, high-volume percentage-based Russian powerlifting system, numbered workout templates (e.g. "Sheiko #29")
- **Bulgarian Method**: daily max testing, very high frequency, minimal assistance work
- **Linear Periodization**: progressive volume-down/intensity-up across a training block
- **Block Periodization**: distinct accumulation/transmutation/realization blocks
- **Daily Undulating Periodization (DUP)**: intensity/volume varies day-to-day rather than week-to-week within the same movement
- **Juggernaut Method**: named, 4-week wave system distinct from 5/3/1 but structurally similar (accumulation/intensification/realization/deload)
- **Parser examples**: `5/3/1 Week 1: Back Squat 5-5-5+`, `ME Lower: work up to a heavy 1 on Deadlift`, `Sheiko #29, Day 1`

### 7.7 Complex

- **Aliases**: "Complex", "[Movement A] + [Movement B] Complex", barbell complexes generally
- **Category**: strength
- **Scoring method**: max_weight (the complex is scored as a unit — heaviest weight the full complex was completed unbroken at)
- **Structural characteristics**: 2+ distinct movements performed back-to-back without dropping the implement (almost always a barbell), as a single "rep" of the complex; the complex is then repeated for multiple sets, typically with increasing load
- **Metadata requirements**: `complex_movements` (ordered list), `sets`, `unbroken_required` (near-always true for complexes by convention)
- **Parser examples**: `Complex (build): Power Clean + Front Squat + Push Jerk, x5 sets`, `Snatch Complex: 1 Snatch Deadlift + 1 Hang Snatch + 1 OHS`
- **Edge cases**: order matters and must be preserved exactly (a complex is not a set of interchangeable movements, unlike a superset) — a parser that alphabetizes or otherwise reorders complex movements silently corrupts the workout.

### 7.8 Superset / Triset / Giant Set

- **Aliases**: "Superset", "Triset" / "Tri-set", "Giant Set", "Circuit" (loosely — see edge cases)
- **Category**: strength (though frequently used in accessory/functional-bodybuilding contexts, Section 15)
- **Scoring method**: completed (typically not scored numerically at all — logged as done/not done, sometimes with weight per exercise) or reps_total per exercise
- **Structural characteristics**: 2 (superset), 3 (triset), or 4+ (giant set) distinct exercises performed back-to-back with minimal/no rest between them, THEN a rest period, THEN repeated for multiple rounds — unlike a Complex (7.7), the implement/setup typically changes between exercises (e.g. barbell row superset with dumbbell curls) and the exercises need not be biomechanically related
- **Metadata requirements**: `exercises` (ordered list), `sets`, `inter_exercise_rest_sec` (often 0), `inter_set_rest_sec`
- **Parser examples**: `Superset x4: DB Bench Press x10, Bent Row x10`, `Triset x3: Lateral Raise, Face Pull, Band Pull-Apart`
- **Edge cases**: "Circuit" is sometimes used interchangeably with Giant Set (4+ exercises) but ALSO sometimes refers to a Stations format (Section 9.3) where multiple athletes rotate through physical stations — same word, two structurally different formats; disambiguate by whether multiple athletes/rotation is mentioned.

### 7.9 Tempo Training

- **Aliases**: "Tempo", tempo notation itself (e.g. "3110", "31X0" — see PARSER_EDGE_CASES.md Section 5 for full tempo notation parsing rules), "controlled tempo"
- **Category**: strength (a modifier applied to any strength format, not a standalone structure)
- **Scoring method**: completed (tempo work is rarely scored by weight — it's prescriptive, not a PR attempt)
- **Structural characteristics**: a 4-digit tempo code specifying the duration in seconds of each phase of a rep: eccentric (lowering) / bottom pause / concentric (lifting) / top pause; e.g. "3110" = 3s down, 1s pause at bottom, 1s up, 0s pause at top
- **Metadata requirements**: `tempo_code` (4-digit string), applied alongside a base Straight Sets (7.1) or Progressive Loading (7.2) structure
- **Parser examples**: `Back Squat 4x6 @ 3010 tempo`, `Tempo Bench: 5x5 @ 30X1` (the "X" in tempo notation means "explosive"/as-fast-as-possible for that phase, a distinct symbol from a numeral)
- **Edge cases**: the "X" phase symbol is easy to mis-tokenize as a multiplication sign or a set-count marker if the parser isn't specifically aware tempo codes exist in this position — a real, documented collision (see PARSER_EDGE_CASES.md Section 5).

---

## 8. Buy-In / Cash-Out Structures

- **Aliases**: "Buy-In", "Buy in:", "Cash-Out", "Cash out:"
- **Category**: mixed
- **Scoring method**: time_ascending if the middle block is For Time, rounds_and_reps if it's AMRAP — buy-in and cash-out themselves are NOT separately scored, only timed as part of the total
- **Structural characteristics**: a fixed block of work (buy-in) → a main, separately-formatted block (For Time or AMRAP) → another fixed block of work (cash-out); all three are on ONE continuous clock; distinct from AMRAP with Buy-In (2.4) in that BOTH ends are fixed blocks here, and the whole thing typically has a single overall time score (or the AMRAP portion's rounds+reps, with buy-in/cash-out time simply "eating into" or "adding to" total time depending on which sub-type)
- **Metadata requirements**: `buy_in_movements`, `main_block` (a nested for_time or amrap format definition), `cash_out_movements`
- **Parser examples**:
  - `Buy-In: 50 Double Unders\nThen AMRAP 10: 10 Thrusters, 10 Pull-ups\nCash-Out: 50 Double Unders`
  - `Buy in 30 Cal Row, then 21-15-9 Thrusters/Pull-ups, Cash out 30 Cal Row — all for time`
- **Edge cases**: a workout can have a buy-in with NO cash-out (very common) or a cash-out with NO buy-in (less common but real) — the parser must not require both halves to classify this format; also collides with AMRAP-with-Buy-In (2.4) when only a buy-in is present and the main block is AMRAP — the deciding structural signal is whether the AMRAP's clock STARTS AFTER the buy-in (this format) or INCLUDES the buy-in inside a single fixed duration (2.4); this is frequently ambiguous from text alone and may require an explicit coach flag.

---

## 9. Partner / Team / Relay / Station Formats

**This entire family is present only as bare names in the source v1.0 architecture** ("Partner", "Team Relay", "Stations") with zero structural definition — a significant real-world gap, since partner/team WODs are extremely common at affiliates (partner classes, competitions, community events) and each has genuinely different scoring/validity implications.

### 9.1 Partner WOD — You Go / I Go

- **Aliases**: "You go, I go", "YGIG", "Partner (alternating)"
- **Category**: partner
- **Scoring method**: inherits the base format's scoring (time_ascending or rounds_and_reps) applied to the TEAM as a unit — individual contribution is not separately scored
- **Structural characteristics**: two partners alternate, one working while the other rests, switching on a signal (a fixed rep count, a fixed time, or "whenever" at the working partner's discretion); only one partner works at a time
- **Metadata requirements**: `switch_trigger` (reps | time | free), `base_format` (nested for_time/amrap/rft definition)
- **Parser examples**: `Partner WOD, You Go I Go: 100 Cal Row (split any way), then 21-15-9 Thrusters/Pull-ups (alternate every set)`
- **Edge cases**: "split any way" (no fixed switch trigger — partners decide amongst themselves) is common and means `switch_trigger` should support a `free` value, not just fixed reps/time.

### 9.2 Partner WOD — Shared Reps / Synchro

- **Aliases**: "Shared reps", "Synchro", "Synchronized", "both partners together"
- **Category**: partner
- **Scoring method**: same as 9.1
- **Structural characteristics**: either (a) both partners work simultaneously, splitting a shared total rep count between them non-alternately (Shared Reps), or (b) both partners must perform each rep in unison, synchronized (Synchro) — genuinely different from 9.1 (only one works at a time) and from each other
- **Metadata requirements**: `split_type` (shared | synchro)
- **Parser examples**: `Partner WOD (shared reps): 200 Wall Balls, split freely`, `Synchro Burpees x50 (both partners must be at the top together)`
- **Edge cases**: Synchro workouts frequently have a NO-REP condition (a rep doesn't count unless both partners are synchronized) which materially affects real completion time vs. naive rep-counting — a scoring-integrity concern beyond pure structure.

### 9.3 Team Relay / Stations

- **Aliases**: "Relay", "Team Relay", "Stations", "Station Rotation", "Circuit" (see 7.8 edge case — ambiguous with Giant Set), "X teams of Y"
- **Category**: team
- **Scoring method**: time_ascending (relay) or rounds_and_reps/reps_total per station, aggregated (stations)
- **Structural characteristics**: **Relay**: teammates complete a full leg of work in sequence, one at a time, baton-style, with the NEXT teammate unable to start until the PREVIOUS one finishes — total time is the team score. **Stations**: multiple physical work areas exist simultaneously; a team or individual moves between them on a timer or completion trigger, with each station tracked separately then possibly summed
- **Metadata requirements**: `team_size`, `structure_type` (relay | stations), `stations` (ordered list, if stations), `rotation_trigger` (time | completion, if stations)
- **Parser examples**: `Relay: 4-person team, each completes 400m run + 20 Wall Balls before the next starts, for time`, `6 Stations, 90s work / 30s rotate: 1) Row 2) Burpees 3) KB Swings 4) Box Jump 5) Wall Ball 6) Rest`
- **Edge cases**: a "station" that is actually "Rest" (as in the example above) is real and must be representable — not every station in a rotation is scored work; team size affects total reps expected and is essential metadata for any scoring-integrity or leaderboard comparison across teams of different sizes.

### 9.4 Team-of-N Aggregate

- **Aliases**: "Team of 3", "in teams of X, combined score"
- **Category**: team
- **Scoring method**: inherits base format, but the SCORE ITSELF is a team aggregate (e.g. combined total reps across all N members) rather than a completion-order/relay structure
- **Structural characteristics**: distinct from Relay (9.3) — all team members may work simultaneously (not baton-style), and the team's combined output (not elapsed time) is the primary score
- **Metadata requirements**: `team_size`, `aggregate_method` (sum | best_of | average)
- **Parser examples**: `Teams of 3, 20 min AMRAP, combined reps: 10 Burpees, 10 KB Swings each member` (each member does their own rounds simultaneously; team score = sum)
- **Edge cases**: overlaps with 9.3's Stations when a team splits up to cover different stations simultaneously rather than rotating — the presence of simultaneous, non-rotating parallel work with a combined score is the signal for THIS format rather than Stations.

---

## 10. Density & Accumulation Formats

### 10.1 Density Training (fixed time, max total load moved)

- **Aliases**: "Density", "As many reps/rounds as possible for volume" (overlaps conceptually with AMRAP but the INTENT and typical rep ranges differ — density blocks are usually lower-intensity, higher-rep accessory/conditioning work, not maximal-effort metcons)
- **Category**: mixed
- **Scoring method**: reps_total or tonnage_total (total weight moved = reps × load, summed)
- **Structural characteristics**: fixed time window, athlete accumulates as much total work (often specifically total load lifted, not just rep count) as possible
- **Metadata requirements**: `duration_sec`, `scoring_basis` (reps | tonnage)
- **Parser examples**: `Density block: 10 min, accumulate as much total weight as possible on DB Snatch`
- **Edge cases**: tonnage-based scoring requires the load to be tracked per set (not just assumed constant), since athletes in a density block frequently adjust load as fatigue accumulates — a real data-capture requirement, not just a display concern.

### 10.2 Accumulation Sets (non-consecutive total)

- **Aliases**: "Accumulate X reps throughout class/day", "grease the groove"
- **Category**: mixed
- **Scoring method**: reps_total
- **Structural characteristics**: a target rep count to be reached over an extended, loosely-defined period (an hour, a full class, a full day), NOT in one continuous effort — sets can be spread arbitrarily
- **Metadata requirements**: `target_reps`, `time_window` (loosely defined — often just "today" or "this class")
- **Parser examples**: `Accumulate 100 Pull-ups throughout class, any way you want`
- **Edge cases**: has essentially no fixed internal structure to parse beyond a target number and a movement — the "workout" is really just a target and a deadline, which stresses the schema's assumption that workouts have set/round structure; this is one of the more schema-light formats.

---

## 11. Sport of Fitness / Competition-Specific Event Formats

Formats that appear specifically in CrossFit Games, Quarterfinals/Semifinals, and other functional-fitness competition programming, which behave differently from affiliate daily programming. **Entirely absent from the source v1.0 architecture.**

### 11.1 Multi-Part Workout (same day, separate scores)

- **Aliases**: "Event 1a/1b", "Part A/B/C", "X-Part Workout"
- **Category**: competition
- **Scoring method**: each part scored independently by its own base format; overall event score often a POINTS aggregate (see 11.3) across parts, not a single time/rep number
- **Structural characteristics**: 2+ genuinely separate workout blocks within one "event", each with its own rest period, format, and scoring method, but grouped as one competition event
- **Metadata requirements**: `parts` (ordered list, each a full nested workout_format definition), `part_scoring_aggregate` (points | sum_time | sum_reps)
- **Parser examples**: `Event 3: Part A - Max Clean & Jerk (4 min); Rest 3 min; Part B - AMRAP 6: 10 Burpee Box Jump Overs, Max Cal Row remaining`
- **Edge cases**: the source schema's single `workout_format_id` per workout row (implied by `benchmark_workouts.workout_format_id` being a single FK) cannot represent multi-part events at all — a real structural gap, flagged in FCKB_ARCHITECTURE_REVIEW.md.

### 11.2 Ladder/Elimination Event

- **Aliases**: "Sudden Death", "Elimination", "Cut Line"
- **Category**: competition
- **Scoring method**: completed (pass/fail against a standard or time), with a field-cutting rule layered on top (not itself a movement-scoring concept)
- **Structural characteristics**: successive rounds where the lowest-performing athletes/teams are removed from the field entirely before the next round
- **Metadata requirements**: `cut_rule` (e.g. "bottom 50% eliminated"), `rounds` (each a nested format definition)
- **Parser examples**: `Round 1: All athletes, AMRAP 4. Bottom 10 eliminated. Round 2: remaining athletes, Max Load Snatch.`
- **Edge cases**: this is a field-management/leaderboard concept more than a per-athlete workout structure — arguably belongs more in a Competition/Event domain than FCKB's own movement-and-format-focused scope; flagged for the architecture review as a possible out-of-scope-for-FCKB item rather than something to fully model here.

### 11.3 Points-Based Aggregate Event

- **Aliases**: "Points event", "leaderboard points", "placement points"
- **Category**: competition
- **Scoring method**: points (each part/heat's finishing place converts to a points value; total points across the whole competition determines overall placement — NOT raw time/reps at the aggregate level)
- **Structural characteristics**: wraps one or more base-format parts (11.1), converting each part's raw result into placement points via a defined points table
- **Metadata requirements**: `points_table` (rank → points mapping)
- **Parser examples**: N/A as raw workout text — this is a scoring/leaderboard concept the FCKB feeds into but doesn't itself generate from parsed text; included for completeness since "Points" is a real, common scoring_type value competitors and coaches will reference by name.
- **Edge cases**: this format essentially never appears as something an affiliate coach types into a daily WOD — it's competition-infrastructure, included here so the taxonomy doesn't have a gap when Forge eventually supports competition/leaderboard features.

### 11.4 Handicap / Staggered Start

- **Aliases**: "Handicap start", "staggered start based on [ranking/age/division]"
- **Category**: competition
- **Scoring method**: time_ascending, but athletes start at different clock times based on a handicap so that a simultaneous finish reflects equal performance
- **Structural characteristics**: wraps a base For Time/AMRAP format with a per-athlete start-time offset
- **Metadata requirements**: `handicap_basis` (division | age | prior_score)
- **Parser examples**: N/A as raw workout text (competition-logistics concept, not commonly affiliate-programmed) — included for taxonomy completeness.

---

## 12. HYROX-Specific Formats

HYROX is functionally a FIXED, single race format (not a library of varying daily formats like CrossFit), but HYROX-STYLE training programming (used heavily by hybrid-athlete coaches and increasingly by CrossFit affiliates running "HYROX prep" classes) generates its own distinct sub-formats. **Entirely absent from the source v1.0 architecture.**

### 12.1 HYROX Race Simulation (Full or Half)

- **Aliases**: "HYROX Sim", "Full Race Simulation", "Half HYROX"
- **Category**: hyrox
- **Scoring method**: time_ascending (single overall time across the full alternating run/station sequence)
- **Structural characteristics**: a FIXED, named sequence of 8 alternating 1km runs and 8 functional stations, always in the same order (SkiErg → 1km Run → Sled Push → 1km Run → Sled Pull → 1km Run → Burpee Broad Jumps → 1km Run → Rowing → 1km Run → Farmers Carry → 1km Run → Sandbag Lunges → 1km Run → Wall Balls) — this exact sequence and station set is canonical and should be stored as a literal reference definition, not re-derived from parsed text each time
- **Metadata requirements**: `distance_per_run_m` (1000, standard; scaled variants exist), `station_loads` (division/gender-specific, e.g. Open vs. Pro sled weights), `division` (Open | Pro | age-group)
- **Parser examples**: `HYROX Sim: full race, Open division weights`
- **Edge cases**: station LOADS are division- and gender-specific per the official HYROX rulebook (a real, external data dependency — Forge would need to maintain HYROX's own official standards table, separate from CrossFit's RX/scaled convention, if it wants this to be accurate) — flagged as a genuine content-maintenance burden, not just a parsing concern.

### 12.2 HYROX Station Isolation Training

- **Aliases**: "HYROX Station Work", "[Station name] intervals"
- **Category**: hyrox
- **Scoring method**: varies per station (time for sled work, reps/calories for erg work, etc.)
- **Structural characteristics**: isolated practice of ONE of the 8 canonical HYROX stations, often for higher volume than race-day (e.g. 4x the race-day sled distance) as a training stimulus
- **Metadata requirements**: `hyrox_station` (an enum referencing the 8 canonical stations — SkiErg, Sled Push, Sled Pull, Burpee Broad Jump, Rowing, Farmers Carry, Sandbag Lunges, Wall Balls), `volume_multiplier_vs_race` (optional)
- **Parser examples**: `HYROX Sled Push practice: 8x 50m @ race weight, rest 90s`
- **Edge cases**: "Sled Push" and "Sled Pull" are BOTH real HYROX stations and use the exact same equipment (a sled) — text-only parsing must catch the push/pull distinction explicitly, since it's easy to lose in shorthand ("sled work" alone is ambiguous between the two).

### 12.3 Compromised Running (Run + Station Combos, non-race sequence)

- **Aliases**: "HYROX-style", "Run-Station Combo"
- **Category**: hyrox
- **Scoring method**: time_ascending, typically structured as RFT or AMRAP over the combo
- **Structural characteristics**: mimics HYROX's alternating run/station stress pattern but with a coach-chosen (not the fixed official) run distance and station selection/order — the defining HYROX-adjacent characteristic is "running under fatigue between functional stations", not the exact official sequence
- **Metadata requirements**: same shape as a generic RFT/AMRAP, with an optional `hyrox_style: true` tag for classification/search purposes
- **Parser examples**: `HYROX-style: 4 rounds - 400m Run, 20 Wall Balls, 400m Run, 15 Sled Pushes`
- **Edge cases**: distinguishing this from an ordinary running-metcon (which CrossFit has always had, e.g. "run + burpees") is largely a matter of framing/labeling rather than a hard structural rule — the parser should trust an explicit "HYROX" label when present, and NOT attempt to auto-classify ordinary run-containing metcons as HYROX-style without one.

---

## 13. Tactical & Military Fitness Formats

Distinct from mainstream CrossFit despite heavy movement overlap, because scoring/structural conventions differ (rucking, weighted-vest standards, PT-test formats). **Entirely absent from the source v1.0 architecture.**

### 13.1 Ruck-Based Formats

- **Aliases**: "Ruck", "Ruck March", "Weighted Ruck"
- **Category**: tactical
- **Scoring method**: time_ascending (fixed distance) or distance_total (fixed time)
- **Structural characteristics**: sustained loaded carry over distance, typically via a ruck/backpack rather than a barbell/farmers-carry implement; often paired with bodyweight movements at set intervals ("ruck 2 miles, every 10 min stop and do 20 push-ups")
- **Metadata requirements**: `ruck_weight` (with an explicit unit — lb is far more common than kg in this specific tradition, unlike mainstream CrossFit which is roughly 50/50), `distance_m` or `duration_sec`
- **Parser examples**: `Ruck 3 miles @ 35lb, sub-45 min standard`
- **Edge cases**: ruck weight standards are frequently tied to a specific military/first-responder PT test (e.g. a specific agency's academy standard) — this is domain knowledge Forge would need to maintain as reference data if it wants to support "standard" comparisons, similar to the HYROX division-weights concern in 12.1.

### 13.2 PT Test / Standards-Based Formats

- **Aliases**: "PT Test", "APFT" (Army Physical Fitness Test), "ACFT" (Army Combat Fitness Test), agency-specific test names generally
- **Category**: tactical
- **Scoring method**: points (a standardized points table converts raw performance — reps, time — into a pass/fail or graded score per the test's own official standard)
- **Structural characteristics**: a FIXED, named battery of specific events (e.g. ACFT: 3 Rep Max Deadlift, Standing Power Throw, Hand-Release Push-up, Sprint-Drag-Carry, Plank, 2-Mile Run) always performed in the same combination and order, each independently scored then converted to points and summed
- **Metadata requirements**: `test_name` (enum/reference — these are official, named, externally-defined tests, analogous to HYROX's fixed sequence in 12.1), `events` (fixed per test_name), `points_table` (age/gender-specific, externally defined)
- **Parser examples**: `ACFT Test Day` (implies the full fixed 6-event battery — most of the structure is NOT in the text, it's implied by the test name)
- **Edge cases**: like HYROX and Death By Weight/HYROX station loads, this requires Forge to maintain accurate REFERENCE DATA for each named test's official structure and scoring table — a real content-maintenance dependency beyond pure movement/format taxonomy, and one where getting it wrong has real consequences (these tests gate military career outcomes) — flagged as something Forge should treat cautiously and cite official sources for, not guess at.

### 13.3 Loaded Movement Standards ("Murph-style" weighted vest formats)

- **Aliases**: not a single named format — this is a MODIFIER pattern ("with a vest", "weighted", "20lb vest") applied across many other formats, called out separately here because it's specifically prevalent in the tactical/military tradition (though it originates from, and remains common in, mainstream CrossFit via Murph itself)
- **Category**: modifier (not a standalone format)
- **Scoring method**: N/A — modifies the scoring of whatever base format it's attached to (does not change scoring TYPE, but does mean the RX standard for a workout includes a vest weight, and completing the same movements/time WITHOUT the vest is a materially different, non-equivalent result)
- **Metadata requirements**: `vest_weight`, `vest_required_for_rx` (bool — Murph itself is a good example: vest is technically part of RX but overwhelmingly skipped by most participants in practice, a real scoring-integrity ambiguity worth flagging rather than silently assuming)
- **Parser examples**: `Murph (with a 20lb vest)`, `Weighted vest Murph, Rx`
- **Edge cases**: because vest-wearing is so commonly SKIPPED even when technically prescribed, any FCKB-driven leaderboard/PR feature comparing "Rx" times across athletes needs an explicit vest-worn flag captured at LOG time, not just inferred from the workout's own prescription — a data-capture requirement outside FCKB's own scope but directly caused by ambiguity FCKB surfaces.

---

## 14. Endurance Programming Formats

Distinct running/rowing/biking/swimming programming conventions borrowed from traditional endurance sport coaching, increasingly blended into CrossFit-adjacent "hybrid athlete" programming (HWPO in particular runs substantial pure-endurance content). **Entirely absent from the source v1.0 architecture.**

### 14.1 Steady State / Zone Training

- **Aliases**: "Steady State", "Zone 2", "Easy Pace", "Z1/Z2/Z3/Z4/Z5" (heart-rate-zone shorthand)
- **Category**: endurance
- **Scoring method**: completed (typically not scored competitively — the point is sustained effort at a controlled intensity, logged by duration/distance, not raced)
- **Structural characteristics**: continuous effort at a prescribed, sub-maximal intensity for a set duration or distance
- **Metadata requirements**: `duration_sec` or `distance_m`, `intensity_prescription` (heart-rate zone | pace | RPE)
- **Parser examples**: `Zone 2 Row, 40 min`, `Easy 5K, conversational pace`
- **Edge cases**: heart-rate zone numbering (Z1-Z5) is NOT universally standardized across coaching methodologies — different systems (e.g. 5-zone vs. 3-zone models) assign different physiological meaning to "Zone 2", so a bare "Z2" reference is ambiguous without knowing which zone MODEL the writing coach uses; a real, hard-to-resolve edge case.

### 14.2 Tempo / Threshold Run

- **Aliases**: "Tempo Run", "Threshold", "Lactate Threshold pace"
- **Category**: endurance
- **Scoring method**: completed, sometimes pace_average
- **Structural characteristics**: sustained effort at "comfortably hard" intensity, typically 20-40 minutes continuous, at a pace near (not at) the athlete's lactate threshold
- **Metadata requirements**: `duration_sec`, `target_pace` (optional)
- **Parser examples**: `Tempo Run: 30 min @ threshold pace`
- **Edge cases**: "Tempo" here (an endurance-pacing concept) is a COMPLETELY different meaning from "Tempo" in strength training (7.9, an eccentric/concentric timing prescription) — identical word, unrelated concepts, and a parser MUST disambiguate by context (presence of a distance/duration+pace vs. presence of a 4-digit tempo code) rather than treating "tempo" as a single canonical term.

### 14.3 Interval Repeats (Endurance-style, distinct from CrossFit Intervals)

- **Aliases**: "Repeats", "X x [distance] @ [pace]", "Track Repeats"
- **Category**: endurance
- **Scoring method**: pace_average or time per repeat
- **Structural characteristics**: structurally similar to Generalized Work/Rest Intervals (4.1) but the PRESCRIPTION is pace-based rather than a fixed work/rest TIME split — e.g. "6x800m @ 5K pace, 2 min rest between" specifies distance and target pace per rep, not a fixed work-duration
- **Metadata requirements**: `reps`, `distance_per_rep_m`, `target_pace`, `rest_sec` (or `rest_type`: fixed | pace-recovery-based, e.g. "rest until HR drops below 130")
- **Parser examples**: `8x400m @ mile pace, 90s rest`, `5x1000m Row @ 2K pace - 5s`
- **Edge cases**: rest prescribed as a PHYSIOLOGICAL trigger ("rest until heart rate recovers to X") rather than a fixed duration is a real, if less common, convention that the metadata model must support as an alternative to `rest_sec`.

### 14.4 Fartlek

- **Aliases**: "Fartlek", "Speed Play"
- **Category**: endurance
- **Scoring method**: completed
- **Structural characteristics**: unstructured or semi-structured alternation between hard and easy effort during a continuous run, WITHOUT the fixed, precise intervals of 14.3 — often landmark-based ("sprint to the next lamppost") rather than time/distance-based
- **Metadata requirements**: minimal — often just `duration_sec` total, with the internal structure explicitly unprescribed
- **Parser examples**: `Fartlek Run, 30 min, mix easy/hard by feel`
- **Edge cases**: this format is DEFINED by its lack of fixed internal structure — a parser should not attempt to force it into an `intervals` metadata shape; it needs to be representable as "structured-but-freeform", a genuinely different shape than every other format in this document.

### 14.5 Negative Split

- **Aliases**: "Negative Split", "back half faster"
- **Category**: endurance
- **Scoring method**: pace_average with an explicit pacing-strategy requirement (not just a raw score — the ATTEMPT is invalid/unsuccessful in intent, even if completed, if the split pattern isn't achieved)
- **Structural characteristics**: a single continuous effort (a run, row, etc.) with an explicit instruction that the second half must be faster than the first
- **Metadata requirements**: `total_distance_m` or `total_duration_sec`, `split_requirement: negative`
- **Parser examples**: `5K Row, negative split (back 2.5K faster than front 2.5K)`
- **Edge cases**: this is one of the only formats in this entire catalog where "successfully completing the workout" and "achieving the prescribed intent" are separable outcomes that both need to be tracked — a real scoring-model nuance not present anywhere else in the taxonomy.

---

## 15. Functional Bodybuilding / Accessory Formats

**A missing category entirely absent from the source v1.0 architecture's movement taxonomy AND its format list.** CompTrain, HWPO, and PRVN all run substantial dedicated "accessory" or "functional bodybuilding" blocks (isolation/single-joint work, higher rep ranges, aesthetic/injury-prevention focus) that don't fit neatly into either "metcon" or "heavy strength" — they use straightforward strength-format structures (7.1, 7.8 Superset/Triset/Giant Set most commonly) but the MOVEMENT CATALOG gap (see MOVEMENT_CATALOG.md Section 15) is the more significant omission here; this format section exists mainly to flag that these blocks are real, common, and named.

- **Aliases**: "Accessory work", "Functional Bodybuilding", "FBB", "Pump work", "Isolation block"
- **Category**: accessory
- **Scoring method**: completed (rarely scored numerically — logged as done, sometimes with weight/band tracked)
- **Structural characteristics**: typically Superset/Triset/Giant Set (7.8) structure, higher rep ranges (10-20+), shorter rest, single-joint/isolation movement emphasis
- **Metadata requirements**: same as 7.8, plus an optional `training_goal` tag (hypertrophy | injury_prevention | aesthetic)
- **Parser examples**: `FBB: 3 rounds - Banded Face Pulls x20, DB Lateral Raise x15, Band Pull-Apart x25`
- **Edge cases**: none beyond the underlying Superset/Triset structural edge cases (7.8) — the gap here is entirely in movement coverage, not format structure.

---

## 16. Scoring Method Taxonomy (Cross-Cutting Reference)

This is not itself a `workout_format` but a controlled vocabulary every format entry above references — the source v1.0 architecture has `scoring_type` as a field on `workout_formats` with no enumerated values, which this section fills in as a concrete proposal (see FCKB_ARCHITECTURE_REVIEW.md for the case that this deserves its own reference table rather than a free-text field):

- `time_ascending` — lower elapsed time is better (For Time family)
- `time_descending` — N/A in practice (no real CrossFit format scores "longer time wins" as a primary metric — included only to note the taxonomy is directional, not symmetric by default)
- `rounds_and_reps` — a compound score (whole rounds + partial reps into the next round); requires the round's total rep count as context to compare two scores meaningfully (14 rounds + 5 reps out of a 20-rep round is NOT better than 13 rounds + 18 reps)
- `reps_total` — a single rep count, no round structure
- `reps_completed` (sequential_partial) — like reps_total, but specifically the "how far did you get" breakdown for an unfinished For Time effort, tracked PER MOVEMENT, not just a grand total (needed to reconstruct "which movement they were on" for coaching/leaderboard display)
- `reps_per_interval` — a list of per-interval values (Tabata, generalized Intervals), reducible to `Total Reps` (sum) or `Lowest Reps` (min) display modes
- `max_weight` — heaviest successful load
- `max_distance` / `distance_total` — furthest/most distance
- `distance_per_interval` — for monostructural interval work scored by distance per interval rather than reps
- `calories_per_interval` — same, for erg-based work
- `height_total` — highest point reached (rare, box jump max height)
- `tonnage_total` — cumulative weight × reps across a session/block
- `pace_average` — average pace (time/distance), for endurance-style scoring
- `completed` — pass/fail or logged-without-a-competitive-number (most strength-prescription and accessory work)
- `points` — an externally-defined points table converts raw performance to a score (competition/PT-test formats)

---

## 17. Format Composition Rules (Cross-Cutting)

A finding that applies across nearly every section above and deserves explicit statement: **most real-world workouts are not a single format — they're a COMPOSITION of formats**, and the source v1.0 architecture's implied one-format-per-workout model (a single `workout_format_id` FK on `benchmark_workouts`) does not hold up:

- A Buy-In/Cash-Out (Section 8) wraps a nested For Time or AMRAP.
- A Multi-Part competition event (11.1) contains 2+ fully independent nested formats.
- A Partner WOD (Section 9) wraps a base format (RFT, AMRAP, For Time) with a partner-structure modifier layered on top.
- Tempo (7.9) and weighted-vest (13.3) are pure MODIFIERS, not standalone formats, applicable to almost any base format.
- A single class/session commonly contains multiple, entirely separate workout blocks (a strength piece + a metcon), which the source schema's single-workout-per-day framing (inherited from the `wods` table structure Forge already uses in production — see FCKB_ARCHITECTURE_REVIEW.md for how this connects to the *existing*, already-shipped Programming domain) does not naturally accommodate without the section-based model Forge's own production `wods`/section-editor already implements (see `PROGRAMMING_DOMAIN_ARCHITECTURE.md` and Programming Phase 2's `sectionEditing.ts` in this same codebase) — a genuinely important point of continuity the architecture review addresses directly.

This document's per-format "Metadata requirements" fields are written to support NESTING (a `main_block` or `parts` field referencing another format definition) specifically so this composability is representable, rather than assuming every workout maps to exactly one flat format row.

---

## 18. Missing Format Categories Identified (Summary)

Explicit callout, per the mission's instruction to identify gaps rather than just filling in what was listed:

1. **Strength & Loading programming** (Section 7) — present in the source only as 3 bare, undefined names ("Wave Loading", "Tempo", "Percentage Work"); this document adds Straight Sets, Progressive Loading, Percentage-Based (with the training-max vs. true-max distinction), Cluster Sets, named Progression Systems (5/3/1, Westside, Sheiko, Bulgarian, Linear/Block Periodization, DUP, Juggernaut), Complex, and Superset/Triset/Giant Set as fully-specified formats.
2. **Partner/Team/Relay/Stations** (Section 9) — present only as 3 bare names; this document adds real structural definitions and 4 genuinely distinct sub-formats (You-Go-I-Go, Shared/Synchro, Relay, Team Aggregate).
3. **Sport-of-Fitness / competition event formats** (Section 11) — entirely absent.
4. **HYROX-specific formats** (Section 12) — entirely absent, despite HYROX being one of the fastest-growing adjacent disciplines gym members increasingly train for.
5. **Tactical/military fitness formats** (Section 13) — entirely absent.
6. **Endurance programming formats** (Section 14) — entirely absent, despite HWPO-style hybrid programming making this common.
7. **Functional Bodybuilding/Accessory** (Section 15) — entirely absent as a named category (though the deeper gap is in the movement catalog, not the format list).
8. **A controlled scoring-method vocabulary** (Section 16) — the source schema has a free-text `scoring_type` field with no enumeration.
9. **Explicit format-composition/nesting support** (Section 17) — the source schema's one-format-per-workout implication doesn't hold for a large fraction of real-world workouts.
10. **Density/Accumulation formats** (Section 10) — entirely absent, common in accessory/GPP-focused programming.

Total distinct, structurally-defined formats cataloged in this document: **55** (counted directly: Section 1: 4, Section 2: 4, Section 3: 6, Section 4: 2, Section 5: 4, Section 6: 4, Section 7: 8 distinct structural formats — 7.4 is a cross-reference to 5.4, not a new entry, and 7.6's 8 named progression systems are worked examples of one format shape rather than 8 separate ones — Section 8: 1, Section 9: 4, Section 10: 2, Section 11: 4, Section 12: 3, Section 13: 3, Section 14: 5, Section 15: 1; Section 16's scoring taxonomy and Section 17's composition rules are cross-cutting reference material, not formats themselves, and are not included in this count). This exceeds the source architecture's own target of 35–40 by a real margin, consistent with the mission's finding that the flat 35-name list was a significant undercount once sub-variants, strength-programming formats, and the five entirely-missing families (competition, HYROX, tactical, endurance, accessory) are accounted for.
