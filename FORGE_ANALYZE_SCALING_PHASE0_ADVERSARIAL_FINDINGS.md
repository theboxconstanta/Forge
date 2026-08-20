# Forge Analyze + Scaling — Phase 0 Adversarial Findings

Every finding below is either (a) directly reproduced by executing real code in this session (marked **REPRODUCED LIVE**), or (b) a structural gap identified by direct reading of the actual prompt/schema/mapper source, not by running the model (marked **CODE-LEVEL, NOT MODEL-TESTED** — these require a live coach/admin session to confirm the model actually mishandles them; the code-level evidence only proves the *opportunity* for the failure, not that it happens every time).

## Scaling Defects (REPRODUCED LIVE — see Evaluation Matrix Section C for full data)

1. **Monostructural work with no leading rep count receives zero scaling at any tier.** `"Row 500m"`, `"400m Run"`, `"20/15 Cal Row"`, `"10m Handstand Walk"` all pass through `scaleMovementLine` completely unchanged, at every tier including OnRamp. 4/25 (16%) of a representative movement sample. **Root cause: A (Input Normalization)** — the line-parsing regex only recognizes a leading dash-separated rep count. **Severity: P1** — a coach reviewing generated variants has no visual cue that these specific lines were silently skipped; the workout "looks scaled" (other movements changed) while these lines are quietly RX-identical across all four tiers. **Confidence: DETERMINISTIC FAILURE** (100% reproducible, no randomness involved).
2. **A height-based suffix (`@ 24in`) silently defeats an already-correctly-configured substitution.** Box Jump has a real `SCALING_SUBSTITUTIONS` entry (→ Box Step-ups at beginner/onramp) that never fires when the RX line includes `@ 24in`, because the weight-suffix regex only recognizes `kg`/`lbs`. **Root cause: A (Input Normalization)**. **Severity: P2** (narrower blast radius than #1 — only affects box-height-suffixed lines specifically). **Confidence: DETERMINISTIC FAILURE**.
3. **High-skill gymnastics movements outside the ~19-entry substitution table are prescribed unchanged, including at OnRamp.** Bar Muscle-up and Ring Muscle-up both reproduced with only a rep-count reduction (5→3), same skill required, at the tier explicitly meant for the least-experienced athletes. **Root cause: D (Format Registry/Schema) borderline H (Scaling Logic)** — the fallback behavior ("keep name, scale load") is reasonable for a loaded barbell movement with no table entry, but actively wrong for a bodyweight skill movement with no table entry, and the code does not distinguish the two cases. **Severity: P1** (a coach who doesn't personally catch this could genuinely publish a new-athlete class with muscle-ups prescribed). **Confidence: DETERMINISTIC FAILURE**.

## Format Collisions (CODE-LEVEL, NOT MODEL-TESTED)

4. **RFT vs. For Time (Repeated Rounds) has no tie-breaking rule in the prompt**, even though the format catalog's own architecture treats them as semantically identical for a "N rounds of the same movements/reps" workout (documented in `workoutFormats.js`'s own comment, referenced by the previous Member Workout Display Integrity mission). `prompt.ts`'s `FORMAT_HINTS` gives RFT and For Time each their own one-line description but never tells the model which to prefer when a text is ambiguous between them (contrast with the explicit Ladder-vs-For-Time rule that *does* exist two lines below). **Root cause: C (LLM Prompt/Context)**. **Confidence: UNDEFINED PRODUCT BEHAVIOR** until run against the live model (Evaluation Matrix case P04).
5. **Strength Sets vs. Build to Heavy/1RM** — the prompt *does* give an explicit rule here (`FORMAT_HINTS`: Strength Sets "foloseste... cand exista o schema clara de seturi," Build to Heavy "foloseste... cand scopul e 'gaseste maximul zilei'") — a stronger prompt than the RFT/For Time pair, but still unverified against a live model (Evaluation Matrix cases P17/P18 are the direct test of whether the model actually applies this correctly, mandated by this mission's own §27).
6. **Weightlifting vs. Strength Sets vs. Build to Heavy/1RM is a genuine three-way gray zone.** A technical-practice prescription with an explicit sets×reps scheme (`"Practice: Snatch technique, 6x2 building"`) plausibly fits any of the three per the prompt's own hint text. This is flagged in the Evaluation Matrix (case P20) as **COACH REVIEW REQUIRED**, not a deterministic-answer test — the mission's own instruction (§85) not to convert genuine subjectivity into false deterministic truth applies directly here.

## Hallucination Risk (CODE-LEVEL, NOT MODEL-TESTED)

7. The prompt's own explicit anti-hallucination instruction (`prompt.ts` line 119, "Nu inventa informatii... alege null/valoarea mai conservatoare") is real and reasonably strong — but it is **advisory text to an LLM, not a code-enforced constraint**. `validateWorkoutAnalysis` (Current State Audit, "Validation") never checks whether a returned value is *plausible* (e.g., that a returned `weightMale` roughly matches typical loading for that movement), only that required fields are present and enum-valid. There is no code-level backstop against a fluent but wrong invented number the way `resolveCanonicalMovement` backstops movement-name grounding. **Confidence: cannot be elevated beyond UNDEFINED PRODUCT BEHAVIOR without live runs** — this is a structural opportunity for hallucination, not proof it occurs at any particular rate.

## Ambiguity Policy (CODE-LEVEL, CONFIRMED GAP)

8. **§36's mandated test — a weight with no unit (`"50/35"`) — has no documented product convention anywhere in the prompt.** `PARAMETER_RULES` tells the model what to do with percentages, box heights, and hold durations, but never states a fallback when a male/female weight pair appears with no `kg`/`lbs` suffix at all. This is a genuine, confirmed **gap** (not merely untested) — the current *policy* itself is undefined, independent of what any particular model call happens to return. **Root cause: K (Product Definition/Ambiguity)**.

## Re-Analyze (CONFIRMED SAFE — see Current State Audit)

9. Not a defect: this mission's feared destructive re-Analyze scenario (§56) was checked directly against the UI wiring (`WorkoutDayPage.tsx` line 311, `EditWorkoutDialog.tsx` grep) and **does not exist as a reachable path** — Quick Create is only reachable when no workout exists yet for that day, and the editor has no path back to it. Recorded here because the mission explicitly asked for this scenario to be tested, and a clean negative result is itself evidence, not an omission.

## Movement Catalog Drift (CODE-LEVEL, CONFIRMED)

10. **The LLM's canonical-movement grounding is a third, independently-maintained static list**, distinct from the real `movements` database table that Canonical Movement Identity, the PR Engine, and the coach editor's own autocomplete all use (Current State Audit, "Movement Catalog Integration"). A movement added to the real `movements` table today (platform-global, not gym-scoped) does not automatically become known to the model — it would need to also be added to `analyze-workout/movementCatalog.ts`'s static array by hand. **Root cause: E (Movement Catalog/Identity)**. **Severity: P2** (a real, disclosed architecture gap; not yet observed to have caused a specific bad output, since no live test was run).

## Test Coverage Gap (CODE-LEVEL, CONFIRMED)

11. **Zero automated tests exist for either LLM-backed Edge Function** (`analyze-workout`, `regenerate-variant`) — confirmed by direct filesystem search, no `.test.ts` in either folder. Every existing test in the two client repos tests hand-constructed fixture data flowing *downstream* of a hypothetical AI response, never the model's actual behavior. **Root cause: this is itself the root cause of finding #4-8's "cannot be elevated beyond code-level" ceiling** — there is currently no mechanism, automated or otherwise, that has ever measured what the model actually does for any real input. **Severity: P1** (blocks safe iteration on the prompt/schema of both functions; every prior prompt change shipped with no regression signal).

## Malformed Input / Security (CODE-LEVEL, WITHIN NORMAL SCOPE)

12. Both edge functions correctly reject empty/non-string `workout` bodies (400), require a valid Bearer token (401), require an `admins`/`coaches` row (403), and handle OpenAI-side timeout/refusal/truncation/malformed-JSON distinctly (502/422) — a reasonably complete defensive perimeter for a synchronous, authenticated, low-privilege-surface endpoint. No prompt-injection-via-pasted-workout test was run live (would require a real session), but the architecture itself gives an injected instruction in the pasted text no more authority than any other user content — the system prompt is a separate `developer`-role message, and Structured Outputs strict mode constrains the response shape regardless of what the user content says. This bounds (without eliminating) the blast radius of a hostile paste to "a wrong but shape-valid `WorkoutAnalysis`," never arbitrary code execution or schema escape.

## Summary by Severity

| Severity | Findings |
|---|---|
| P0 | None found |
| P1 | #1 (unparsed monostructural lines), #3 (uncovered gymnastics movements at OnRamp), #11 (zero LLM test coverage) |
| P2 | #2 (height-suffix substitution failure), #10 (movement catalog drift) |
| P3/P4 | #4-9, #12 (real gaps/confirmations, but each either unverified without a live run or, in #9's case, a confirmed non-issue) |
