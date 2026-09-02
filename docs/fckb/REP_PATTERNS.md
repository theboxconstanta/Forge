# FCKB — Rep Patterns & Notation

This document catalogs the actual TEXTUAL/NUMERIC notation patterns a parser must recognize inside a workout — as distinct from `WORKOUT_FORMATS.md`, which catalogs the higher-level STRUCTURE a workout is organized into. A `workout_format` (e.g. "For Time") tells you what KIND of workout this is; a `rep_pattern` tells you how to read the specific numbers a coach wrote. The two combine: "21-15-9" (a rep_pattern, Section 1.1 below) inside a "For Time" (a workout_format) is Fran's actual structure.

Each entry follows this template:

- **Pattern name**
- **Aliases / how coaches actually write it**
- **Regex sketch** — a human-readable description of the matching rule, not literal executable regex (the actual implementation regex is a parser-engineering concern outside FCKB's own scope, but the STRUCTURE of what must be matched belongs here)
- **Parser hint** — what the parser must extract and how to interpret it
- **Worked examples**
- **Edge cases**

---

## 1. Descending Rep Schemes

### 1.1 Classic Hyphenated Descending Ladder

- **Aliases**: "21-15-9", "50-40-30-20-10", any hyphen-joined descending integer sequence
- **Regex sketch**: `\d+(-\d+){1,}` where each subsequent number is strictly less than the previous
- **Parser hint**: each number is a REP COUNT for the round at that position; the sequence length = number of rounds; this pattern almost never appears alone — it's a set of rep TARGETS applied uniformly across every movement listed alongside it (i.e. "21-15-9 Thrusters, Pull-ups" means round 1 = 21 of each, round 2 = 15 of each, round 3 = 9 of each — NOT 21 thrusters total split some other way)
- **Worked examples**: `21-15-9`, `50-40-30-20-10`, `9-7-5` (Amanda), `10-9-8-7-6-5-4-3-2-1`
- **Edge cases**: a sequence that ISN'T strictly monotonic (e.g. "21-15-9-15-21", a pyramid — see Section 3) must not be misclassified as a simple descending ladder; a sequence with EQUAL consecutive values (e.g. "10-10-10") is not a ladder at all, it's Rounds notation (Section 8) misformatted with hyphens instead of "x".

### 1.2 Per-Movement Independent Descending Schemes

- **Aliases**: "21-15-9 Thrusters / 15-12-9 Pull-ups" (two DIFFERENT schemes for two different movements in the same workout — a real, if less common, pattern distinct from 1.1's single shared scheme)
- **Regex sketch**: multiple `\d+(-\d+){1,}` sequences, each bound to its own following movement name, rather than one sequence governing an entire movement list
- **Parser hint**: cannot assume one scheme applies to all movements in a section — each movement may carry its own independent scheme, requiring the parser to associate schemes with movements by proximity/line-grouping, not just by "the first number sequence found in this section"
- **Worked examples**: `21-15-9 Thrusters\n15-12-9 Chest-to-Bar Pull-ups` (a real, named variant sometimes called "Fran/Elizabeth hybrid" informally — each movement decreases at a different rate)
- **Edge cases**: this is one of the higher-risk misparse patterns — a naive parser that greedily applies the FIRST scheme found to every subsequent movement will silently corrupt the second movement's actual prescribed reps.

---

## 2. Ascending Rep Schemes

### 2.1 Classic Hyphenated Ascending Ladder

- **Aliases**: "1-2-3-4-5...", "3-6-9-12..."
- **Regex sketch**: `\d+(-\d+){1,}` where each subsequent number is strictly greater than the previous, optionally with `...` or `to X` indicating the sequence continues beyond what's explicitly written
- **Parser hint**: if terminated with `...`/`etc`, the increment must be inferred from the first 2-3 terms (constant difference in almost all real cases) and the sequence has NO fixed ceiling unless a time cap or round-count elsewhere bounds it
- **Worked examples**: `1-2-3-4-5-6-7-8-9-10`, `3-6-9-12-15...` (an open-ended ascending AMRAP ladder, see WORKOUT_FORMATS.md 2.2)
- **Edge cases**: an ascending sequence with a NON-constant increment (e.g. "1-2-4-8-16", doubling rather than adding) is real but rare — the parser should verify constant-difference before assuming a simple `start + increment*n` formula, and flag non-arithmetic sequences as low-confidence.

### 2.2 "Add X Each Round" Verbal Notation

- **Aliases**: "each round, add 3 reps", "+3 reps/round", "increasing by 3 every round"
- **Regex sketch**: `[+]?\d+\s*(reps?)?\s*(/|per|each)\s*round`
- **Parser hint**: extracts the SAME information as 2.1's explicit sequence, but expressed as a rule rather than an enumerated list — the parser must also locate the STARTING rep count separately (often stated as "starting at X" or simply the first movement's listed rep count), since the increment alone is insufficient
- **Worked examples**: `Burpees, starting at 3, +3 each round`, `Deadlifts: begin at 5, increasing by 5 every round`
- **Edge cases**: "add 3 reps" without specifying WHICH movement(s) it applies to, in a multi-movement round, is ambiguous — does the increment apply to every movement independently, or is there one shared "round number" that scales all movements by the same multiplier? Both conventions exist in real programming; must be resolved by explicit context or flagged low-confidence.

---

## 3. Pyramid & Wave Rep Schemes

### 3.1 Symmetric Rep-Count Pyramid

- **Aliases**: "1-2-3-4-5-4-3-2-1", "up and down the ladder"
- **Regex sketch**: an ascending sequence immediately followed by its own reverse (peak value not repeated)
- **Parser hint**: total round count = 2×(ascending length) − 1; the peak value appears exactly once
- **Worked examples**: `1-2-3-4-5-4-3-2-1`
- **Edge cases**: distinguishing a genuine pyramid from a coincidentally-palindromic but actually-intentional two-part workout (e.g. a workout that climbs for one reason and independently descends for another, with the peak stated twice, once per "part") — rare, but the double-peak variant (`1-2-3-4-5-5-4-3-2-1`) is a real, distinct pattern (Section 3.2) that must not be conflated with the single-peak version.

### 3.2 Double-Peak / Plateau Pyramid

- **Aliases**: same family as 3.1 with the peak value repeated once (a brief plateau at the top)
- **Regex sketch**: ascending sequence, peak value appearing exactly twice consecutively, then the reverse sequence
- **Parser hint**: same as 3.1 but round count = 2×(ascending length) + 1
- **Worked examples**: `1-2-3-4-5-5-4-3-2-1`
- **Edge cases**: none beyond distinguishing from 3.1 by peak repetition count.

### 3.3 Asymmetric Pyramid

- **Aliases**: no fixed name — described structurally ("up faster than down" or vice versa)
- **Regex sketch**: an ascending sequence with one increment size, followed by a descending sequence with a DIFFERENT increment size (not the mirror of the ascent)
- **Parser hint**: cannot assume symmetry — must independently parse the ascending and descending halves as two separate sequences
- **Worked examples**: `2-4-6-8-10-8-6-4-2` (ascending by 2s, descending by 2s but starting the descent from a different point than a pure mirror would — worked examples of true asymmetry are rarer in practice but the notation exists)
- **Edge cases**: mostly a parser-robustness concern (don't hard-assume mirror symmetry) rather than a frequently-seen real pattern.

### 3.4 Loading Pyramid (Weight, Not Reps)

- **Aliases**: "pyramid up in weight", "ascending pyramid", "back-off sets" (the descending-weight half specifically)
- **Regex sketch**: N/A as a single numeric token — this is a STRUCTURAL prescription (Straight Sets/Progressive Loading, see WORKOUT_FORMATS.md 7.1/7.2) with reps typically held CONSTANT or DECREASING while weight increases each set, the inverse relationship of the rep-count pyramid (3.1) — flagged here specifically because the word "pyramid" is heavily overloaded between this (load) and 3.1 (reps) meanings
- **Parser hint**: disambiguate by checking whether the varying quantity across the listed sets is reps or an explicit weight/percentage token; a set list like "5-3-1 reps @ 70-80-90%" is a LOADING pyramid (reps decrease, load increases) not a rep-count pyramid (3.1) even though it superficially resembles a descending ladder
- **Worked examples**: `Back Squat: 5@60%, 5@70%, 3@80%, 1@90%, 1@95%` (ascending load pyramid), `then back off: 5@80%, 5@70%` (descending back-off half)
- **Edge cases**: this is the single most consequential ambiguity in this whole document — misreading a loading pyramid as a rep-count pyramid would generate a completely fictitious "workout" bearing no resemblance to what the coach actually programmed (confusing "5 reps at 60% load" with "do 5 total reps of the movement" loses the load information entirely). The presence of ANY explicit load/percentage token anywhere in the line is the deciding signal for "this is a loading pyramid, not a rep pyramid."

---

## 4. Percentage & Load Notation

### 4.1 Simple Percentage

- **Aliases**: "@ 70%", "70% 1RM", "at seventy percent"
- **Regex sketch**: `@?\s*\d{1,3}\s*%`
- **Parser hint**: `percentage` field; MUST resolve `reference_lift` (see WORKOUT_FORMATS.md 7.3) — defaults to "the movement being performed's own 1RM" unless explicitly stated otherwise, but this default itself is an assumption worth flagging at low confidence when no reference is stated
- **Worked examples**: `Back Squat 5x3 @ 80%`, `70% of 1RM Snatch`
- **Edge cases**: a percentage RANGE ("75-80%") is common and must be captured as a range, not coerced to a single midpoint value — coaches intend the athlete to have discretion within the stated band.

### 4.2 Percentage of Bodyweight

- **Aliases**: "%BW", "1x bodyweight", "1.5xBW", "bodyweight deadlift"
- **Regex sketch**: `\d+(\.\d+)?\s*x\s*BW` or `\d{1,3}\s*%\s*BW`
- **Parser hint**: distinct `reference_basis: bodyweight` rather than `reference_basis: 1RM` — requires the athlete's logged bodyweight to resolve to an absolute load, a real cross-domain dependency (FCKB parsing correctly still leaves an unresolved value without member-profile data)
- **Worked examples**: `Deadlift @ 1.5x Bodyweight`, `Bench Press: 75% BW x10`
- **Edge cases**: "bodyweight" as a LOADING reference (this section) is a completely different concept from "Bodyweight" as a MOVEMENT category flag (a movement performed with no external load at all — see MOVEMENT_CATALOG.md) — same word, must be disambiguated by whether it appears attached to a percentage/multiplier or as a standalone descriptor.

### 4.3 RPE (Rate of Perceived Exertion)

- **Aliases**: "RPE 8", "@ RPE 7-8", "RPE8"
- **Regex sketch**: `RPE\s*\d{1,2}(\.\d)?(-\d{1,2})?`
- **Parser hint**: `rpe` field (integer or decimal, 1-10 scale by near-universal convention, though a few coaches use a 1-5 scale — ambiguous without an explicit scale statement, flagged low-confidence if the value is ≤5 and no scale is stated); RPE is a SUBJECTIVE intensity anchor, not a resolvable absolute load the way a percentage is — cannot be converted to a weight without athlete feedback in the moment, unlike 4.1
- **Worked examples**: `Squat 3x5 @ RPE 8`, `Build to a heavy single @ RPE 9`
- **Edge cases**: RPE and percentage are sometimes given TOGETHER as a cross-check ("@ 80% / RPE 8") — both values should be captured, not treated as redundant, since a mismatch between them (a lift feeling much harder or easier than the percentage predicts) is itself meaningful coaching information.

### 4.4 RIR (Reps in Reserve)

- **Aliases**: "RIR 2", "leave 2 in the tank", "2 reps shy of failure"
- **Regex sketch**: `RIR\s*\d{1,2}`
- **Parser hint**: `rir` field — inversely related to RPE (RPE 8 ≈ RIR 2 on most conversion tables) but NOT a guaranteed 1:1 mathematical inverse across all coaching systems, so both should be stored as independently-provided values rather than one being derived from the other when both appear
- **Worked examples**: `Bench Press 4x6 @ RIR 2`
- **Edge cases**: "leave X in the tank" / "X reps shy of failure" verbal phrasings are common and must map to the same `rir` field as the abbreviated form.

---

## 5. Rep-Max & Set/Rep Notation

### 5.1 XRM (Rep-Max Testing)

- **Aliases**: "1RM", "3RM", "5RM", "find your X", "X-rep max"
- **Regex sketch**: `\d{1,2}\s*RM`
- **Parser hint**: `target_rep_max` field — a 1RM and a 5RM for the same movement are fundamentally different, non-comparable scores, and must never be silently coerced to a common "max" field without preserving which rep-max was tested (see WORKOUT_FORMATS.md 6.3)
- **Worked examples**: `Find 3RM Front Squat`, `1RM Clean & Jerk`
- **Edge cases**: bare "Max" with no digit (implicit 1RM by convention, see WORKOUT_FORMATS.md 6.3 edge case) — genuinely ambiguous, should be a lower-confidence inferred `target_rep_max: 1`, not a hard certainty.

### 5.2 Sets × Reps ("SxR")

- **Aliases**: "5x5", "3x10", "4 sets of 8"
- **Regex sketch**: `\d{1,2}\s*x\s*\d{1,3}` OR `\d{1,2}\s*sets?\s*(of|x)\s*\d{1,3}\s*reps?`
- **Parser hint**: first number = `sets`, second = `reps_per_set` — BUT this ordering is not universal (see edge cases); output must always preserve which number was which role, not just "two numbers were found"
- **Worked examples**: `5x5 Back Squat`, `3 sets of 10 push-ups`, `Bench: 4x8`
- **Edge cases**: **reversed notation is real** — some coaches (a minority, but not negligible) write "reps x sets" instead of "sets x reps" (e.g. "10x3" meaning 10 reps, 3 sets, not 10 sets of 3) — this is genuinely unresolvable from the numbers alone in many cases and requires either an explicit convention setting per gym/coach, or defaulting to the overwhelmingly dominant sets-first convention while flagging low confidence when the first number is unusually large for a set count (>10) and the second is unusually large for typical strength rep ranges — a heuristic, not a certainty. Also collides visually with Rounds notation (Section 8) and with Death By's interval-count notation when unitless.

### 5.3 Multi-Set Explicit Rep Lists

- **Aliases**: "5-5-5-5-5" (five sets of five, written as a repeated-value hyphen list rather than "5x5" shorthand), "Back Squat: 5-5-3-3-1-1"
- **Regex sketch**: hyphen-joined integer sequence where consecutive values may repeat or vary (distinguishing this from 1.1/2.1 which require strict monotonicity) — VARYING rep counts per set with each set independently specified
- **Parser hint**: each number is one set's rep count, in order; sequence length = number of sets; the corresponding LOAD for each set (often also given, separately) must be zipped positionally to the matching set, not just captured as a flat list — a real alignment requirement
- **Worked examples**: `Back Squat: 5-5-5-5-5 @ 225lb`, `5-3-1 @ 70-80-90%` (this example is ALSO a loading pyramid, Section 3.4 — the two patterns frequently co-occur in the same line and must both be recognized)
- **Edge cases**: identical surface syntax to a rep-count ladder (1.1/2.1) when the sequence happens to be monotonic (e.g. "5-4-3-2-1" could be either a strength taper or a metcon descending ladder) — disambiguated only by surrounding context (presence of a workout_format like "For Time"/"AMRAP" signals rep-count ladder; presence of "sets", a movement typically strength-trained, or a load/percentage signals sets×reps).

### 5.4 Repeated-Wave Notation

See WORKOUT_FORMATS.md Section 5.4 (Wave Ladder) for the structural definition; the notation itself typically appears as N copies of a short set-list separated by "then repeat" or explicit wave labels ("Wave 1: 3-2-1 @ 70-75-80%, Wave 2: 3-2-1 @ 75-80-85%").

- **Regex sketch**: a repeated short numeric sequence (2-4 terms), appearing 2+ times, each occurrence's baseline load shifted from the previous
- **Parser hint**: `wave_pattern` (the repeating shape) + `wave_count` + the per-wave load shift; requires grouping consecutive short sequences rather than treating the whole thing as one long flat list
- **Worked examples**: `3-2-1 @ 75-80-85%, then 3-2-1 @ 80-85-90%, then 3-2-1 @ 85-90-95%` (3 waves)
- **Edge cases**: without explicit "Wave" labeling, this is genuinely hard to distinguish from a very long multi-set explicit list (5.3) — the repeating SHAPE (same length sub-sequence recurring) is the only structural signal, and short waves (2-term) are especially easy to miss as "just more sets" rather than a new wave.

---

## 6. Interval & EMOM Notation

### 6.1 Minute-Slot Assignment

- **Aliases**: "Min 1:", "Minute 1 -", "1st min:"
- **Regex sketch**: `(min(ute)?\.?\s*\d{1,3})\s*[:\-]`
- **Parser hint**: each labeled minute introduces the movement/rep prescription for that specific interval slot; sequential minute labels with IDENTICAL content can be collapsed to a single `movement_per_interval` entry (standard EMOM), while DIFFERING content per labeled minute requires the full `intervals` list (alternating EMOM, WORKOUT_FORMATS.md 3.4)
- **Worked examples**: `Min 1: 12 Wall Balls\nMin 2: 10 Burpees\nMin 3: Rest`
- **Edge cases**: "Rest" as an explicit minute-slot content (as above) is real and must be representable — not an omission/parsing failure, but a deliberate empty/rest interval.

### 6.2 "EMOM X" Total-Duration Shorthand

- **Aliases**: "EMOM 20", "EMOM x20", "EMOM for 20 minutes"
- **Regex sketch**: `EMOM\s*(x|for)?\s*\d{1,3}\s*(min(ute)?s?)?`
- **Parser hint**: the number is TOTAL DURATION IN MINUTES by default (not round count directly, though for a standard 60s-interval EMOM these are numerically identical, which is exactly why this notation is ambiguous the moment a non-standard interval is introduced elsewhere in the same line, e.g. "EMOM 20 (E2MOM)" — total duration 20 min, but only 10 actual rounds since each interval is 2 min, not 1)
- **Worked examples**: `EMOM 20:`, `EMOM x 30`
- **Edge cases**: see above — always resolve `total_rounds = total_duration_sec / interval_sec`, never assume `total_rounds = the bare number` once ANY non-60s interval signal is present anywhere in the same workout block.

### 6.3 "Every X [unit]" Generalized Interval Notation

- **Aliases**: "Every 90 seconds", "E90S", "on the 2:00", "every 2 min on the min"
- **Regex sketch**: `every\s*\d{1,4}\s*(sec(ond)?s?|min(ute)?s?)` OR `on the\s*\d{1,2}:\d{2}`
- **Parser hint**: extracts `interval_sec` directly; "on the X:XX" phrasing (a clock-time notation, e.g. "on the 2:00" meaning every 2 minutes) requires converting a MM:SS-formatted token into total seconds, a different extraction path than the plain-number "every X seconds/minutes" phrasing
- **Worked examples**: `Every 90 sec x8: 10 Wall Balls`, `On the 2:00 x6: 3 Cleans`
- **Edge cases**: "on the X:XX" collides syntactically with round-clock TIME CAPS and with logged RESULT times (e.g. "finished on 12:34") — disambiguated only by context (presence of "every"/"x[count]" alongside it signals interval notation; standalone at the end of a workout signals a result).

### 6.4 Death By Increment Notation

- **Aliases**: "+1 each round starting at 1", "Death By [movement]" (implicit default, see WORKOUT_FORMATS.md 3.3)
- **Regex sketch**: `start(ing)?\s*(at|@)?\s*\d+.*?[+]\d+\s*(each|per|/)\s*round` OR bare "Death By [movement]" with no explicit numbers at all
- **Parser hint**: extracts `start_reps` and `increment_reps`; when absent entirely (bare "Death By X"), defaults to `start_reps: 1, increment_reps: 1` per community convention — an inference, not a certainty, and should be flagged as such
- **Worked examples**: `Death By Burpees`, `Death By Thrusters: start at 2, +2 every minute`
- **Edge cases**: shares the "DB" abbreviation collision with Dumbbell and Deadlift — see PARSER_EDGE_CASES.md Section 2.

---

## 7. Buy-In / Cash-Out Numeric Framing

- **Aliases**: "Buy-in: [reps] [movement]", "Cash-out: [reps] [movement]"
- **Regex sketch**: `buy[- ]?in\s*:?` / `cash[- ]?out\s*:?` as line-leading markers, each followed by an ordinary movement+rep line (no special numeric notation beyond a normal rep-movement pair)
- **Parser hint**: these markers change which STRUCTURAL SLOT (see WORKOUT_FORMATS.md Section 8) the following line's content belongs to — the rep notation itself is unremarkable, the marker is what matters
- **Worked examples**: `Buy-In: 50 Double Unders`, `Cash Out: 800m Run`
- **Edge cases**: "buy in" without a colon or clear line break, embedded mid-sentence ("buy in with 50 double unders then...") — a much harder extraction target than the clean labeled-line form, requiring the parser to recognize the phrase as a marker even without formatting cues (see PARSER_EDGE_CASES.md Section 7 for formatting-loss scenarios generally).

---

## 8. Rounds Notation

### 8.1 "X Rounds" / "XRFT" / "Xrds"

- **Aliases**: "5 Rounds", "5 RFT", "5rds", "5 rounds for time", "x5" (as a trailing/leading multiplier on a block)
- **Regex sketch**: `\d{1,3}\s*(rounds?|rds?|rft|x)\b`
- **Parser hint**: `rounds` field on the enclosing RFT/AMRAP-adjacent format; the trailing "x5" form (a bare number+x with no "round" word at all) is the highest-collision-risk variant, syntactically identical to Sets×Reps shorthand (5.2) and to Rep-Max notation when adjacent to other numbers — disambiguated primarily by POSITION (a leading "5x" or "x5" before a full movement LIST, vs. attached directly to a single movement name for sets×reps)
- **Worked examples**: `5 Rounds For Time:`, `x5 rounds:`, `5RFT:`
- **Edge cases**: as noted, `x5` before a multi-movement list is rounds; `5x5` attached to one movement name is sets×reps (5.2) — the presence of a SECOND number immediately after (the `5` in `5x5`) with no round/RFT keyword is the deciding heuristic, but it is a heuristic, not a guarantee.

---

## 9. Sprint & HIIT Interval Protocol Notation

Named, fixed-ratio interval protocols borrowed from sport-science literature, increasingly referenced by name in CrossFit-adjacent conditioning programming — **not covered at all in the source v1.0 architecture's rep_patterns examples**, which list only CrossFit-native schemes.

- **30-30 / 40-20 / 20-10 (Tabata) protocols**: named by their work-rest split in seconds; "30-30" and "40-20" are real, common alternatives to Tabata's canonical 20-10 that get referenced by the same hyphenated-numbers shorthand — collision risk with descending rep ladders (1.1) is real when the numbers happen to also look like a plausible rep scheme (e.g. "30-20-10" IS both a legitimate descending rep ladder AND could be miswritten shorthand for a 3-phase interval — disambiguated only by units/context, since ladders list REPS and this lists SECONDS)
- **Norwegian 4x4**: a named protocol (4 rounds of 4 minutes hard effort / 3 minutes active recovery) — referenced by name alone with no numbers spelled out at all in casual programming ("Norwegian 4x4 on the bike"), requiring the parser to have this as a KNOWN NAMED PROTOCOL with implicit structure, exactly analogous to how "Murph" implies a full movement list without restating it (see BENCHMARK_WORKOUTS.md/HERO_WORKOUTS.md for the general pattern of named-workout implicit-structure resolution)
- **Wingate Protocol**: a specific, named all-out 30-second maximal effort test, referenced by name
- **Parser hint (all of the above)**: this entire category confirms a broader finding — FCKB needs a NAMED-PROTOCOL reference table (structurally identical in kind to `benchmark_workouts`/`hero_workouts`, just for interval protocols rather than full workouts) so that a bare protocol NAME can resolve to a full structural definition without needing the numbers spelled out in the source text every time.

---

## 10. Distance & Load Unit Notation

### 10.1 Distance

- **Aliases**: "400m", "1 mile", "5K", "800 meters"
- **Regex sketch**: `\d+(\.\d+)?\s*(m|meters?|km|mi|miles?|k)\b`
- **Parser hint**: normalize to meters internally regardless of source unit; "5K" (kilometers, running/rowing context) is a DIFFERENT unit than "5K" ambiguously meaning "5,000" in a rep-count context — near-total collision, disambiguated only by whether the surrounding text is a monostructural movement (Row, Run, Bike, Ski) vs. a rep-counted movement
- **Worked examples**: `Row 500m`, `Run 1 mile`, `5K Row`
- **Edge cases**: "5K" as rep-count shorthand (meaning 5,000 reps of something) is rare but real in extreme-volume challenge workouts — context (is the movement monostructural?) is the only reliable disambiguator.

### 10.2 Load — Mixed Units (kg/lb)

- **Aliases**: "43/30kg", "95/65lb", "225#", "100 kilos"
- **Regex sketch**: `\d+(\.\d+)?\s*(kg|lb|lbs?|#)` — the `#` symbol as a pounds shorthand is real and easy to conflate with a rep-count-hash or a "number sign" formatting artifact
- **Parser hint**: `weight_male`/`weight_female` when given as a slash-pair ("43/30kg" = 43kg male RX / 30kg female RX, the near-universal CrossFit convention of male-then-female); MUST preserve the source unit (kg vs lb) rather than silently converting, since a coach's PROGRAMMED unit is itself meaningful (an American-affiliate coach programming in lb vs. a European coach in kg reflects real regional convention, not just a display preference) — conversion for DISPLAY purposes is a separate, downstream concern from CAPTURE
- **Worked examples**: `Thrusters 43/30kg`, `Deadlift 225/155lb`, `Front Squat 100kg`
- **Edge cases**: single-value loads with no slash (unisex-prescribed movements, or a workout written for one specific athlete/class rather than general RX) must not be force-fit into a male/female pair — a single `weight` field alongside the pair fields is needed; `#` as pounds is easily confused with a rep-count when adjacent to another bare number ("21 # 95" — is 95 the weight or something else?) — requires the `#` to be immediately adjacent (no space) to its number to be read as a unit marker, per the dominant real-world convention, though this itself is a heuristic.

---

## 11. Movement-List & Chipper Notation

- **Aliases**: a plain newline- or comma-separated list of "[reps] [movement]" pairs with no explicit round/scheme wrapper
- **Regex sketch**: repeated `\d+\s+[A-Za-z][A-Za-z\- ]*` lines
- **Parser hint**: each line is ONE movement at ONE fixed rep count, to be done once, in the order listed (see WORKOUT_FORMATS.md 1.1/1.3) — this is the "default" fallback interpretation when no other format/scheme signal is present anywhere in the text, and the parser should treat it as its lowest-priority, most-fallback pattern, not attempt it first
- **Worked examples**: `50 Wall Balls\n40 SDHP\n30 Box Jumps\n20 Burpees\n10 Muscle-ups`
- **Edge cases**: a single-line, comma-separated version of the same thing ("50 Wall Balls, 40 SDHP, 30 Box Jumps") is equally common and must be split on commas as reliably as on newlines — a real, frequent formatting-loss scenario (see PARSER_EDGE_CASES.md Section 8, PDF/copy-paste line-break loss) where newline-based parsing alone will fail silently.

---

## 12. Partner Rep-Splitting Notation

- **Aliases**: "split any way", "each partner does half", "P1/P2 alternate every X reps"
- **Regex sketch**: N/A as a numeric pattern — this is closer to a free-text CLASSIFIER than a regex target (see WORKOUT_FORMATS.md 9.1/9.2 for the structural formats this notation selects between)
- **Parser hint**: `split_type` and `switch_trigger` extraction (see WORKOUT_FORMATS.md Section 9); "each partner does half" implies a FIXED, even split (a distinct sub-case from fully free "split any way")
- **Worked examples**: `200 Wall Balls, split any way`, `Alternate every 10 Burpees`
- **Edge cases**: "each partner does half" assumes an EVEN split is even possible (fails for odd total rep counts without an explicit rounding rule — does the extra rep go to whoever finishes their half first, or is it simply dropped?) — a real, unresolved ambiguity in casual programming that the parser cannot resolve from text alone.

---

## 13. Missing Rep-Pattern Categories Identified (Summary)

1. **Sprint/HIIT named protocols** (Section 9) — entirely absent from the source v1.0 examples, which list only CrossFit-native schemes; real and increasingly common in hybrid-athlete programming.
2. **RPE and RIR notation** (Sections 4.3/4.4) — absent from the source's rep_patterns examples entirely, despite being extremely common in CompTrain/HWPO/PRVN-style strength-focused programming.
3. **The reversed-order sets×reps ambiguity** (5.2) — a real, documented parser risk not flagged anywhere in the source architecture.
4. **The loading-pyramid vs. rep-count-pyramid collision** (3.4) — arguably the single highest-consequence ambiguity in this entire document, entirely unaddressed in the source.
5. **Wave notation** (5.4) — connects to WORKOUT_FORMATS.md's Wave Ladder gap; the source rep_patterns examples don't address multi-wave numeric notation at all.
6. **A named-protocol reference table need** (Section 9's Parser hint) — the same architectural gap identified for named workouts generally (BENCHMARK_WORKOUTS.md, HERO_WORKOUTS.md) applies equally to named interval protocols, which the source schema has no table for at all.
7. **Unit-preservation requirement** (10.2) — the source schema doesn't specify whether load is stored in a canonical unit or the source unit; this document takes the position (elaborated in FCKB_ARCHITECTURE_REVIEW.md) that source-unit preservation is required, not optional.

Total distinct notation patterns cataloged: **27** (counted directly: Section 1: 2, Section 2: 2, Section 3: 4, Section 4: 4, Section 5: 4, Section 6: 4, Section 7: 1, Section 8: 1, Section 9: 1 combined entry covering 3 named protocols — not given full individual templates since their defining content is "resolve this name against a reference table," not a distinct regex shape each, Section 10: 2, Section 11: 1, Section 12: 1). This is a count of pattern TYPES with parser rules, not an exhaustive enumeration of every specific numeric sequence ever used (e.g. "21-15-9", "50-40-30-20-10", and "9-7-5" are three DATABASE ROWS but one pattern TYPE — Section 1.1 — in this document's own organization). A real implementation's `rep_patterns` table would hold many more rows than this document has pattern types, consistent with the source architecture's 80–100-row target; enumerating every specific sequence as its own "pattern" here would not be a meaningful completeness measure, since the space of possible integer sequences is unbounded (see FCKB_ARCHITECTURE_REVIEW.md for the case that `rep_patterns.regex_pattern` should generate matches against a pattern type, not enumerate specific instances as rows).
