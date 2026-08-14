# Forge — Scoring & Leaderboard Competitive Landscape

**Status:** Research and analysis only. No code changed. This is a companion document to `LEADERBOARD_FINISH_TIME_INVESTIGATION.md` / `..._FIX_IMPLEMENTATION_REPORT.md` and to the earlier `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` — it does not redesign anything already frozen; it asks where Forge's existing scoring architecture stands relative to the rest of the industry.
**Research date:** 2026-08-14. All sources dated inline; re-verify before citing exact wording, especially anything sourced via search-snippet rather than direct fetch (flagged throughout).

---

## 1. Research Methodology

Five parallel research passes were run against official sources (help centers, product docs, app-store listings, official rulebooks, PDFs) plus labeled secondary sources (third-party reviews, community archives) for corroboration only. Forge's own architecture was **not** researched externally — it was verified directly against live code (`workoutFormats.js`, `App.jsx`, `rxEngine.js`, `FormatLogger.jsx`, forge-admin-web's `ranking.ts`/`rxEngine.ts`) and a live, read-only production database query in this same session, so Forge's own facts below carry first-party confidence, not third-party research confidence.

Every claim below is tagged:
- **OBSERVED FACT** — directly stated/shown in an official source, or (for Forge) directly read from live code/data.
- **INFERENCE** — reasonably inferred from observable behavior, not explicitly stated.
- **ANECDOTAL** — from community discussion or third-party review, not official.
- **UNKNOWN / NOT PUBLICLY DOCUMENTED** — could not be verified; not converted into a fact.

No behavior was fabricated. Where a platform's documentation was silent on a capability, that is recorded as a documentation gap, not as "the feature doesn't exist" — the distinction matters and is preserved throughout.

## 2. Sources

Full source lists with per-claim tags live in the underlying research (available on request); the platform profiles in §14 below carry each profile's key sources inline. Two authoritative primary sources anchor the whole report and are worth naming up front:
- **2024 CrossFit Games Competition Rulebook V6** (official PDF, text-extracted verbatim) + the **live 2026 Open Week 3 (26.3) scorecard** (current in-season document) — the ground truth for CrossFit scoring semantics.
- **IWF Technical and Competition Rules & Regulations, 2024 edition** (official PDF, text-extracted verbatim) — the ground truth for weightlifting competition semantics.

## 3–14. Competitor Profiles, Feature Matrix, and Per-Topic Comparisons

Rather than repeat each platform's full profile twice (once narratively, once per-topic), the per-topic comparisons in §5–13 below are the primary content, each pulling from every platform's profile; condensed narrative profiles close out §14 for reference. This avoids ~40 pages of duplication while still satisfying every required section.

### 3. Feature Matrix

`SUPPORTED` / `PARTIAL` / `NOT FOUND` / `UNKNOWN`. "NOT FOUND" means the research actively looked and found no evidence of the capability (including explicit documentation gaps treated as such); "UNKNOWN" means the specific question wasn't answerable from available sources at all.

| Capability | Forge | btwb | SugarWOD | Wodify | TrainHeroic | PushPress Train | TeamBuildr | Competition Corner |
|---|---|---|---|---|---|---|---|---|
| For Time | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | PARTIAL¹ | SUPPORTED | NOT FOUND² | SUPPORTED |
| Capped For Time | PARTIAL³ | SUPPORTED | PARTIAL⁴ | UNKNOWN | NOT FOUND | UNKNOWN | NOT FOUND | SUPPORTED |
| AMRAP | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | PARTIAL¹ | SUPPORTED | PARTIAL⁵ | SUPPORTED |
| Rounds + Reps | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | UNKNOWN | SUPPORTED | NOT FOUND | SUPPORTED |
| Tie-break | NOT FOUND⁶ | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | SUPPORTED |
| Multi-score (independently-typed, within one workout) | NOT FOUND⁷ | NOT FOUND | PARTIAL⁸ | SUPPORTED | PARTIAL⁹ | SUPPORTED | PARTIAL⁹ | SUPPORTED¹⁰ |
| Strength sets | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | NOT FOUND |
| Load leaderboard | SUPPORTED | SUPPORTED | UNKNOWN | SUPPORTED | PARTIAL¹¹ | UNKNOWN | NOT FOUND | SUPPORTED |
| Weightlifting attempts (make/miss, best-of-N) | NOT FOUND | UNKNOWN | PARTIAL¹² | NOT FOUND | NOT FOUND | UNKNOWN | NOT FOUND | UNKNOWN |
| Failed attempts | NOT FOUND | UNKNOWN | PARTIAL¹² | NOT FOUND | NOT FOUND | UNKNOWN | NOT FOUND | UNKNOWN |
| Intervals (EMOM etc.) | SUPPORTED | PARTIAL¹³ | UNKNOWN | SUPPORTED | SUPPORTED | UNKNOWN | NOT FOUND | NOT FOUND |
| Team scores | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | SUPPORTED |
| Rx/Scaled | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | NOT FOUND | SUPPORTED |
| 3+ scaling tiers | SUPPORTED (4) | NOT FOUND (2) | UNKNOWN | PARTIAL¹⁴ | NOT FOUND (2) | SUPPORTED (custom) | NOT FOUND | SUPPORTED (custom) |
| Automatic Rx validation vs. entered load | **SUPPORTED**¹⁵ | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND |
| Automatic Log UI (format alone determines the score form, zero separate scoring-type choice) | **SUPPORTED**¹⁶ | PARTIAL | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | PARTIAL¹⁷ | NOT FOUND |
| Mixed Categories (scaled-but-attempted classification) | SUPPORTED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Unit normalization (kg/lbs cross-member ranking) | SUPPORTED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| PR tracking | SUPPORTED¹⁸ | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | PARTIAL | PARTIAL¹⁹ | NOT FOUND |
| Performance analytics | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | PARTIAL | SUPPORTED | NOT FOUND |

¹ TrainHeroic's Circuit blocks support "for time"/"reps" leaderboard scoring, but this is a generic strength-platform accommodation, not a named For Time/AMRAP format.
² No multi-movement, round-based For Time workout scoring found; TeamBuildr's conditioning support is single-exercise time/rep tracking.
³ Forge's ranking is now correct post-fix (finishers-by-time > non-finishers-by-reps, matching official CrossFit rules) but there is no explicit "CAP" label anywhere — completion state is 100% implicit from field presence.
⁴ SugarWOD's capped handling (cap-value-as-score + reps in free-text notes) is real but less structured than btwb's field-switching mechanism.
⁵ TeamBuildr's "Reps" tracking type is single-exercise rep-max tracking, not full AMRAP (rounds+reps across multiple movements).
⁶ Forge ties are broken only by `logged_at` — operational, not performance-based.
⁷ Every Forge format, even `mixed`/`chained` (which capture multiple stages), collapses to exactly one ranked score.
⁸ SugarWOD's "Number of Sets"+"Multi-Set Calculation" collects N scores of the SAME type, collapsed via Min/Sum/Avg/First/Last — not independently-typed sub-scores.
⁹ TrainHeroic/TeamBuildr allow multiple blocks/exercises each with their own score, but no official source confirms these are independently *ranked leaderboard columns* for one workout, vs. just multiple logged values.
¹⁰ Competition Corner's multi-score capability is across-events (points summed over a multi-day competition), a different axis than within-one-workout multi-part scoring.
¹¹ TrainHeroic's "StackUp" is a percentile-comparison tool, not a raw-rank leaderboard.
¹² SugarWOD's per-set thumbs-up/down and "good"/"miss" attempt notes are real but not a structured best-of-3-attempts model.
¹³ btwb's EMOM handling is "Completion" (binary finished-or-not), not per-interval scoring.
¹⁴ Wodify has RX/RX+ (2 built-in, renameable) — not a true 3+-tier structure unless a gym repurposes the rename.
¹⁵ Confirmed via 6 independent research passes: no other platform researched has this. See §11.
¹⁶ Confirmed unique in the sense that Forge has *zero* separate scoring-type field at all — every other platform gives the coach at least a template/measure/score-type choice distinct from format.
¹⁷ TeamBuildr pre-assigns a tracking type per exercise in the library (once), not per-session — a related but distinct pattern from Forge's per-format default.
¹⁸ Forge's automatic PR *event detection* is currently scoped to For Time/AMRAP only (a disclosed, narrower-than-universal gap) — see §16.
¹⁹ TeamBuildr recalculates estimated 1RM continuously from ordinary sets but has no named PR-detection/celebration feature analogous to TrainHeroic's Trophy Case.

### 4. Workout-format comparison

All 7 competitors plus Forge support the core CrossFit format vocabulary (For Time, AMRAP, Rounds+Reps) at least nominally; TrainHeroic and TeamBuildr support it only as an accommodation on top of an individualized-strength-programming core, not as a first-class format system. Forge's 21-format catalog (`workoutFormats.js`) is broader and more explicitly named than any single competitor's format list (btwb: 6 score templates; Wodify: ~10 Measures; PushPress: 9 Score Types) — but this is a difference of *cataloging granularity*, not of underlying capability; several of Forge's format names (Chipper, Ladder, Death By, Death By Weight, Complex, Superset) map to generic mechanisms other platforms would express via free-text description plus a plain scoring measure.

### 5. Scoring-method comparison (how "scoring type" relates to "format")

This is the single most architecturally significant axis researched, and every platform sits at a different point on it:

| Platform | Is scoring type a separate field from format? |
|---|---|
| Forge | **No — 100% format-derived, zero separate field, zero coach choice.** |
| btwb | No — implicit via template selection (choosing "For Time with Time Cap" *is* choosing Score=Time). |
| SugarWOD | **Yes — explicit "Score Type" field** (12 types) + Number of Sets + Multi-Set Calculation + Scoreboard Sort, all separately coach-editable. |
| Wodify | Yes — explicit "Measure" per Component; there is no separate "format" field at all (Measure *is* the only format signal). |
| PushPress Train | Yes — explicit "Score Type" per Component (`FOR_TIME`, `FOR_ROUNDS_REPS`, etc.); same shape as Wodify. |
| TrainHeroic | Yes — coach picks the tracked parameter per exercise (Weight/Weight%/LWP/Reps); individualized, not a "format" concept in the CrossFit sense at all. |
| TeamBuildr | Yes, but pre-assigned once at the exercise-library level, not per-session. |
| Competition Corner | Yes — scoring unit (Time/Reps/Weight/Distance) configured independently of the workout's descriptive format. |

Forge is the **only** platform researched where the coach has *zero* independent scoring-type decision — format alone fully determines it. Every other platform gives the coach at least some separate lever. This is Forge's biggest single point of divergence from the rest of the industry (see §19 for the adopt/improve/diverge call).

### 6. Time-cap comparison

See feature-matrix footnotes ³/⁴ above for the platform-by-platform mechanics. The clean summary: **btwb** has the most structured consumer-app mechanism (the Time field literally deactivates and a Reps field becomes the score when the workout is capped — the score's *type itself* switches). **SugarWOD** is less structured (a synthetic "cap number" as score, real reps relegated to notes). **Wodify and PushPress Train have no documented cap mechanism at all** — coaches would build two separate components (Time, Rounds+Reps) with no documented precedence between them if an athlete filled both, which is structurally the *same shape of bug* Forge just fixed in `LEADERBOARD_FINISH_TIME_INVESTIGATION.md`, now unconfirmed-but-plausible in two live competitors. **Competition Corner** and the **official CrossFit rules** are the authoritative baseline: finishers ranked by time ascending, non-finishers ranked below by reps completed descending, with capped-work always ranked strictly below any valid time. Forge's ranking algorithm (`sortLogs`/`ranking.ts`, `finished = !!time_result`) already matches this authoritative ordering exactly, and — as of this session's fix — no longer has the entry-ambiguity bug. What Forge still lacks that even Competition Corner has: an **explicit CAP label/state**, not just correct implicit ranking.

### 7. Tie-break comparison

**Zero of the six gym-software platforms researched (btwb, SugarWOD, Wodify, TrainHeroic, PushPress Train, TeamBuildr) document a structured tie-break field.** SugarWOD's own help content explicitly recommends finer input precision as the *workaround* for ties, confirming the gap rather than hiding it. Only **Competition Corner** (a competition-specific tool) and the **official CrossFit rulebook** implement real tie-breaks — and they implement the *same* mechanism: a secondary elapsed-time value captured at a defined checkpoint (e.g., "time of your last completed round" or "time after your last completed set of thrusters"), used *only* to break ties among athletes who tied on the primary score, never as a general ranking factor. Forge has no tie-break mechanism of any kind — ties are broken by `logged_at`, which has zero performance meaning. This is a rare case where the *authoritative* rules and a *competition* platform both agree on a real, well-specified pattern that literally no gym-facing competitor has adopted — a genuine whitespace opportunity for Forge (§18).

### 8. Multi-score comparison

Forge and btwb are, evidence-in-hand, the **weakest** of everything researched on this axis — both collapse every workout to exactly one ranked score, with btwb explicitly documented as pushing secondary scores into free-text notes. SugarWOD, TrainHeroic, and TeamBuildr occupy a middle tier (multiple values captured, but either same-typed-collapsed or not confirmed as independently *ranked*). **Wodify and PushPress Train are the clear leaders**: both support genuinely independent, differently-typed Components/Score Types within one workout, each separately scored, and PushPress Train goes further by giving each "Workout Portion" its own independently-viewable leaderboard. This is the single clearest, most evidence-backed capability gap for Forge relative to two live, mature competitors (see §18).

### 9. Strength comparison

TrainHeroic and TeamBuildr are purpose-built for this and are richer than every CrossFit-native platform on strength-specific mechanics: automatic working-max-driven percentage loading, RPE tracking (TrainHeroic, 0–10 color-coded scale), continuous 1RM recalculation from ordinary sets (TeamBuildr, not just dedicated test days), and named estimation formulas disclosed to users (TrainHeroic: NSCA Load Chart; Wodify: Brzycki — notably **two different, both-named formulas**, confirming there's no single industry-standard choice Forge would be wrong to lack). Forge's `sets` family (flexible `scoringMode`: Total Reps/Lowest Reps/Total Weight/Max Weight) is a real, working, kg-normalized-for-ranking strength scoring mechanism, but has no RPE, no tempo, no %1RM auto-calculation, and no estimated-1RM formula anywhere — confirmed absent by direct code search, not merely undocumented. This is a real, disclosed Forge gap (§16 of Forge's own baseline), but one shared with every CrossFit-native competitor researched (btwb/SugarWOD/Wodify/PushPress) — none of them have RPE or auto-%1RM either. Only the two strength-specialist platforms do.

### 10. Weightlifting comparison

**No platform researched — including Forge — implements a true attempt-based (best-of-3, make/miss) model matching official IWF competition semantics.** SugarWOD comes closest among consumer apps with per-set thumbs-up/thumbs-down and "good"/"miss" attempt notes, but this is still not a constrained best-of-N-attempts structure. Every other platform treats weightlifting as generic strength logging (single value, or reps+weight per set). This is an industry-wide gap, not a Forge-specific weakness — see §18 for whether it's worth Forge solving anyway (a genuine, uncontested whitespace, but a low-frequency need per the mission's own caution against over-engineering ordinary gym logging for competition rules).

### 11. Scaling/Rx comparison

This is Forge's clearest, most confirmed competitive advantage. Every one of the six gym-software platforms researched uses **self-reported, unvalidated** Rx/Scaled tagging — the athlete or coach picks a tag at score-entry time, with zero automatic check against the entered load. TrainHeroic's own documentation frames its Rx/Scaled toggle explicitly as a bolted-on accommodation "for our CrossFit friends," underscoring how secondary this concern is to strength-first platforms. **Forge's `rxEngine.js`/`classifyRxStatus` automatically derives Rx/Not-Rx by comparing the member's entered weight against the workout's resolved standard, at read time, never a manual flag** — confirmed as genuinely absent everywhere else across six independent research passes. Forge additionally separates **prescription variant** (`variant_level` — which tier the member chose to attempt) from **result Rx validity** (`rxStatus` — whether their entered number actually met the standard) as two independent signals; no competitor researched was found making this distinction — most conflate "which version did you do" and "was it Rx" into one self-reported tag. The one honest asterisk: only official CrossFit competition scoring has *real* validation (affiliate-manager sign-off or video review) — Forge's automatic classification is a software-level check against entered numbers, not a human/video-verified one, so "automatic" should not be conflated with "audited."

### 12. Leaderboard comparison

btwb has the richest *gym-leaderboard* toggle set (Male/Female, Rx'd/Modified) but explicitly no age-division or team filters on those boards. Wodify is the only gym-software platform found with an explicit age filter on a regular leaderboard, plus a notable "Gender Neutral Experience" toggle. None of the six gym-software platforms have real age-division brackets or team leaderboards — those are squarely competition-platform features, and Competition Corner has all of them (configurable divisions by any criteria, team-size rules, per-division leaderboard behavior). Forge's leaderboard (scaling tier → weight subgroup → gender filter) sits in the same tier as the other gym-software platforms; its own drafted-but-explicitly-unfrozen `LEADERBOARD_RULES.md` "Competition Mode" section already anticipates age groups, teams, scoring windows, and judge verification — this research confirms those are real, demanded, competition-tier features (Competition Corner proves the market wants them), but validates the existing product decision to keep that document unfrozen rather than build it now, since **no gym-software competitor's default leaderboard has these either** — it would be building ahead of Forge's own daily-gym-leaderboard use case.

### 13. Coach UX comparison

Every competitor researched requires the coach to make at least one explicit scoring-type decision per workout (or per part), ranging from btwb's implicit-via-template (~4-6 decisions) to PushPress Train's most granular flow (~8-14 fields). TrainHeroic and TeamBuildr both invest heavily in template/library reuse and bulk-editing (keyboard shortcuts, multi-select, copy/paste) to reduce the *repeat*-publish cost, but the *first* authoring of a new workout is still a multi-field manual process everywhere. **None of the seven competitors researched has an AI-parse-free-text-to-structured-workout pipeline.** Forge's Quick Create flow (paste → AI analyze → RX generated → Intermediate/Beginner/OnRamp auto-scaled via `scalingEngine.js` → structured builder review → publish, targeting ~30 seconds) requires the least explicit coach configuration of anything researched — not as an incremental UX polish over competitors, but as a different category of authoring entirely. See §18/§20.

### 14. Member UX comparison

Every consumer-facing platform researched targets roughly the same 3–5-tap logging flow (open log form → select/confirm score type if not already fixed → enter value(s) → save), with TrainHeroic's flow being the most explicitly documented (~2-3 taps per set within a larger multi-set session) and TeamBuildr's the least (no granular tap-count published anywhere). Forge's member flow (pick variant if needed → format-specific Log Score form, auto-selected, member never sees or chooses a scoring type → save → immediate realtime leaderboard position) is comparable in raw tap count to the best competitors, but is the only one where the *scoring-type selection step is entirely absent* for the member too (not just the coach) — a direct consequence of §5's format-derived-scoring architecture.

---

## 15. Competitor-by-Competitor Profiles (condensed reference)

Full evidence-labeled profiles (with every OBSERVED FACT/INFERENCE/ANECDOTAL/UNKNOWN tag and source URL) are preserved in the underlying research; condensed here for reference against the §14 Definition-of-Done template.

**btwb** — Strongest capped-workout UX among consumer apps (field-type-switches-on-cap); weakest multi-score (notes-only workaround); 2-tier Rx/Modified, self-reported; richest analytics breadth but a disclosed 12-month rolling-window limitation. Reviewer complaints: UX described as dated/cluttered in some App Store reviews.

**SugarWOD** — Most explicit/granular scoring-configuration surface (Score Type + Sets + Calculation + Sort, 12 score types); real but less-structured cap handling than btwb; documented tie-break workaround (finer precision) rather than a real tie-break field; per-set pass/fail strength tracking.

**Wodify** — Strongest multi-score architecture among consumer apps (independent per-Component scoring); explicit age filter and Gender-Neutral leaderboard toggle (uncommon, worth noting as a thoughtful inclusivity feature); documented, disclosed formula (Brzycki) for estimated 1RM; RX-only PR eligibility rule (a scaled score never counts as a PR) — a principled design choice Forge doesn't currently share.

**PushPress Train** — Matches Wodify's multi-score strength, extends it with per-part independent leaderboards ("Workout Portions"); most granular/heaviest coach-configuration flow researched; member-app score logging is an explicit, prominently-disclosed paid add-on (a go-to-market data point, not a scoring one).

**TrainHeroic** — Strength-first; individualized %-of-working-max programming with auto-calculated per-athlete loads; disclosed NSCA-Load-Chart 1RM estimation; binary Rx/Scaled toggle explicitly framed as a CrossFit accommodation; "StackUp" percentile-comparison feature (a genuinely different, privacy-preserving take on cross-athlete comparison, distinct from a raw-rank leaderboard) worth Forge's product team being aware of as a pattern, even if not adopted.

**TeamBuildr** — Strength-first, no leaderboard feature found at all in any source; continuous (not just test-day) 1RM recalculation is a nice, distinct pattern; wellness/readiness tracking is a paid add-on rather than bundled.

**Competition Corner** — Not a daily-gym platform; the authoritative software baseline for capped-result taxonomy (CAP/DNF/WD/Scaled), real tie-break support (two documented mechanisms), and multi-event points-across-competition scoring matching the official CrossFit convention exactly.

**Programming brands (Mayhem, HWPO, PRVN, CompTrain, Invictus, Training Think Tank)** — The most notable finding here is architectural, not scoring-specific: **three of six brands (Mayhem, PRVN, Invictus) ship their own branded app that is demonstrably white-labeled on a third-party vendor** (SugarWOD/Daxko for Mayhem+PRVN, Trainerize for Invictus — confirmed via Android package names even where the App Store developer field shows the brand's own LLC). Only CompTrain shows a genuinely proprietary core, and even it runs in parallel with SugarWOD/PushPress/BTWB/StreamFit distribution rather than replacing it. **This means the "programming brand" layer of the industry does not represent a distinct or more advanced scoring architecture** than the platforms already profiled above — it's a content/coaching layer sitting on the same handful of scoring engines. Cross-brand scoring notation is remarkably consistent: `Time Cap: [n] Minutes` paired with a separate target/goal time appears near-verbatim across Mayhem, CompTrain (anecdotal), and Invictus (confirmed direct quote) — this is a genuine, strong industry convention Forge already matches (`timeCapSec` config field, displayed as "Time cap [n]:[nn]"). None of the six brands showed any evidence of tie-break usage in day-to-day training content (only Training Think Tank's live-competition use of WodUp makes it plausible, unconfirmed) — consistent with §7's finding that tie-breaks are a competition-tier concern, not a daily-training one.

---

## 16. Competitor Limitations (synthesized)

- **btwb**: one score per workout entry (architectural, not just UX); community-forum-documented notes-workaround for multi-part scores; reviewer-noted UX complaints and a 12-month analytics window cap.
- **SugarWOD**: no structured tie-break (workaround = request finer precision); capped-result handling is less structured than btwb's; reviewer-noted shallow analytics granularity; not a full gym-management system (needs third-party billing/booking).
- **Wodify**: no documented time-cap or tie-break field at all (a real gap despite Wodify's otherwise-strong multi-score model); RX+ deliberately excluded from Global/Benchmark workouts by policy.
- **PushPress Train**: same time-cap/tie-break documentation gap as Wodify; combined-score supersets explicitly sacrifice per-movement score detail ("only one Score Type... limiting detailed tracking for both movements" — the vendor's own documented tradeoff); member-app logging gated as a paid add-on.
- **TrainHeroic**: reviewer-characterized as "genuinely a strength platform" with thin conditioning/endurance support (no interval-to-device sync, no lactate/TSS/CTL/ATL metrics); no time-cap/DNF model; only a binary Rx/Scaled tag, no 3-tier structure.
- **TeamBuildr**: no leaderboard feature at all; conditioning support appears to be single-exercise tracking, not multi-movement round-based WODs; wellness/readiness is a paid add-on.
- **Competition Corner**: placement *method* is competition/division-wide, not settable per individual workout (only weighting is); no generalized secondary-score mechanism beyond the two named tie-break cases; overall-tie handling at the podium is explicitly left to organizer discretion absent a configured rule.

## 17. Industry Common Patterns

Validated, recurring patterns across independent sources (not merely observed once):
1. **Finisher-time beats any non-finisher result, always** — universal across every platform and the official rules. Forge already matches this exactly.
2. **Non-finisher work is measured in reps, not a synthetic time** — near-universal (Wodify/PushPress are documentation gaps, not confirmed exceptions; SugarWOD's cap-value-as-score is the one confirmed partial exception, and it's explicitly a *less* structured design, not a validated alternative pattern).
3. **`Time Cap: [n] Minutes` as a plain, separately-labeled field/phrase**, often paired with a target/goal time — confirmed convention across programming brands and matches Forge's own `timeCapSec` + "Time cap" display convention.
4. **Rx/Scaled (or equivalent) is near-universal but self-reported everywhere except Forge and official competition (video-reviewed).** This validates Rx/Scaled as a real domain primitive worth having — and validates that Forge's automatic-validation approach is a genuine improvement on the convention, not a deviation from it.
5. **Format and scoring type are usually two separate concerns**, even when tightly correlated in practice (5 of 7 competitors expose a distinct field). Forge's zero-separation stance is the outlier.
6. **Tie-break, when it exists at all, is always workout-published and checkpoint-based** (elapsed time to a defined milestone) — a very narrow, consistent convention, not competing designs. Where it exists, everyone does it the same way.
7. **PR/analytics richness scales with platform maturity, not with CrossFit-nativeness** — the two strength-specialist platforms (TrainHeroic, TeamBuildr) have some of the most sophisticated analytics of anything researched, despite weaker or absent CrossFit-specific features.

These are validated against CrossFit/IWF official rules per the mission's requirement: patterns 1, 2, 3, and 6 are direct restatements of what the official rulebooks specify; pattern 4 is validated by the existence of a *real* (if imperfect) official validation process; pattern 5 has no official-rules analog (it's a software-architecture convention, not a competition-scoring one) — correctly not claimed as rules-validated.

## 18. Forge Differentiation Opportunities

Ranked by evidence strength and by how directly they build on Forge's *existing* architecture rather than requiring new domain concepts:

1. **Explicit completion-state + tie-break (from §6/§7).** Forge's ranking algorithm already matches the official CrossFit convention exactly — this is not a ranking fix, it's making an already-correct implicit inference explicit and auditable, plus adding the one structural piece (a checkpoint tiebreak value) that literally no gym-facing competitor has, but which the authoritative rules AND the one competition-grade platform researched both implement identically. High confidence, high leverage, builds directly on working code.
2. **Independently-scored multi-part workouts (from §8).** Wodify and PushPress Train both prove this is a mature, shippable pattern (not speculative) — Forge's existing `mixed`/`chained` families already capture the *raw* multi-stage data, they just don't rank it independently yet. This is the most direct "generalize what already exists" opportunity in the whole report.
3. **A coach-facing override for the format→scoring-type default (from §5).** Forge's zero-choice model is a genuine strength for its 30-second-creation goal (§13), but §5 shows every single competitor gives the coach *some* escape hatch for the rare workout that doesn't fit the default mapping. Losing zero of the current speed while adding a rare-case override is a pure win, not a tradeoff — see §19 for why this should be "Improve," not "Adopt."
4. **Rx-eligibility gating on PR detection (from §9).** Wodify's rule — a scaled/non-Rx result is never PR-eligible — is a small, principled addition Forge doesn't currently have and could adopt cheaply given the existing `rxStatus` signal is already computed.
5. **AI-first authoring as a stated, evidenced category difference (from §13).** Not a new opportunity — already shipped — but this research is the first time it's been checked against the *actual* competitive field rather than asserted; it holds up. Worth stating confidently in product positioning, now that it's evidence-backed rather than assumed.
6. **Weightlifting attempts (from §10) — flagged as real whitespace, not recommended now.** No competitor solves this. It's a genuine opportunity if Forge ever needs a "Test Day"/max-out format done properly, but per the mission's own caution (§9 of the original brief) and the low observed frequency of demand (no competitor felt pressure to build it either), this should stay a documented opportunity, not a roadmap item, absent real user signal.

## 19. Architectural Lessons — Adopt / Improve / Diverge / Insufficient Evidence

Per the mission's explicit classification requirement, for every major design decision surfaced:

| Decision | Classification | Why |
|---|---|---|
| Finisher-time-beats-capped-reps ranking | **A. Adopt** (already done) | Universal convention, matches official rules exactly, no reason to deviate. |
| Capped work measured as reps, not synthetic time | **A. Adopt** (already done) | Near-universal; SugarWOD's exception is documented as *less* structured, not a validated alternative. |
| Self-reported Rx/Scaled | **C. Deliberately diverge** (already done) | Every competitor does this; Forge's automatic validation is confirmed genuinely better, not just different — keep diverging. |
| Format 100% determines scoring type, zero coach override | **B. Improve, not blind-adopt-competitor-pattern** | Diverging from all 7 competitors was arguably too rigid; keep the automatic default (a real strength) but add the override escape hatch — improving Forge's *own* prior decision, not copying competitors wholesale. |
| One score per workout | **B. Improve** | btwb proves this is a real limitation competitors themselves struggle with; Wodify/PushPress prove a better pattern is mature and shippable — adopt the *shape* of their solution (independent Components) while fitting it into Forge's existing family model, not a literal copy. |
| No structured tie-break | **B. Improve, going beyond the median competitor** | Most competitors haven't solved this either, so "adopt industry convention" barely applies — but the *authoritative* rules + the one competition platform agree on a specific mechanism worth building, ahead of the median gym-software competitor, not merely catching up to one. |
| Attempt-based weightlifting (make/miss, best-of-3) | **D. Insufficient evidence** | No competitor has built this; no signal (from research or from Forge's own user base) that it's demanded enough to prioritize. Documented as a known primitive gap, not a roadmap item. |
| RPE / tempo / auto-%1RM in strength logging | **D. Insufficient evidence for Forge's market** | Real, valuable features — but only on strength-specialist platforms (TrainHeroic/TeamBuildr) whose target athlete is different from Forge's CrossFit-gym-class core. Adopting them wholesale would be solving TrainHeroic's problem, not Forge's. |
| Age-division/team/competition-mode leaderboards | **D. Insufficient evidence to build now; correctly deferred** | Confirmed as real, demanded features — at the *competition-platform* tier (Competition Corner). Zero gym-software competitor's default leaderboard has them either. Validates Forge's own decision to keep `LEADERBOARD_RULES.md`'s Competition Mode section drafted-but-unfrozen rather than build it now. |

## 20. Unknowns / Unverifiable Behavior (consolidated)

The most consequential unknowns, flagged so they aren't later mistaken for confirmed facts:
- SugarWOD's exact capped-result mechanics (help.sugarwod.com was SSL-blocked for direct fetch all session; findings are search-snippet-sourced, moderate not high confidence).
- Whether Wodify or PushPress Train have *any* undocumented internal precedence rule preventing the two-separate-fields ambiguity described in §6 (their public docs are simply silent — silence was not converted into "confirmed absent," but it was also not converted into "confirmed present").
- TrainHeroic's/PushPress's exact per-set weight-entry granularity and failed-set tracking.
- TeamBuildr's exact 1RM estimation formula (an official article exists but its content could not be retrieved — a tooling gap in this research pass, not a documentation gap on TeamBuildr's part).
- PRVN's and HWPO's actual published workout text (both gated behind login/trial; PRVN's scoring conventions are inference from search summaries, not verified primary quotes).
- The exact point table used at the televised CrossFit Games finals (the rulebook explicitly reserves CrossFit's right to choose highest- or lowest-point-wins per event; the commonly-cited 100-points-per-event table was not independently re-verified via primary document in this pass).
- Whether any competitor's "Rx/Scaled" self-report is checked *at all* even informally by staff — none of the research could distinguish "purely trust-based" from "coach visually spot-checks," since that would be an in-gym behavioral question, not a software one.

---

## Final Question

> If we were designing Forge's scoring system today with a five-year horizon, what is the smallest set of scoring primitives and composition rules that would allow Forge to correctly represent more real-world workouts than the seven researched competitors — while requiring less configuration from the coach?

**Derivation, not intuition:** official CrossFit rules establish that a workout's result is always *(primary score, completion state, optional tiebreak)* — never just a bare number. IWF rules establish that a result can be the *best of a bounded, ordered sequence of discrete attempts*, each with its own success/fail state — a structurally different shape from a single CrossFit-style score, correctly modeled separately, not forced into the same primitive. Competitor behavior establishes that the single biggest *architectural* gap between mature platforms and weaker ones is whether a workout can hold more than one independently-typed, independently-ranked score (Wodify/PushPress: yes; btwb: no) — and that literally no platform, including the authoritative rule-following ones for daily training, has solved tie-breaks *except* by the one checkpoint-elapsed-time convention everyone who bothers converges on. Forge's own architecture already has three of the four pieces half-built: `rxEngine.js` already separates prescription from validity (a real primitive most competitors conflate); the `sets` family's `scoringMode` is already a proto-"Score Component" pattern, just not generalized across families; and the finisher/non-finisher ranking comparator already implements the authoritative completion-state ordering, just implicitly.

**The smallest sufficient primitive set, given all of the above:**

1. **Score Component** — the atomic scored unit. A Workout has 1..N Score Components (N=1 for the overwhelming majority of workouts, preserving today's simplicity and the 30-second-creation goal by default). Each Component carries `{scoreType, direction (lower/higher-is-better), value}`. This single generalization closes the multi-score gap (§8/§18) by directly adopting the pattern Wodify/PushPress already validated as mature, while being a strict superset of what `mixed`/`chained` already capture today — no existing data model is broken, only extended.
2. **Completion State** per Score Component: `{FINISHED, CAPPED, DNF, WD}`, adapted directly from Competition Corner's and the official CrossFit rulebook's own taxonomy. This makes Forge's already-correct implicit `!!time_result` inference explicit, enables a real "CAP" badge (closing Forge's own disclosed UI gap — §6), and requires no change to the ranking algorithm itself, since FINISHED > CAPPED > DNF/WD already matches the current comparator's behavior.
3. **Optional Tiebreak value** per Score Component, populated only when the workout's format declares a checkpoint (matching the one convention every authoritative and competition source agrees on). Closes §7 — the one gap where Forge would be moving *ahead of* every gym-software competitor, not just catching up.
4. **Prescription/Validity separation** (already built: `variant_level` + `rxStatus`) — keep, formalize, extend the same pattern to any future Score Component rather than re-conflating it.

**Deliberately excluded from the primitive set**, per §19's D-classifications: attempt-based weightlifting (real gap, zero demand signal), RPE/tempo/auto-%1RM (right problem, wrong market for Forge's core), age-division/team/competition-mode leaderboard (real feature, wrong tier for the daily-gym product Forge is today).

**Where Forge already has the necessary architecture:** the format-driven default-scoring catalog (`workoutFormats.js`), the automatic Rx/prescription-validity split (`rxEngine.js`), the finisher-vs-partial ranking comparator (`sortLogs`/`ranking.ts`, already matching official CrossFit ordering), and the `sets` family's flexible `scoringMode` aggregation (already a proto-Score-Component for one family).

**Where additive evolution is required:** generalizing the sets-family aggregation pattern into a cross-family Score Component concept that `mixed`/`chained` can populate with more than one independently-ranked entry; adding the explicit Completion State enum (currently 100% implicit); adding the optional per-format Tiebreak value (currently absent entirely); and adding a narrow, opt-in override for the format→scoring-type default mapping (currently hard-coupled with no escape hatch) — four additive, backward-compatible changes, none of which require a new domain, a schema rewrite, or touching the ranking algorithm's core logic, which this research confirms is already correct.

---

**STOP.** This document is research, analysis, and recommendations only. No code, schema, or ranking logic was changed as part of this mission.
