# Member Performance — Competitive Research

**Status: Research only. No code, schema, or production data changed.**

## Methodology

Six products researched via official documentation, help centers, and marketing pages where available (cited per claim); secondary sources (reviews, comparison sites) used only where official docs were unavailable, and explicitly flagged as such. Findings are marked CONFIRMED / PARTIAL / NOT FOUND per capability — no capability is claimed without evidence. This research is scoped specifically to **member performance/progress/PR features**, distinct from the live-scoring/ranking research already completed in [[project_scoring_competitive_landscape]] (Aug 14), which this document does not repeat.

---

## btwb (Beyond the Whiteboard)

Researched most deeply, as the closest competitor to Forge's own CrossFit-affiliate focus.

- **PR detection**: CONFIRMED, automatic. **Maxes** feature compiles All-Time and Current (trailing-12-month) bests per lift/gymnastics/monostructural effort, each shown with a percentile "level" (e.g. level 92 = better than 92% of all btwb results for that effort).
- **Movement/benchmark history**: CONFIRMED — a per-workout History tab shows a graph plus chronological result list, kept **separate for Rx'd vs. Modified**.
- **Repeat-workout comparison**: CONFIRMED conceptually (progress graph per workout, all historical posts listed) — no confirmed explicit "+25 sec faster" delta callout.
- **Rep-max distinction**: PARTIAL — Maxes tracks distinct lift efforts and a "Lifts Calculator" exists, but the exact formula/whether 1RM/3RM/5RM are separate stored slots vs. one derived estimate could not be confirmed.
- **Charts**: named, single-purpose tools — Fitness Level (composite), Maxes (best-ever/current-year), Imbalances (relative category weakness), Training Days (consistency), Programming Analysis (coach/gym-level).
- **Consistency**: CONFIRMED — "Training Days" + a gym-level "Committed Club" (12+ logged days/month, every month of the year).
- **Volume**: CONFIRMED, scoped **per-movement** ("Movement Volume: reps, load, distance for every movement performed") — never cross-modal tonnage.
- **Rx/scaled**: CONFIRMED kept separate — "only Rx'd scores contribute to the Metcon categories"; btwb explicitly states "there is no acceptable method for comparing differently scaled workouts."
- **Composite score**: CONFIRMED — **Fitness Level**, 1–100, averaging 8 domain categories, each needing 2 results to unlock, valid 1 year. No third-party criticism found either way.
- **Coach view**: CONFIRMED — Admin Console → Members → Performance: PR Board (new PRs this month, filterable), Fitness Levels list, Lifts & Intervals list.

**Most valuable idea for Forge**: the Maxes percentile-level framing, and the explicit "no acceptable method yet" honesty about not comparing scaled variants — a design ethic (don't fabricate false-equivalence comparisons) directly aligned with Forge's own Rx/Scaled separation.

## SugarWOD

- **PR detection**: CONFIRMED, automatic, across lifts/benchmarks/gymnastics. Dedicated "Workout PRs"/"Barbell PRs" sections (secondary source for exact IA).
- **Benchmark history**: CONFIRMED — named + Gym/Custom Benchmarks "catalogued separately... automatic PR calculation and history of progress."
- **Rep-max tracking**: CONFIRMED distinct — "Percentage Charts... for every lift, 1, 2, 3 and 5RM attempts," automatically computed. Formula not disclosed.
- **Volume**: NOT FOUND as a cross-workout metric — SugarWOD's own "metrics to track" content frames itself around attendance/benchmark repeats/recovery/skills, not tonnage.
- **Rx/scaled**: CONFIRMED separate — logging requires selecting Rx or Scaled; coaches advised to log variations as distinct entries "to maintain distinct records."
- **Composite score**: NOT FOUND.
- **Coach view**: CONFIRMED at a high level (engagement/attendance-pattern tooling), not a documented per-athlete performance-history screen equivalent to btwb's PR Board.

**Most valuable idea for Forge**: the 1/2/3/5RM percentage chart "done automatically for every lift" — a clean, low-effort strength feature.

## Wodify (Performance module)

- **PR detection**: CONFIRMED automatic, with the most rigorous **publicly documented rule logic** of any product researched: (1) heaviest weight ever for that exercise, (2) most weight at a given rep count *unless* more weight was moved at higher reps, (3) volume-based — more sets completed at the same weight/reps than before. Weightlifting Total PR = highest total.
- **Movement history**: CONFIRMED — a per-component line-graph view (Coach View) shows "Results from previous Workouts as well as any 1-Rep Maxes."
- **Rep-max tracking**: CONFIRMED, with a **named formula** — estimated 1RM via **Brzycki**, shown only when no actual 1RM is on file, input capped at ≤10 reps (Wodify's own documented accuracy-decline reasoning above that).
- **Volume**: CONFIRMED, scoped per-exercise/component (same sound scoping as btwb) — never cross-workout tonnage.
- **Rx/scaled**: PARTIAL — a per-result Scaled flag exists; exclusion from PR calculation not explicitly confirmed (unlike btwb/SugarWOD).
- **Member IA**: CONFIRMED — a dedicated **"My Performance" tab** exists in the client app.
- **Coach view**: CONFIRMED and rich — Coach View (mobile) + Coachboard live PR gold badges during class.

**Most valuable idea for Forge**: the explicit, named, three-rule weightlifting PR logic — the most rigorous and directly portable PR-detection spec researched.

## PushPress Train

- **PR detection**: PARTIAL — logged score compared against prior history, celebrated ("PR Confetti"); no distinct automatic-detection algorithm documented beyond "beats prior best."
- **Movement history**: CONFIRMED — history icon on the workout/benchmark card surfaces prior results in-context (5 most recent by default, search for older); benchmark categories include Weightlifting 1/2/3/5RM, Girl, Hero, Endurance, Qualifiers, Tributes, Log Your Own (gym-customizable).
- **Estimated max**: NOT FOUND.
- **Volume**: NOT FOUND.
- **Coach analytics**: PARTIAL — marketing references trend visibility for programming decisions, no specific dashboard documented.

**Most valuable idea for Forge**: the lightweight "history icon directly on the workout/benchmark card at logging time" pattern — lower-friction than requiring navigation to a separate analytics section.

## TrainHeroic

- **PR detection**: CONFIRMED automatic, with graphed PR progress.
- **Movement history**: CONFIRMED — full logged-value history per lift, including when/how the working max was last updated.
- **Estimated max**: CONFIRMED, via the **NSCA Training Load Chart** (submax-to-1RM table method) from the best set of ≤15 reps. Critically: once a max is manually "tested" or updated, TrainHeroic **stops auto-adjusting it** until the next explicit test or manual update — an explicit tested-vs-estimated state machine.
- **Volume**: CONFIRMED — cumulative total volume/reps/hours trained (gamified via a "Millionaire's Club" for 1M+ lbs lifetime) — athlete-level cumulative, not a strict per-session tonnage chart.
- **Coach analytics**: CONFIRMED — a **Compliance** report (sessions completed vs. prescribed, block-level), Readiness Survey visibility, per-athlete 1:1 calendar with comments/DM.
- **Readiness/wellness**: CONFIRMED — a distinct 5-question Readiness Survey (sleep/mood/energy/stress/soreness), co-developed with the Air Force Research Lab, kept **separate** from performance logging.

**Most valuable idea for Forge**: the tested-vs-estimated max state machine — directly relevant since Forge's own gyms mix benchmark-testing days with ordinary daily lifting, and conflating an estimate with a tested PR would be a real correctness risk.

## TeamBuildr

- **PR/max tracking**: CONFIRMED — relational max-linking (e.g. Front Squat pegged to 85% of Back Squat, auto-updating), plus a built-in submax-to-1RM estimation formula (not named).
- **Movement history**: CONFIRMED — Progress Report graphs per-exercise progress; **Max Report compares an athlete's maxes against the group/team average** — the only product researched with this team-comparative framing (not appropriate for Forge's individual-member context, noted for completeness only).
- **Testing/assessment**: CONFIRMED, and TeamBuildr's most distinctive concept — a formally named **"Evaluations"** module: coaches build custom test protocols (lifts, runs, speed/agility, circuits, bodyweight), run scheduled combine-style testing days, results feed the longitudinal Reporting module as an explicitly distinct data type from ordinary logged sets.
- **Readiness**: CONFIRMED — a separate Questionnaire Report with color-coded thresholds; an optional paid Athlete Monitoring System add-on correlates pain/soreness against training load.
- **Velocity-Based Training**: CONFIRMED present (hardware-dependent, e.g. GymAware Flex integration, ~0.35 m/s auto-regulation threshold) — explicitly flagged here as a strength-and-conditioning/team-sport-specific capability **not appropriate to replicate** for a general CrossFit-gym audience without dedicated hardware.
- **Member-facing UI**: weaker than TrainHeroic's — TeamBuildr's public materials skew coach/dashboard-first (team/S&C-department origin, not individual-consumer design).

**Most valuable idea for Forge**: the named, separate "Evaluations" (testing) concept — a distinct data type from day-to-day logging, tied to scheduled test events — maps cleanly onto CrossFit gyms' existing culture of periodic benchmark/1RM testing days, and answers "was this actually tested vs. inferred" cleanly.

## Bonus: Hevy / Strong (general fitness-tracking apps)

Included because CrossFit-gym members increasingly compare any in-house PR/history UX against consumer strength apps they already use, and both are widely cited as best-in-class for exactly the "one specific lift over time" experience Forge is designing.

- **Hevy**: automatic PR detection with in-session celebration; a Complete Exercise History view per movement; an **e1RM that auto-updates from logged sets with a trend line, explicitly labeled as an estimate** (not a tested max); volume charts, training-frequency heatmap. (Secondary-source caveat on the granular chart list — no official help-center docs indexed.)
- **Strong**: praised for best-in-class strength-logging UX; per-exercise all-time-best history over months; deliberately no social feed/gamification (contrast with Hevy).

**Why instructive**: the most consistent pattern across both is a **per-exercise page as the organizing unit** — pick a movement, see every historical instance, an estimated-1RM trend line clearly labeled as an estimate, and a volume chart, all in one place. Arguably the cleanest mental model for "movement history" of anything researched, including the two purpose-built CrossFit platforms.

---

## Competitor Feature Matrix

| Capability | Forge (pre-existing infra, see Current-State Audit) | btwb | SugarWOD | Wodify | PushPress Train | TrainHeroic | TeamBuildr |
|---|---|---|---|---|---|---|---|
| Automatic PR detection | CONFIRMED (built, not yet firing in production — see audit) | CONFIRMED | CONFIRMED | CONFIRMED (named rules) | PARTIAL | CONFIRMED | CONFIRMED |
| Movement/lift history | CONFIRMED (view exists) | CONFIRMED | PARTIAL | CONFIRMED | CONFIRMED | CONFIRMED | CONFIRMED |
| Benchmark history | CONFIRMED (Benchmark Identity live) | CONFIRMED | CONFIRMED | CONFIRMED | CONFIRMED | — | — |
| Repeat-workout comparison | CONFIRMED (Performance Identity, incl. non-benchmark) | CONFIRMED | CONFIRMED | PARTIAL | — | — | — |
| Rep-max (1/3/5RM) identity | PARTIAL (not keyed in live PR detection — see audit) | PARTIAL | CONFIRMED | CONFIRMED | CONFIRMED | — | — |
| Estimated max, explicitly labeled | NOT BUILT | PARTIAL | NOT FOUND (formula) | CONFIRMED (Brzycki) | NOT FOUND | CONFIRMED (NSCA table, tested/estimated state machine) | CONFIRMED |
| Volume tracking (per-movement, sound scoping) | NOT BUILT | CONFIRMED | NOT FOUND | CONFIRMED | NOT FOUND | CONFIRMED (cumulative) | CONFIRMED |
| Consistency/frequency | NOT BUILT (Attendance domain separate) | CONFIRMED | PARTIAL | NOT FOUND | — | — | — |
| Rx/scaled separation in history | CONFIRMED (frozen invariant) | CONFIRMED | CONFIRMED | PARTIAL | — | — | — |
| Composite fitness score | NOT BUILT, not recommended (see below) | CONFIRMED | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND |
| Coach-facing member performance view | CONFIRMED (`AthletePerformanceOverview`) | CONFIRMED | PARTIAL | CONFIRMED | PARTIAL | CONFIRMED | CONFIRMED (strongest) |
| Named "testing"/"evaluation" event type | NOT BUILT | — | — | — | — | PARTIAL | CONFIRMED (strongest) |
| Readiness/wellness surveys | NOT BUILT, out of scope | — | — | — | — | CONFIRMED | CONFIRMED |
| Velocity-based training | NOT BUILT, not recommended | — | — | — | — | — | CONFIRMED (hardware-dependent) |

---

## Adopt / Improve / Diverge / Defer / Reject

| Capability | Recommendation | Why |
|---|---|---|
| Automatic PR detection at logging time | **ADOPT** — already built (Slice 3), needs the production-firing gap closed (see audit), not new architecture | Universal across every competitor researched; table stakes |
| Movement history as a per-movement organizing page | **ADOPT**, informed by Hevy/Strong's cleanest execution | Already has data support via `performance_identities`/Signature V1 + `movement_progress_summary` |
| Benchmark history with automatic cross-date recognition | **ADOPT** — already live (`resolve_benchmark_names`, Benchmark Identity) | Matches btwb/SugarWOD/Wodify; Forge's version is more general (Performance Identity also covers non-official repeated workouts, which none of the 6 researched competitors documented doing) |
| Rx/Scaled kept separate in all history/PR views | **ADOPT** — already a frozen invariant | Universal across every competitor with documented behavior on this |
| Wodify's 3-rule weightlifting PR logic | **IMPROVE** — adapt into Forge's existing `evaluate_movement_prs`, which currently lacks a documented, named rule set of this clarity | Most rigorous PR spec found; directly portable |
| TrainHeroic's tested-vs-estimated max state machine | **IMPROVE** — apply if/when Forge ever adds estimated-1RM (deferred, see below) | Prevents silently conflating an estimate with a real PR |
| Per-movement volume tracking (sound scoping) | **DEFER** — real competitor pattern, but Forge has zero volume infrastructure today; not V1 | Every competitor scopes it per-movement (never cross-modal), which Forge should also do if built — but this is new work, not a gap-closure |
| btwb's Fitness Level composite score | **REJECT for V1**, revisit only with strong evidence | Only one of 6 competitors has this; no third-party validation found either way; directly conflicts with the mission's own default position and Forge's own Rx/Scaled-never-pooled invariant (a cross-modal single number inherently blends incomparable data) |
| TeamBuildr's Evaluations (named testing events) | **DEFER** | Real, well-designed concept, but a genuinely new data model (scheduled test event distinct from ordinary logging) — not V1-scope |
| TrainHeroic/TeamBuildr Readiness surveys | **DEFER**, arguably out of Performance's own domain boundary entirely | Wellness/readiness is a distinct concern from athletic performance history; would need its own domain decision, not smuggled into Performance V1 |
| TeamBuildr Velocity-Based Training | **REJECT** | Requires dedicated hardware (linear position transducers), designed for team/S&C departments, not a general CrossFit-gym membership audience |
| btwb's Imbalances (category-relative weakness) | **DEFER** | Interesting, but requires a "training domain" taxonomy Forge doesn't have and the mission itself (§29) asks to evaluate skeptically before adopting |
| Team/group-average comparison (TeamBuildr's Max Report) | **REJECT** for member-facing Performance | Wrong audience fit — Forge's Performance is individual-member-facing; a gym-wide equivalent already exists separately (Dashboard 2.0's Performance Command Center) |

## Forge's Real Differentiation Opportunity

None of the six products researched combine: (1) automatic Rx/Not-Rx validation against the actual prescribed load (confirmed absent in all 6 in the prior scoring-competitive research), (2) a **generalized Performance Identity** that recognizes repeated custom (non-official-benchmark) workouts automatically via structural signature — every competitor's "repeat comparison" appears scoped to named benchmarks/lifts only, not arbitrary gym-programmed WODs, and (3) AI-authored programming that already produces the structured data (format + format_config + movement text) Performance Identity resolution consumes, with zero manual coach categorization required. This is a real, evidenced, three-part differentiation opportunity — not aspirational marketing language — since items (1) and (2) are already shipped, live infrastructure (see Current-State Audit), not proposals.
