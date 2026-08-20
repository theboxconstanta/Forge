# Forge Analyze + Scaling — Phase 0 Architecture Readiness

Ratings below are evidence-based, tied to specific findings in the Current State Audit and Evaluation Matrix documents — not impressions.

## A. Better Parsing — **PARTIALLY READY**

**Evidence for readiness**: the architecture already separates concerns cleanly — the prompt only asks the model to transcribe what's in the text (`SECTION_GUIDANCE`'s "no fixed slots" redesign already replaced fuzzy LLM reasoning with deterministic code once, in "Faza 3"), Structured Outputs strict mode guarantees shape, and a deterministic fallback (`resolveCanonicalMovement`) already backstops one weak spot (movement-name grounding). This is a proven pattern the team has already used successfully once (removing slot-fitting from the prompt).

**Evidence against full readiness**: zero automated evaluation exists for what the model actually returns (Current State Audit, "Current Tests"). Any prompt change today ships with no regression signal beyond a developer's own manual spot-check. The RFT-vs-For-Time ambiguity (no tie-breaking rule, unlike the Ladder-vs-For-Time rule that does exist) shows the prompt itself still has real, fixable gaps. Better parsing work should not start by rewriting the prompt from scratch — it should start by building the missing evaluation harness (Recommended Next Mission), because without it any prompt change is unverifiable.

## B. Better Scaling — **PARTIALLY READY**

**Evidence for readiness**: the deterministic engine's architecture is genuinely good — pure functions, already unit-tested for monotonicity, already supports per-gym override without an algorithm change (`buildScalingOverrides`), already has a working "escape hatch" to AI for a specific tier when the table falls short (`regenerate-variant`). Extending the substitution table is a pure data change, not an algorithm change (this session added zero new movements but demonstrated exactly how invisible the current coverage gap is).

**Evidence against full readiness**: this session found and reproduced three concrete, low-effort-to-fix defects in the *existing* deterministic engine before any "improvement" work should even be considered: (1) the line-parser silently skips any distance-only or calorie-slash-notation line — 16% of a realistic sample got zero scaling of any kind; (2) the weight-suffix regex doesn't recognize `in`/height units, silently defeating an otherwise-correctly-configured Box Jump substitution; (3) the substitution table's ~19-movement coverage means high-skill gymnastics movements outside it (Bar/Ring Muscle-up, confirmed live) are never substituted even at OnRamp. None of these are architecture problems — they are the kind of narrow, evidence-backed, low-risk fixes this mission is explicitly supposed to surface as the highest-value next step, not "better scaling" in the abstract.

## C. Evaluation Regression Suite — **NOT READY**

No evaluation harness exists for either LLM-backed function today (confirmed: zero `.test.ts` files in either function's folder). The deterministic engine, by contrast, already has one (`scalingEngine.test.ts`) and it is good — that's the template to extend, not invent from scratch. This mission's own Evaluation Matrix document (Section B) is a directly reusable starting corpus for a real harness, but converting it into an executable regression suite requires either (a) a way to invoke the live model in CI with a stable service account, or (b) recorded/replayed fixture responses — a real, scoped, buildable next step, explicitly not attempted in this investigation-only mission.

## D. Future Gym-Specific Feedback Memory — **NOT READY**

No mechanism today captures "AI proposed X, coach changed it to Y" anywhere (Current State Audit — VariantTabs/EditWorkoutDialog write generated content directly into the same mutable `variants` field the coach edits; the original AI/engine proposal is not retained once the coach types over it). Building this would currently require adding new state and a new persistence path — a real, non-trivial addition, not a configuration change. Per this mission's own explicit instruction (§57-58), this is investigated only for readiness, not designed or built here.

## E. Future Model/Provider Swap — **READY**

Both edge functions already isolate provider specifics behind `_shared/openai.ts`; the model is already a runtime secret (`OPENAI_MODEL`), not a hardcoded string, explicitly "changeable without a redeploy" per the code's own comment. Swapping models (e.g. a newer OpenAI model, or another Structured-Outputs-capable provider behind the same interface shape) would touch `_shared/openai.ts` and the two `callOpenAiWithRetry` call sites, not the prompts, schemas, or mappers. This is the one dimension of the five where the architecture is unambiguously ready today.

## Summary Table

| Dimension | Rating | One-line reason |
|---|---|---|
| A. Better parsing | PARTIALLY READY | Clean separation exists; zero evaluation harness blocks safe iteration |
| B. Better scaling | PARTIALLY READY | Good architecture; 3 concrete, low-risk, high-value bugs found and reproducible today |
| C. Evaluation regression suite | NOT READY | Zero LLM-facing tests exist; deterministic engine's own test suite is the template |
| D. Gym-specific feedback memory | NOT READY | No proposal-vs-final capture exists anywhere in the write path |
| E. Provider/model swap | READY | Already isolated behind one shared module + a runtime secret |
