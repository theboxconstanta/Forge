# Forge Analyze + Scaling Intelligence — Phase 0 Final Report

Investigation and research only. Zero production code, schema, prompt, or data was changed while producing this report and its companion documents. Companion documents: `FORGE_ANALYZE_SCALING_PHASE0_CURRENT_STATE_AUDIT.md`, `FORGE_ANALYZE_SCALING_PHASE0_COMPETITIVE_RESEARCH.md`, `FORGE_ANALYZE_SCALING_PHASE0_EVALUATION_MATRIX.md`, `FORGE_ANALYZE_SCALING_PHASE0_ARCHITECTURE_READINESS.md`, `FORGE_ANALYZE_SCALING_PHASE0_ADVERSARIAL_FINDINGS.md`.

# Executive Summary

The product's own mental model of "Analyze" (paste RX → one AI action → RX + Intermediate + Beginner + OnRamp) does not match what Forge actually does. Analyze is a **parser only** — it never generates scaling variants unless the coach's own pasted text already contains them, which the prompt explicitly forbids inventing. Scaling generation is a separate, later, coach-triggered step, and by default it is **not AI at all** — it's a deterministic rules engine (`scalingEngine.ts`) that this audit found to be architecturally sound but with three concrete, reproducible defects (silently unscaled monostructural work, a height-unit parsing gap, uncovered high-skill gymnastics movements). A third mechanism, genuine per-tier AI regeneration, exists but is fully opt-in and never in the default path. Zero automated tests exist for either LLM-backed edge function. No competitor researched has shipped AI-generated scaling tiers at all, which reframes Forge's existing (if imperfect) deterministic-plus-optional-AI scaling architecture as ahead of, not behind, the market. The recommended next mission is narrow, low-risk, and entirely evidence-backed: harden the deterministic scaling engine's line parser and extend its substitution table, informed by this audit's own measured gaps — not a rewrite, not new AI, not fine-tuning, not RAG.

# Overall Verdict

The current system is a genuinely useful **parsing accelerator with a real, coach-controlled manual-authoring fallback always available** — not yet a validated "paste and mostly done" experience, because its actual model-level accuracy has never been measured (zero test coverage of the LLM-facing code) and this audit could not measure it either, for a disclosed, legitimate reason (no coach/admin credentials available under this project's own standing no-login rule). Where the system *could* be measured directly in this session — the deterministic scaling engine — real defects were found and are the clearest, smallest, highest-value next step.

# What ANALYZE Actually Does

`analyze-workout` (OpenAI `gpt-5-mini`, Structured Outputs strict mode) turns pasted/typed text into an ordered array of sections, each optionally carrying a `format` (one of Forge's 22 formats), `formatConfig`, `movements`, and — **only if explicitly present in the source text** — `scalingVersions`. A small, deterministic, non-LLM benchmark short-circuit (`benchmarks.ts`) recognizes ~10 well-known WOD names and returns a verified structure without calling the model at all. Everything downstream of the raw model response (legacy-field derivation, movement-name fallback resolution, section→editor mapping, the Buy-In/Cash-Out 3-section merge heuristic) is deterministic code, not further LLM reasoning — a deliberate, already-proven pattern (the team already moved one piece of reasoning, section-slot-fitting, from the prompt into code once, in "Faza 3").

# Current Architecture

See `FORGE_ANALYZE_SCALING_PHASE0_CURRENT_STATE_AUDIT.md` in full. Summary: two OpenAI-backed edge functions (`analyze-workout`, `regenerate-variant`), one deterministic scaling engine (`scalingEngine.ts`), two independently-ported client-side mappers (WOD-SIMPLE's `workoutIntelligence.js`, forge-admin-web's `workoutIntelligence.ts`), and a movement/format catalog architecture with three manually-synced copies and one confirmed drift risk (the LLM's canonical movement list is not the same table Canonical Movement Identity uses).

# Current Format Count

**22**, counted directly from `src/workoutFormats.js`'s `WORKOUT_FORMATS` object (script-verified, not assumed): AMRAP, Ascending AMRAP, For Time, RFT, Chipper, Ladder, Partner WOD, Death By, Death By Weight, EMOM, Tabata, Intervals, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset, Buy-In/Cash-Out, AMRAP with Buy-In, Not For Time, Chained AMRAP, Max Effort. Confirmed in sync today with `analyze-workout/openaiSchema.ts`'s `WORKOUT_FORMAT_VALUES` (same 22 + `Unrecognized`) and with forge-admin-web's `formatCatalog.ts` (an explicit, documented port of the same source).

# Evaluation Corpus

25 parsing cases (constructed, ready-to-run, not yet executed against the live model — see below) + 25 scaling cases (constructed AND executed live against the real deterministic engine). Full detail in `FORGE_ANALYZE_SCALING_PHASE0_EVALUATION_MATRIX.md`.

# Parsing Baseline

**Not measured.** `analyze-workout` requires a real coach/admin Supabase Auth session; obtaining one would require logging in as a real user, which this project's own standing rule (recorded in this assistant's memory, applied consistently across every prior mission in this codebase) prohibits regardless of the target account type. This is disclosed honestly rather than worked around or fabricated. The 25-case corpus in the Evaluation Matrix document is ready for the coach, or a future session with legitimate credentials, to execute.

# Exact Workout Accuracy

Not measured, for the same reason. Cannot be reported without inventing a number.

# Format Detection

Not measured live. Two structural gaps were found and documented at the code level (RFT vs. For Time has no prompt tie-breaking rule, unlike the analogous Ladder vs. For Time rule that does exist) — see Adversarial Findings #4.

# Structural Config

Not measured live. The output schema itself is well-structured (Current State Audit, "Output Schema") with a defensible field-classification (AI-provided / deterministic-fallback / application-provided / derived).

# Movement Recognition

Deterministic fallback layer (`resolveCanonicalMovement`) verified live via Deno in this session: correctly resolves common abbreviations (C2B, TTB, HSPU, DU, KBS, PC, HPC) and correctly returns `null` (not a guessed match) for a genuinely unknown movement. The LLM's own movement-grounding accuracy was not measured live (requires a real call), but the catalog it's grounded on was confirmed to be a third, static, independently-maintained list — not the real `movements` database table (Current State Audit, "Movement Catalog Integration"; Adversarial Findings #10).

# Loads

Not measured live for AI-parsed loads. The prompt's own rules for load-adjacent edge cases (percentages, box heights, hold durations) are specific and sensible where they exist — but a genuine gap was found: no documented policy for a weight with no unit at all (`"50/35"`) (Adversarial Findings #8).

# Male / Female Prescriptions

Not measured live for parsing. For scaling, verified live and structurally sound in every case tested: the deterministic engine always scales male/female by the same ratio and never swaps or drops one side (Evaluation Matrix, "Format Preservation / Monotonicity").

# Timing

Not measured live for parsing. For scaling, time-cap/duration fields scale monotonically and correctly across tiers in every case tested (real, executed test: `adjustFormatConfigForTier` — 600s → 690s/780s/900s across intermediate/beginner/onramp, confirmed both by the pre-existing test suite and independently in this session).

# Multi-Section

Not measured live for parsing (case P25 in the Evaluation Matrix is the direct test). Architecturally, section order is preserved by construction (array index, not a model-authored field — Current State Audit, "Output Schema"), and the primary-section-selection heuristic (last `required` section wins) is shared code, not duplicated logic per client.

# Scaling Architecture

Two independent mechanisms, fully traced (Current State Audit, "Scaling Generation"): a deterministic default (`generateVariantsFromRx`, pure, synchronous, curated ~19-movement substitution table + fixed per-tier percentage rules) and an opt-in, per-tier AI "second opinion" (`regenerate-variant`, one LLM call, genuinely stimulus-preservation-literate prompt). Neither is triggered automatically by Analyze itself.

# Intermediate / Beginner / OnRamp

No product-documented definition of what these tiers are supposed to mean beyond the deterministic engine's own hardcoded numbers (10%/20%/35% volume reduction; 80%/60%/50% load ratio; 15%/30%/50% time-cap increase) — contrast with CrossFit's own CAP program, which defines each tier by explicit, legible criteria (experience thresholds, rep-capacity thresholds — Competitive Research document). This is a real, addressable gap, not a defect in either engine's mechanics.

# OnRamp

Deserved and received separate scrutiny (mission §50). Measured finding: OnRamp is **not yet reliably "genuinely suitable for a new athlete"** in the deterministic default path — the two clearest live-reproduced defects (Bar/Ring Muscle-up unchanged, monostructural lines entirely unscaled) both land hardest at exactly this tier, since OnRamp is where movement-substitution matters most and load-only fallback matters least.

# Stimulus Preservation

Format is always preserved (100% in every case tested — format string itself is never touched by either scaling mechanism). Movement-pattern/skill preservation is where the deterministic engine's real gap lives (see OnRamp above); the AI regeneration path's prompt explicitly targets stimulus preservation in genuinely CrossFit-methodology-consistent language (Current State Audit, "Prompt Architecture") but was not measured live and is never the default.

# Cross-Tier Monotonicity

Verified live and via the pre-existing test suite: strictly ordered, no inversions found in any case tested, for both load/volume and time-cap direction.

# Manual Correction Burden

Measured (deterministic engine only, n=25, this session's own executed run): roughly 76-84% of generated lines were "accept as-is" or "minor edit," 16-24% required the coach to actively catch and fix a real, silent gap (either an inappropriate high-skill movement carried to OnRamp, or a completely unscaled monostructural line). Full breakdown in the Evaluation Matrix document.

# Re-Analyze Behavior

Confirmed, directly, via UI-wiring inspection: **not a reachable path in the current product.** Quick Create (and therefore Analyze) only appears when no workout exists yet for a given day; the manual editor has no path back to it. The mission's feared "coach edits Beginner, re-Analyzes, Forge silently destroys the edit" scenario cannot currently occur.

# Hallucination

The prompt contains a real, reasonably strong anti-hallucination instruction, but it is advisory-only — no code-level plausibility check exists downstream (unlike movement-name grounding, which does have a deterministic backstop). Not measured live; flagged as a structural opportunity, not a proven failure rate (Adversarial Findings #7).

# Ambiguity

One confirmed, code-level policy gap: no documented behavior for a male/female weight with no unit at all. Everywhere else checked (percentages, box heights, hold durations), the prompt has a specific, sensible rule.

# Latency

Not measured (requires a live call). Architecturally bounded: 45s timeout, one retry only on 429/5xx.

# Cost

Not measured (requires a live call and real token usage data). Order-of-magnitude reasoning only (small model, moderate prompt size) is in the Current State Audit — no specific number is reported, deliberately, per this mission's own "do not fabricate precision" instruction.

# Competitive Research

Full document: `FORGE_ANALYZE_SCALING_PHASE0_COMPETITIVE_RESEARCH.md`. Headline finding: of seven software vendors and four programming-content brands researched, **only btwb has shipped a confirmed generative-AI free-text-to-structured-workout feature**, and **zero vendors researched — including btwb — have public documentation of AI-generated Rx/Intermediate/Beginner scaling tiers**. Forge's existing architecture (deterministic default + optional AI per-tier regeneration) is, on this evidence, already more automated in scaling than anything confirmed to exist in this market.

# CrossFit Methodology

CrossFit HQ's own documented scaling doctrine centers on "intended stimulus" and a strict order of operations: reduce load, then volume, then substitute movement — substitution explicitly a last resort, not a first move. This is directly relevant to the deterministic engine's own defects: the engine's fallback for an uncovered movement (load-ratio only, name unchanged) is *accidentally* consistent with "load first" for a loaded barbell movement, but wrong for a bodyweight skill movement where load reduction is meaningless and substitution is the only lever that matters — a real, useful lens for prioritizing the substitution-table extension recommended below.

# Manual vs. AI-Assisted Authoring

The product already guarantees Manual + Template + Empty as permanent, equally-reachable first-class paths alongside Generate Workout (`QuickCreateDialog.tsx` — three buttons, no AI-required gate). This was confirmed directly in code, not assumed.

# Root Cause Taxonomy

Applied throughout `FORGE_ANALYZE_SCALING_PHASE0_ADVERSARIAL_FINDINGS.md`. Categories actually used by real findings in this audit: **A (Input Normalization)** — the two live-reproduced scaling parser gaps; **C (LLM Prompt/Context)** — the RFT/For Time tie-breaking gap; **E (Movement Catalog/Identity)** — the third static catalog; **H (Scaling Logic)** — the uncovered-movement fallback; **K (Product Definition/Ambiguity)** — the no-unit-weight policy gap. No findings required categories B, D, F, G, I, J — worth noting, since it means the gaps found are concentrated and narrow, not scattered across the whole pipeline.

# P0/P1/P2/P3 Findings

Full list with severity and confidence in the Adversarial Findings document. **Zero P0.** **P1** (3): unparsed monostructural scaling lines, uncovered high-skill gymnastics movements at OnRamp, zero LLM-facing test coverage. **P2** (2): height-suffix substitution failure, movement-catalog drift. **P3/P4**: the remaining code-level, not-yet-model-tested gaps (format collisions, hallucination opportunity, ambiguity policy gap), plus one confirmed non-issue (re-Analyze safety).

# Architecture Readiness

Full ratings and evidence in the Architecture Readiness document. Summary: Better Parsing — PARTIALLY READY; Better Scaling — PARTIALLY READY; Evaluation Regression Suite — NOT READY; Gym-Specific Feedback Memory — NOT READY; Provider/Model Swap — READY.

# AI Learning Decision

**NOT YET.** No mechanism exists to capture "AI proposed X, coach corrected to Y" today (would require new state/persistence, a real addition, not a toggle). More fundamentally: building learning on top of a scaling engine with three known, unfixed, narrow defects would learn from and potentially reinforce those defects before they're even fixed. Fix what's measurably broken first; there is no evidence in this audit that more AI, learning, or personalization is the bottleneck — the bottleneck found is a handful of missing regex cases and a short substitution table.

# Copy/Paste Decision

**Should remain, permanently, first-class.** Confirmed in code (Manual + Template + Empty are equal-footing buttons alongside Generate) and reinforced by every competitor researched — the market's dominant authoring pattern is manual/structured entry, with copy/paste-of-free-text-into-AI-parsing being the rare exception (one confirmed vendor), not the norm to race toward replacing.

# Analyze Decision

**Should remain, with an evaluation harness attached before further prompt iteration.** No evidence found that it should be removed — the architecture (deterministic post-processing, benchmark short-circuit, movement-name fallback) reflects real, already-successful engineering investment. The gap is measurement, not value.

# Scaling Generation Decision

**CORE (deterministic default), OPTIONAL ACCELERATOR (AI regeneration).** The deterministic engine should stay the default path — it's instant, free, and (once its three found defects are fixed) architecturally sound; per-tier AI regeneration should stay exactly where it is: an opt-in "second opinion," not promoted to the default, since it's unmeasured and slower/costlier than the deterministic path for cases the deterministic path already handles well.

# Recommended Product Contract

Paste → Analyze parses RX (and only RX, unless the coach explicitly wrote scaled variants) → coach reviews/edits RX → coach clicks Generate Variants (deterministic, instant) → coach reviews/edits, optionally clicking Regenerate with AI on any one tier for a second opinion → Save. This is materially different from, and more honest than, the mission's own initial assumed model — and should be made explicit in product-facing copy/documentation, since right now a coach forming a mental model purely from the UI could easily believe (incorrectly) that Analyze itself is what produces the scaled tiers.

# Recommended Next Mission

**Harden the deterministic scaling engine's line parser and extend its substitution table**, scoped exactly to this audit's own measured findings: (1) extend `scaleMovementLine`'s regex to recognize distance-only and calorie-slash (`N/N cal`) monostructural lines, applying the tier's volume-reduction ratio to the numeric value the same way rep counts already scale; (2) extend the weight-suffix regex to recognize height units (`in`/`cm`) so existing substitution-table entries like Box Jump actually fire; (3) add substitution-table entries for the highest-real-risk uncovered movements found in this session (Bar Muscle-up, Ring Muscle-up, and by the same reasoning any other high-skill gymnastics movement without an entry today) at minimum for the OnRamp tier. All three are narrow, data/regex-level changes to a single already-well-tested file, with a clear existing test to extend (`scalingEngine.test.ts`), zero schema change, zero prompt change, zero new AI surface.

# Why That Mission Is Highest Value

It is the only recommendation in this entire audit backed by **live, reproduced, 100%-deterministic evidence** rather than code-level inference awaiting a live model run. It fixes real defects in the *default, always-on, zero-cost* scaling path every coach already uses — not a hypothetical AI-quality improvement. It requires no new architecture, no new authorization scope, no new secret, and extends a file that already has a good test suite to grow. It directly reduces the measured 16-24% "coach must catch a silent gap" burden found in this session.

# What Should Explicitly NOT Be Built Yet

Fine-tuning (no evidence base to tune against — zero measured LLM accuracy exists yet). RAG/gym-scaling-memory (no evidence of retrieval being the bottleneck; the found bottleneck is regex/data-table coverage, not context retrieval). Gym-specific AI learning from coach corrections (no capture mechanism exists, and learning from a scaling engine with known unfixed defects would be premature). A rewrite of the Analyze prompt (no evaluation harness exists yet to prove any rewrite is actually better, not just different). Removal of Copy/Paste, Manual authoring, or Analyze itself (no evidence supports removing any of them).

# Final A–O Verdict

### A. Can a coach currently paste a normal real-world workout, press ANALYZE, and usually receive a structurally correct Forge workout?
**PARTIALLY.** The architecture and prompt design are reasonable and the RX-parsing path is what Analyze is actually built for, but zero live measurement exists to say "usually" with evidence — and the coach's own mental model that Analyze also fills in Intermediate/Beginner/OnRamp is currently **not what happens** unless those variants are already in the pasted text.

### B. Is ANALYZE currently accurate enough to remain a core Forge feature?
**YES**, conditionally — the architecture is sound and no evidence found it should be removed, but "accurate enough" cannot be asserted with a number until the recommended evaluation harness exists.

### C. Does ANALYZE materially reduce coach authoring work compared with manual entry?
**PARTIALLY.** For the RX section specifically, very likely yes (parsing free text into structured fields is exactly the friction it targets, and Manual/Template/Empty remain available whenever it isn't). For the full RX+3-tiers workflow the mission assumed, no — that additional work still requires the separate Generate Variants step, which this audit found is not communicated as a distinct step anywhere in this report's review of the current architecture.

### D. Are Intermediate/Beginner/OnRamp currently good enough to be useful coach suggestions rather than autonomous prescriptions?
**PARTIALLY.** They are always coach-editable (never locked), which satisfies the "suggestion not autonomous prescription" bar structurally — but the measured 16-24% silent-gap rate in the default deterministic path means a coach who doesn't personally review every line (i.e., treats them as more autonomous than they should) could publish a real defect, most acutely at OnRamp.

### E. Does Forge preserve intended stimulus consistently enough across generated tiers?
**PARTIALLY.** Format and timing are preserved consistently (100% in every case tested). Movement-pattern/skill-level preservation is inconsistent — reliable for the ~19 covered movements, unreliable outside that table, most severely for high-skill gymnastics movements.

### F. Should Manual + Copy/Paste remain permanent first-class workflows?
**YES.**

### G. Should AI remain optional and coach-controlled?
**YES.**

### H. Should Forge build gym-specific AI learning from coach corrections now?
**NOT YET.** No capture mechanism exists; no evidence the current bottleneck is personalization rather than the three found, narrow, fixable defects.

### I. Is there evidence that fine-tuning is needed now?
**NO.** No baseline accuracy has even been measured to justify tuning against.

### J. Is there evidence that RAG / Gym Scaling Memory is needed now?
**NOT YET.** The found scaling gaps are regex-coverage and data-table-coverage problems, not retrieval problems.

### K. Is the existing Movement Catalog sufficient for the next Analyze iteration?
**PARTIALLY.** Functionally adequate for common movements (verified live: common aliases resolve correctly) but architecturally a drift risk — a third, static copy independent of the real `movements` table.

### L. Is the existing Workout Format Registry sufficient for the next Analyze iteration?
**PARTIALLY.** Currently in sync (verified) across all three copies, but with no automated sync check — sufficient today, fragile by construction.

### M. Can the evaluation corpus become a permanent regression suite after this audit?
**YES**, for the scaling half immediately (it already ran against real code in this session) and for the parsing half once a way to invoke the live model in a test/CI context is established (a real, scoped, separate piece of work, not attempted here).

### N. What is the SINGLE highest-value next implementation mission?
**Harden the deterministic scaling engine's line parser and extend its substitution table**, scoped exactly to the three defects this audit reproduced live (distance/calorie-slash line parsing, height-unit weight-suffix parsing, and substitution-table entries for high-skill gymnastics movements at minimum for OnRamp).

### O. Should we implement anything else before that mission?
**NO.** No blockers — the recommended mission touches one already-well-tested, dependency-free file (`scalingEngine.ts`), requires no schema change, no prompt change, and no new authorization or infrastructure.

# Explicit Non-Goals (this mission)

No production code changed. No schema changed. No prompt changed. No data mutated. No live LLM call made (by design, per this project's standing no-login rule — documented and respected, not worked around).

# Documents Created

1. `FORGE_ANALYZE_SCALING_PHASE0_CURRENT_STATE_AUDIT.md`
2. `FORGE_ANALYZE_SCALING_PHASE0_COMPETITIVE_RESEARCH.md`
3. `FORGE_ANALYZE_SCALING_PHASE0_EVALUATION_MATRIX.md`
4. `FORGE_ANALYZE_SCALING_PHASE0_ARCHITECTURE_READINESS.md`
5. `FORGE_ANALYZE_SCALING_PHASE0_ADVERSARIAL_FINDINGS.md`
6. `FORGE_ANALYZE_SCALING_PHASE0_FINAL_REPORT.md` (this document)
