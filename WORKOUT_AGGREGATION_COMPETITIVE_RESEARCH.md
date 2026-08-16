# Workout Aggregation — Competitive Research

**Status:** Research only. No code, schema, or product decisions made here — this document is the evidence base `WORKOUT_AGGREGATION_ARCHITECTURE.md` cites throughout. Companion to `SCORING_COMPETITIVE_LANDSCAPE.md` (2026-08-14), which covered ordinary single-workout scoring exhaustively; this document deliberately does **not** re-research For Time/AMRAP/Rx-Scaled/basic tie-breaks — it is scoped narrowly to **aggregation mechanics**: how and whether platforms combine two or more independently-scored parts/events into one overall result or standing.

**Research date:** 2026-08-16. Two parallel research passes, run as background agents: (1) primary-source official rules (CrossFit Games Rulebook, IWF Technical and Competition Rules & Regulations); (2) competition/gym software documentation (Competition Corner, Wodify, PushPress Train, btwb, SugarWOD, plus adjacent platforms found during research — HYROX, WODcast, WodProof).

Every claim is tagged: **OBSERVED FACT** (directly stated in a primary/official source, cited), **INFERENCE** (reasoned from observed facts, not itself stated), **ANECDOTAL** (community/secondary, not official), or **UNKNOWN / NOT PUBLICLY DOCUMENTED** (looked, could not verify — not converted into an absence claim).

---

## 1. CrossFit Games / CrossFit Open — Official Rules

**Primary source:** 2024 CrossFit Games Competition Rulebook V6 (official PDF, text-extracted verbatim and directly re-read this session). Corroborated as still structurally current for the 2026 season via targeted web search (no rule-numbering or mechanism change found).

### 1.1 Overall standing across multiple weekly workouts

**OBSERVED FACT**, §1.24 ("CrossFit Games Leaderboard – Ranking"), direct quote:

> "During the Open, athletes are ranked on the leaderboard based on their total placement in all workouts. For example, an athlete with 2nd-place, 3rd-place and 5th-place finishes will have 10 total points (2+3+5=10) and be ranked ahead of an athlete with 1st-place, 2nd-place and 10th-place finishes, who would have 13 points (1+2+10=13)."

Mechanism: **sum of per-workout ordinal placement, lowest total wins** — a pure placement-sum ("golf scoring"), not a points table. The rulebook's own structure repeats a parallel scoring-format section at Quarterfinals (§2.07) and other stages, suggesting the same mechanism recurs at multiple competition tiers, though this document did not independently re-verify every stage's exact wording.

### 1.2 Tie-break for overall/cumulative standing

**OBSERVED FACT**, §1.24, direct quote:

> "Ties on the overall leaderboard will be broken by awarding the best position to the athlete who has the highest result in any single workout. If athletes remain tied after this first tiebreaker, the process continues to their next-highest single result, and so forth. Ties will not be broken for single workout results. More than one athlete can share a workout rank, and each will earn the original point value."

A cascading "best single result, then next-best" comparison — distinct from, and not to be confused with, any individual workout's own tiebreak (an aggregate-level tiebreak is a genuinely separate mechanism, §27 of the architecture document). Falls back further at a lower tier: §1.26, **OBSERVED FACT**: unresolved ties are broken by each athlete's overall worldwide ranking.

### 1.3 Missing/invalidated score — effect on overall standing

**OBSERVED FACT**, §1.25 (and identically at §1.28 for age-group athletes), direct quote:

> "if a registered athlete fails to submit a score for any reason (e.g., skips a workout, has a workout invalidated, cannot complete the stated minimum score, or cannot complete a single repetition), that athlete will receive a score of '0' for that workout and will be ranked below all athletes who post a score... Athletes receiving a '0' score will maintain an overall rank on the CrossFit Games leaderboard."

No exclusion, no distinct "DNS" bucket in the rulebook's own vocabulary — skip, invalidation, and inability-to-complete-a-single-rep are all folded into one "0" outcome, which (because standing itself is a placement-sum, §1.1) mechanically becomes "worst placement for that event," never a raw zero summed into anything.

### 1.4 CrossFit Games (televised finals) event scoring

**OBSERVED FACT**, §1.16, direct quote:

> "Scoring details - Competitions may determine the winner by highest point total or lowest point total, or any method or combination of methods CrossFit selects. Point values for finishing position will be released before the start of the event."

CrossFit explicitly reserves discretion over both **direction** (high-wins vs. low-wins) and the **exact table**, publishing it per-event rather than committing to one fixed scheme in the rulebook itself. **UNKNOWN**: the exact numeric points table currently used at the televised finals could not be independently verified this session — the official results-explainer pages returned only JS-rendered stubs to direct fetch, and secondary sources found conflict with each other (one suggesting a 100-point-declining scale, another an unrelated and much larger legacy-ranking-system scale) — neither is trusted here. The *mechanism* (a declared, per-event, direction-flexible points table) is the load-bearing fact for architecture purposes, not any one specific historical table.

## 2. IWF Olympic Weightlifting — Official Rules

**Primary source:** IWF Technical and Competition Rules & Regulations, 2024-headered edition (mirror PDF, text-extracted verbatim, directly re-read this session). The current official Nov-2025 edition on iwf.sport could not be fetched (Cloudflare JS-challenge blocked every attempt) — findings below are confirmed against the 2024-headered text; flagged where the newer edition might differ and is unconfirmed.

### 2.1 Is Total a derived value or a formally scored result?

**OBSERVED FACT**, §6.8.1, direct quote:

> "The title of Champion is awarded for individual lifts in the Snatch, the Clean & Jerk and the Total (the aggregate of the best Snatch and the best Clean & Jerk results). The athletes who win first, second and third place in the two (2) lifts and in the Total at all IWF Events are awarded gold, silver and bronze medals, respectively."

Both at once: computed (best Snatch + best Clean & Jerk) **and** formally, officially medaled as its own result — a real, first-class competition outcome, not merely a display convenience.

### 2.2 No successful Clean & Jerk after a successful Snatch

**OBSERVED FACT**, §6.9, direct quote:

> "Athletes who have been successful in the Snatch but have no valid lifts in the Clean & Jerk receive points for the team classification according to the place obtained in the Snatch but will not receive points for the Total."

No Total is computed or awarded at all — not a zero, not a penalty value. The athlete keeps their standalone Snatch result and is not eliminated from the competition (unless the specific event medals Total only, in which case a *no-valid-Snatch* athlete specifically is eliminated before reaching Clean & Jerk — a narrower rule, also stated in §6.9, not the same as the no-C&J case). The specific label "No Total" appears to be conventional scoreboard usage (**ANECDOTAL** — plausible, not found verbatim in the primary rule text itself) describing this **OBSERVED FACT** mechanic.

### 2.3 Official tie-break for equal Totals

**OBSERVED FACT**, §6.8.2, direct quote:

> "1. best result – highest first; if identical, then: 2. best Clean & Jerk result's attempt number – the Athlete who achieved the Total result earliest according to the Calling Order... In the case of tie(s) in different group(s), the athlete(s) who competed earlier in time will be ranked higher regardless the attempt number."

**Not bodyweight.** The mechanism is earliest-achievement by attempt-calling-order/clock time. An older, superseded IWF edition (also checked this session) used a bodyweight-first cascade — confirming the commonly-repeated "lighter athlete wins ties" convention is **outdated folklore**, not the current rule. Whether the Nov-2025 edition preserves the calling-order rule unchanged is **UNKNOWN** (fetch blocked).

### 2.4 Other IWF aggregate concepts

**OBSERVED FACT**, brief: an "Entry Total" exists as a pre-competition seeding/validation aggregate (self-declared estimate, used for group allocation and a "first attempt must be within 20kg of Entry Total" rule) — a *seeding* aggregate, structurally distinct from the *results* Total. A separate IWF "Absolute World Ranking" qualification-points system is referenced in passing by secondary sources but was **not investigated** (out of this pass's scope — lives in IWF qualification policy, not the TCRR itself).

## 3. Competition Corner

**Source:** help.competitioncorner.net, official help-center articles (URLs preserved for traceability).

### 3.1 Point-per-place and configurable points tables

**OBSERVED FACT** — three overall-standing methods exist: "Point per Place" (1st=1pt…, lowest total wins), "Point Based System" (sliding scale, 1st=100, 2nd=95…, highest total wins, recommended ≤65 athletes/division), and "Cumulative Units" (§3.2). Points tables are configurable via CSV upload (`Rank`,`Points` columns), applied hierarchically — **Global → Division → Workout**, lowest level wins — with preloaded "industry-standard" tables also offered. [Setting up Scoring](https://help.competitioncorner.net/en/articles/1083276-setting-up-scoring); [Can I define my own custom point system?](https://help.competitioncorner.net/en/articles/1150312-can-i-define-my-own-custom-point-system).

**OBSERVED FACT**, a real constraint worth noting: the *scoring method* (rank/points/cumulative) is uniform across an entire event/division — only the *table*, not the *method*, varies per workout.

### 3.2 Cumulative Units — raw-unit aggregation across events

**OBSERVED FACT**: sums raw workout results directly (not points) across events into the overall standing, with an explicit stated requirement: **"all workouts MUST SHARE the same unit"** (all time-based, all rep-based, or all weight-based) — independently arrived-at confirmation of the exact same-metric-compatibility rule `WORKOUT_AGGREGATION_ARCHITECTURE.md` §9/§13 derives from first principles. Tiebreakers are explicitly **not supported** in this mode. Operates at the **cross-event** scope (whole separate competition events/days), not within one event's own sibling parts.

### 3.3 Weighted events

**OBSERVED FACT**: a "Use weighted scoring" toggle lets an organizer set a per-workout percentage weight (default 100%, e.g. a final set to 200%, or a two-part workout split 50/50).

### 3.4 Missing/DNF/DNS/WD handling

**OBSERVED FACT**, three named states: **DNF** (Did Not Finish) — scored 0, "remains in contention to be ranked... at a great disadvantage"; **CAP** (time-capped) — ranked below finishers by work completed; **WD** (Withdrawn) — pushed to the bottom, "out of contention to podium." **DNS specifically**: **UNKNOWN / NOT PUBLICLY DOCUMENTED** — no distinct treatment found separate from the above.

### 3.5 Single-event auto-sum of sibling parts

**UNKNOWN / NOT PUBLICLY DOCUMENTED — a genuine documentation gap.** No help-center page found describes defining one *event's own* score as the algebraic sum of two of that same event's own sibling parts (the weightlifting Snatch+C&J convention, applied generically). Cumulative Units (§3.2) is the closest documented mechanic, and it operates across whole separate events, not within one event's own parts — this is the specific capability `WORKOUT_AGGREGATION_ARCHITECTURE.md` proposes that appears undocumented even on the platform built specifically for competition scoring.

### 3.6 Multi-competition season series

**OBSERVED FACT**: a separate "Points Series Leaderboard" feature accumulates points across multiple *separate competitions*, each carrying its own independent point value; athletes below a configured cutoff position (e.g. 40th) receive no points for that event. Tie/missing-event handling for this specific feature: **UNKNOWN**.

### 3.7 Elimination-format scoring (adjacent, not aggregation per se)

**OBSERVED FACT**: multi-round eliminations rank by a composite key — highest round reached, then score within that round — eliminated athletes tiered below advancers. Noted as an adjacent mechanism, not itself a within-event aggregation pattern.

## 4. Wodify

**Sources:** help.wodify.com (partial — most articles returned HTTP 403 to direct fetch this session; findings below rely on search-engine snippets where the full article body was unreachable, explicitly flagged).

### 4.1 "Weightlifting Total" as a first-class component-scoring measure

**OBSERVED FACT (existence)**: Wodify's component-scoring measure list includes AMRAP variants, Calories, Checkmark, Distance, No Measure, Sets & Max Reps, Time, Weight, and **Weightlifting Total** as a named measure type; performance-tracking documentation additionally references a "Best Total" metric and states Weightlifting-Total PRs are "determined by most total weight." **UNKNOWN (internal mechanism)**: whether this measure auto-sums two separately-entered sub-lift values or is simply a single number the coach manually enters and labels "Total" could not be confirmed — full article text was unreachable (403). This is a real, meaningful gap: Wodify is the only platform researched with a *named* Total concept, but whether it computes the way `WORKOUT_AGGREGATION_ARCHITECTURE.md` proposes (derived from two already-scored sibling components) is unverified either way — not claimed as equivalent, not dismissed as different.

### 4.2 No other documented cross-Component auto-total

**UNKNOWN / NOT PUBLICLY DOCUMENTED**, beyond §4.1: no page found documents a general "sum Component 1 + Component 2 into an overall score" for ordinary (non-weightlifting) multi-part workouts. A since-migrated/404'd Wodify UserVoice feature request titled "competition scoring program" is weak **ANECDOTAL** evidence that, at the time it was filed, no such feature existed.

### 4.3 Wodify Arena

Wodify's dedicated competition-management product: **ANECDOTAL / likely discontinued** — its help subdomain fails DNS resolution entirely (a technical **OBSERVED FACT**, though not itself an official discontinuation statement), and a third-party SaaS directory marks it discontinued as of ~September 2025. Its historical scoring documentation could not be retrieved via search or Wayback Machine in this pass.

## 5. PushPress Train

**Sources:** help.pushpress.com, official articles.

**OBSERVED FACT: no automatic combine feature.** The Train Workout Builder documentation requires a Score Type per Component and, for supersets specifically, offers only two manual patterns: fully separate independently-scored Components, or one combined entry where the coach must "clearly annotate in the workout description which movement will be scored" — i.e., the coach picks by hand which single number counts, never an automatic sum. Custom Scoring Divisions documentation (division tiers, leaderboard sort) contains nothing about weighting or combined/total scoring.

**Challenges feature — INFERENCE, undocumented math.** A "Numerical Scoring" challenge type tracks measurables (e.g. total meters/calories, steps/day) and displays "participant totals and rankings" — the feature clearly aggregates *something*, but the exact formula (sum vs. average, weighting, missing-day handling) is not documented in any page found this session — a real gap, not an absence claim.

## 6. btwb and SugarWOD

**SugarWOD — OBSERVED FACT, within-workout multi-set aggregation is documented; cross-workout is not.** A single workout with multiple sets can be scored via coach-chosen combine mode: total (sum), slowest/lowest, fastest/highest, or average — matching this document's own Family A vocabulary almost exactly, though scoped *within* one workout's repeated sets (closer to this codebase's own Segment/Interval scope than to cross-Section Workout Aggregation). A "Points" score type exists explicitly for gym-run challenges (cited partnership example: nutrition/habit tracking), but the summation logic across multiple challenge entries into one standing is **UNKNOWN / NOT PUBLICLY DOCUMENTED**.

**btwb — feature existence confirmed, mechanics undocumented.** Per-workout leaderboards (Prescribed/Modified × gender filters) and an "Open leaderboard" described as ranking members "across all Open events" (a CrossFit-Open-style cross-workout aggregate) are both **OBSERVED FACT** (marketing/support-page level), alongside a "Challenges and Earned Store" gym-community feature. The aggregation formula for either is **UNKNOWN / NOT PUBLICLY DOCUMENTED** in any page reachable this session.

## 7. Adjacent Platforms Found During Research

**HYROX — OBSERVED FACT, a genuinely different aggregation shape.** Official rulebook (PDF) confirms: (a) individual race scoring is a pure elapsed-time sum (running legs + stations + penalty seconds, all summed as time, no points at the base-race level); (b) Elite Division qualification separately uses a **percentile-of-winner's-time points system** layered with a **best-5-results-within-a-rolling-365-day-window** selection — a best-N-of-M, time-windowed aggregation pattern not seen on any other platform researched, this session or in `SCORING_COMPETITIVE_LANDSCAPE.md`. Named in the architecture document (§35) as found-but-deliberately-not-adopted.

**WODcast — UNKNOWN.** Positions itself as a dedicated competition scoring/leaderboard service with an organizer score-approval workflow; specific aggregation-formula documentation was not reachable in this pass.

**WodProof — likely out of scope.** Appears to be a personal WOD-logging/recording consumer app, not a competition-standings engine; no aggregation documentation found or expected.

## 8. Summary Table

| Mechanism | Platform | Tag |
|---|---|---|
| Cross-workout placement-sum, lowest total wins | CrossFit Games/Open Rulebook §1.24 | OBSERVED FACT |
| Cascading best-single-result tiebreak for overall standing | CrossFit Games/Open Rulebook §1.24 | OBSERVED FACT |
| Missing/invalidated score → "0", worst placement, still ranked | CrossFit Games/Open Rulebook §1.25/§1.28 | OBSERVED FACT |
| Per-event points table/direction, declared not fixed | CrossFit Games/Open Rulebook §1.16 | OBSERVED FACT (mechanism); exact table UNKNOWN |
| Total = best Snatch + best Clean & Jerk, formally medaled | IWF TCRR §6.8.1 | OBSERVED FACT |
| No Clean & Jerk success ⇒ no Total at all | IWF TCRR §6.9 | OBSERVED FACT |
| Total tiebreak = earliest achievement by calling order, NOT bodyweight | IWF TCRR §6.8.2 | OBSERVED FACT (2024 edition); Nov-2025 edition UNCONFIRMED |
| Point-per-place / points table, configurable Global→Division→Workout | Competition Corner | OBSERVED FACT |
| Cumulative raw-unit sum, same-unit constraint, no tiebreaks | Competition Corner | OBSERVED FACT |
| Weighted events (% per workout) | Competition Corner | OBSERVED FACT |
| DNF=0/rankable, CAP=below-finishers, WD=bottom | Competition Corner | OBSERVED FACT |
| Single-event auto-sum of own sibling parts | Competition Corner | NOT DOCUMENTED (gap) |
| "Weightlifting Total" named measure type | Wodify | OBSERVED FACT (existence); internal math UNKNOWN |
| No auto-combine of workout Components | PushPress Train | OBSERVED FACT |
| Within-workout multi-set combine (total/slowest/fastest/average) | SugarWOD | OBSERVED FACT |
| Cross-workout "Open leaderboard" aggregate | btwb | OBSERVED FACT (existence); formula UNKNOWN |
| Best-5-of-365-days rolling window + percentile points | HYROX | OBSERVED FACT — distinct shape, not adopted |

## 9. What This Confirms for the Architecture Document

Three independent cross-validations worth naming explicitly: (1) Competition Corner's Cumulative Units same-unit requirement independently confirms the Family A metric-compatibility rule this document derived from first principles; (2) CrossFit's own overall Open standing is, mechanically, exactly this document's Family B `placement-sum`, applied at the cross-Workout scope this document deliberately excludes (§13 of the architecture document) — the math is reusable, the ownership boundary is not blurred; (3) no platform researched, including the one purpose-built for competition scoring, documents the *specific* capability this document proposes — deriving one event's own score automatically from two of its own sibling parts' already-logged results — narrowing, not widening, Forge's claimed differentiation (§43 of the architecture document), and making that narrower claim more credible precisely because it survived a search for counter-evidence rather than merely asserting novelty.

---

**STOP.** This document is research and analysis only. No code, schema, or product decision was made or implied.
