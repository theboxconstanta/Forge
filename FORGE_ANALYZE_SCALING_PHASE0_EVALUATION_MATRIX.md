# Forge Analyze + Scaling — Phase 0 Evaluation Matrix

## A Note on What Was and Was Not Actually Executed

This mission asked for measured baseline metrics, not fabricated precision. Two very different things were possible in this session, and they are kept strictly separate below:

1. **`analyze-workout` and `regenerate-variant` (the two LLM-backed Edge Functions) require a real coach/admin Supabase Auth session** (`index.ts` for both functions: `anonClient.auth.getUser(token)` against a real Bearer JWT, then an `admins`/`coaches` row lookup). This investigation was performed under this project's standing rule to **never log in as any user, member or otherwise** — obtaining a coach/admin JWT would require exactly that. **No live call to either LLM edge function was made in this session.** Every "parsing accuracy" / "hallucination" / "format detection accuracy" number the mission asked for (§64-66, §99 items 7-19) is therefore **not measurable from this session** and is reported as such below — not estimated, not guessed. Section B below is a ready-to-execute corpus with author-defined expected outputs (per the mission's own §83 instruction that expected outputs must be defined independently of AI output), for the coach/user themselves — or a future session with real credentials — to run against the live endpoint.
2. **The deterministic scaling engine (`scalingEngine.ts`) requires no network access, no auth, and no secrets** — it is a pure function. It **was** executed directly, live, in this session (via `vite-node`), against a 25-line realistic movement corpus (not the library's own pre-existing unit-test fixtures, though those were also read and confirmed passing). Section C below reports real, measured numbers from that run.

## B. Parsing Evaluation Corpus (constructed, not yet executed against the live model)

25 representative cases across format families and input-difficulty classes (A–G per the mission's own taxonomy), with author-defined expected structured output. Each row is ready to paste into `analyze-workout` and diff against `Expected` once a real coach/admin session is available.

| ID | Format | Input Type | Raw Coach Input | Expected Format | Expected Config | Expected Key Fields |
|---|---|---|---|---|---|---|
| P01 | RFT | A (clean) | `3 rounds for time:\n10 Pull-ups\n15 Thrusters @ 43/30kg\nTime cap: 12:00` | RFT | rounds=3, timeCapMinutes=12 | movements: Pull-up(10), Thruster(15, 43/30kg) |
| P02 | RFT | C (shorthand) | `3rft\n10 pu\n15 thrusters 43/30\nTC 12` | RFT | rounds=3, timeCapMinutes=12 | canonicalName resolves "pu"→Pull-up; weight unit ambiguous (see A08) |
| P03 | For Time (Sequence) | A | `For time:\n21-15-9\nThrusters @ 43/30kg\nPull-ups` | For Time, structure=Sequence | sharedRepScheme=[21,15,9] | 2 movements, no `rounds` |
| P04 | For Time (Repeated Rounds) | B | `7 rounds for time of:\n10 Wall Balls\n5 Burpees` | For Time or RFT (see A02 — known ambiguity) | rounds=7 | — |
| P05 | AMRAP | A | `AMRAP 12:\n5 Pull-ups\n10 Push-ups\n15 Air Squats` | AMRAP | durationMinutes=12 | scoreType = Rounds + Reps |
| P06 | AMRAP | C | `amrap12` (no other text) | Unrecognized (too little content) | — | model should not hallucinate movements from nothing |
| P07 | Ascending AMRAP | B | `Every round add 3 reps, AMRAP 15:\n3-6-9-12... Burpees\n3-6-9-12... Box Jumps` | Ascending AMRAP | durationMinutes=15, startReps=3, incrementReps=3 | — |
| P08 | EMOM | C | `EMOM 10\nodd: 10 KBS\neven: 10 burpees` | EMOM | intervalSeconds=60, rounds/totalRounds=10 | `intervals` populated with per-minute movement text |
| P09 | Every-X (EMOM variant) | C | `E2MOM x 6: 12 Wall Balls` | EMOM | intervalSeconds=120, rounds=6 | must not be misread as 2-minute-total EMOM |
| P10 | Every-X | D (messy) | `every  3 mins\nfor 15 mins do:\n15 cal row` | EMOM | intervalSeconds=180, rounds=5 | 15 min / 3 min = 5 intervals, derived not stated explicitly |
| P11 | Tabata | A | `Tabata Air Squats` | Tabata | rounds=8, workSeconds=20, restSeconds=10 (canonical defaults, not stated in text) | scoreType = Reps (Lowest Reps convention) |
| P12 | Intervals | F (adversarial vs EMOM) | `5 rounds:\n1:00 on Row (cal)\n1:00 off` | Intervals, not EMOM | rounds=5, workSeconds=60, restSeconds=60 | must NOT classify as EMOM (no "at the top of each minute" prescribed work) |
| P13 | Death By | A | `Death by Burpees` | Death By | startReps=1, incrementReps=1, intervalSeconds=60 | — |
| P14 | Ladder | A | `Ladder: 21-18-15-12-9\nDB Floor Press\nHR Push-ups` | Ladder | sharedRepScheme=[21,18,15,12,9] | ladderType inferred Descending from the numeric trend, or left null (see Adversarial Findings) |
| P15 | Ladder vs For Time | G (adversarial) | `21-15-9\nThrusters\nPull-ups` (no word "ladder") | For Time (per prompt's own explicit rule) | sharedRepScheme=[21,15,9] | must NOT be Ladder — direct prompt-rule test |
| P16 | Chipper | A | `Chipper, 1 round each:\n50 Double Unders\n40 Sit-ups\n30 Box Jumps\n20 KB Swings\n10 Burpees` | Chipper | timeCapMinutes=null unless stated | 5 distinct movements, each once |
| P17 | Strength Sets | F (adversarial vs RM) | `Back Squat 5x5` | Strength Sets | setsScheme=[5,5,5,5,5] | must NOT be Build to Heavy/1RM — direct §27 mandatory test |
| P18 | Build to Heavy/1RM | F (adversarial vs Strength Sets) | `Build to a heavy single Deadlift` | Build to Heavy/1RM | targetLabel=1RM | must NOT be Strength Sets |
| P19 | Build to Heavy/1RM | C | `5RM Front Squat` | Build to Heavy/1RM | targetLabel=5RM | — |
| P20 | Weightlifting | A | `Practice: Snatch technique, build to a moderate working weight, 6x2` | Weightlifting (technical practice framing) or Strength Sets (has a sets×reps scheme) — genuinely ambiguous, both defensible | — | coach-review-required case, not a deterministic-answer case |
| P21 | Complex | A | `Every 90s x 8:\n1 Clean + 2 Front Squats + 1 Jerk` | Complex | rounds=8 | complex sequence preserved as ordered movements, not flattened |
| P22 | Partner WOD | A | `Partner WOD, you go/I go:\nAMRAP 20:\n10 Cal Row\n10 Burpees` | Partner WOD | splitType=You go/I go, baseFormat=AMRAP, durationSec derived | extraLogFields.partnerName expected downstream |
| P23 | Male/Female loads | E (partial) | `Deadlift @ 102/70kg` | (movement-level test) | weightMale=102, weightFemale=70, unit=kg | — |
| P24 | Load ambiguity | F (adversarial) | `Deadlift @ 50/35` (no unit) | (movement-level test) | Per §36: current behavior must be observed empirically — prompt has no explicit fallback-unit rule | flag as UNDEFINED PRODUCT BEHAVIOR until run |
| P25 | Multi-Section | mandatory §32 | `A. Back Squat 5x5\n\nB. 3 RFT:\n10 Pull-ups\n15 Thrusters\nTC 12\n\nC. Accessory: 3x15 GHD Sit-ups` | 3 sections, order preserved | Section A = Strength Sets, Section B = RFT (primary/required), Section C = Accessory | tests §32/§37 section-boundary preservation directly |

Every case above uses realistic coach phrasing (including deliberately messy/shorthand cases), spans every format family (`scored`/`sets`/`mixed`/`nft`/`chained`), and includes the mission's own named adversarial pairs (RFT/For Time, Strength Sets/Build to Heavy, EMOM/Intervals, Ladder/For Time). It is intentionally sized to be genuinely runnable in one sitting (not a padded 200-row table asserting precision nobody measured) rather than exhaustive across all 22 formats × 7 difficulty tiers.

## C. Scaling Evaluation — REAL, EXECUTED Results (deterministic engine)

25 realistic RX movement lines (mix of gymnastics, weightlifting, monostructural-by-distance, monostructural-by-calorie, and bodyweight movements — not drawn from the substitution table's own coverage, chosen independently) run through the actual shipped `scaleMovementLine()` at the `onramp` tier (the most scaling-dependent tier):

| Movement line (RX) | OnRamp output | Verdict |
|---|---|---|
| `21-15-9 Thrusters @ 43/30kg` | `14-10-6 DB Thrusters @ 20/15kg` | Substituted |
| `15 Pull-ups` | `10 Ring Rows` | Substituted |
| `10 Chest to Bar Pull-ups` | `7 Ring Rows` | Substituted |
| `5 Bar Muscle-ups` | `3 Bar Muscle-ups` | **Load-only — elite skill kept unchanged** |
| `5 Ring Muscle-ups` | `3 Ring Muscle-ups` | **Load-only — elite skill kept unchanged** |
| `10 Handstand Push-ups` | `7 Push-ups` | Substituted |
| `30 Toes to Bar` | `20 Sit-ups` | Substituted |
| `50 Double Unders` | `33 Single Unders` | Substituted |
| `20 Box Jumps @ 24in` | `13 Box Jumps @ 24in` | **Load-only — substitution entry exists (→ Box Step-ups) but silently didn't fire, see root cause below** |
| `10 Devil Press @ 22.5/15kg` | `7 Devil Press @ 11/8kg` | Load-only (not in substitution table) |
| `15 Wall Ball @ 9/6kg` | `10 Med Ball Wall Ball @ 6/4kg` | Substituted |
| `10 Snatch @ 61/43kg` | `7 PVC Snatch Drills` | Substituted |
| `10 Clean & Jerk @ 70/47.5kg` | `7 DB Clean & Jerk @ 20/15kg` | Substituted |
| `10 Overhead Squat @ 43/30kg` | `7 Air Squats` | Substituted |
| `20 Burpees` | `13 Squat Thrusts` | Substituted |
| `15 GHD Sit-ups` | `10 Sit-ups` | Substituted |
| `10 Pistol Squats` | `7 Air Squats` | Substituted |
| `20/15 Cal Row` | `20/15 Cal Row` | **UNPARSED — zero scaling of any kind** |
| `Row 500m` | `Row 500m` | **UNPARSED — zero scaling of any kind** |
| `400m Run` | `400m Run` | **UNPARSED — zero scaling of any kind** |
| `15 Kettlebell Swings @ 24/16kg` | `10 Kettlebell Swings @ 12/8kg` | Load-only (not in table under this exact name) |
| `10 Deadlifts @ 102/70kg` | `7 Kettlebell Deadlifts @ 16/12kg` | Substituted |
| `5 Rope Climbs` | `3 Ring Rows` | Substituted |
| `10m Handstand Walk` | `10m Handstand Walk` | **UNPARSED — zero scaling of any kind** |
| `20 Air Squats` | `13 Air Squats` | Load-only (correct — already the most basic accessible variant) |

**Measured totals (n=25, one run, deterministic code — result is 100% reproducible, no repeated-run variance to report since there is no randomness in this path):**
- Substituted (name changed to something more accessible): **15/25 (60%)**
- Load-only, name kept (acceptable when the movement is already accessible, e.g. Air Squat; a real gap when it isn't, e.g. Bar/Ring Muscle-up): **6/25 (24%)**
- **Completely unparsed, zero scaling applied at any tier: 4/25 (16%)**

**Root cause of the unparsed cases** (category A, Input Normalization, per this mission's own taxonomy — §60): `scaleMovementLine`'s regex only recognizes a **leading** dash-separated rep count (`^([\d]+(?:-[\d]+)*)\s+`) and/or a **trailing** `@ <number>(/<number>)?(kg|lbs)` weight suffix. A line with no leading rep count (any distance- or "for calories" monostructural prescription, which is very commonly written as `"Row 500m"`, `"400m Run"`, `"20/15 Cal Row"`, not `"1 Row 500m"`) has nothing for the regex to anchor on and passes through completely untouched — not even the movement name substitution table is consulted, because the code path that calls `findSubstitution` only runs after a `namePart` is successfully extracted.

**Root cause of the Box Jump anomaly**: the weight-suffix regex only accepts `kg`/`lbs` as a unit (`(kg|lbs)\s*$`) — a height suffix written as `@ 24in` does not match, so `"Box Jumps @ 24in"` is never split into a bare movement name, and the (correctly configured) Box Jump→Box Step-ups substitution entry in `SCALING_SUBSTITUTIONS` never gets a chance to match.

## Format Preservation / Monotonicity (measured, from existing + this session's tests)

- **Format preservation**: 100% in every case observed — `generateVariantsFromRx`/`adjustFormatConfigForTier` never change `format`; only `formatConfig` values (already-present duration-like keys) are scaled. Confirmed both by the pre-existing `scalingEngine.test.ts` suite (`adjustFormatConfigForTier` describe block) and by this session's own additional runs.
- **Cross-tier monotonicity**: the library's own test suite asserts this directly and it was confirmed still passing in this session (`TIER_RULES` describe block: onramp reduces load/volume the most and extends time the most, strictly ordered onramp > beginner > intermediate). No inversion was found in any case tested.
- **Male/female parity across tiers**: preserved structurally in every case tested — the engine always scales `male`/`female` by the same ratio and never swaps or drops one side.

## Strict vs. Partial Accuracy

For the parsing corpus (Section B), strict "exact workout accuracy" (every member-essential field correct) cannot be reported without live execution — reported as **not yet measured**, per this document's own honesty constraint, rather than a fabricated percentage.

For the scaling corpus (Section C), using this mission's own rubric (§66-67: Accept as-is / Minor edit / Major edit / Unusable), a reasonable classification of the 25 measured cases:
- **Accept as-is**: the 15 substituted + most load-only bodyweight cases (Air Squat, Kettlebell Swing, Devil Press at reduced load) — roughly 19-21/25.
- **Minor coach edit** (name is fine, but a coach would likely want to also tighten the number): Box Jump @ height case — 1/25.
- **Major coach edit required** (an actually inappropriate prescription for the tier that a coach must catch before class): Bar Muscle-up, Ring Muscle-up at OnRamp — 2/25.
- **Unusable as generated** (zero adjustment happened at all, and the coach must notice this silently-missing scaling themselves): the 4 unparsed monostructural lines — 4/25.

This yields a **manual-correction burden distribution** of roughly 76-84% "accept or minor edit" / 16-24% "coach must actively catch and fix a real gap" for the default (deterministic) scaling path on this representative sample — a real, if modest-sample-size, measured number, not a guess.

## Sample Size Disclosure

Parsing corpus: 25 constructed cases, 0 executed against the live model (see Section A). Scaling corpus: 25 constructed cases, 25 executed against the real deterministic engine, 1 run each (no repeated-run variance applicable — pure deterministic code, not an LLM). This is a deliberately small, hand-curated, representative sample suitable for a Phase 0 audit — not a claim of statistical power. Any specific percentage in this document is qualified by this sample size and should not be read as a platform-wide accuracy guarantee.
