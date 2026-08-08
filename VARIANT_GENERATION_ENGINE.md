# Forge — Variant Generation Engine: Detailed Design

**Owning domain:** Programming (`PROGRAMMING_DOMAIN_V1_2.md` §8)
**Status:** Draft for review

---

## 1. Two distinct engines with the same name, disambiguated

This document is, precisely, two engines sharing a v1.2/v1.1 naming convenience, and conflating them is the single most likely reviewer misreading of this package — disambiguated here first.

- **The Generation Engine** — authoring-time, coach-triggered, Programming-owned, produces a *proposed Scaling Profile* a coach reviews and accepts or edits. Runs rarely (once per Section, per authoring session). Its output becomes permanent, frozen Programming content once accepted (`PROGRAMMING_DOMAIN_V1_2.md` §3).
- **The Rendering Pipeline** — view-time, athlete-triggered (implicitly, on every Workout view), Results/Programming-boundary-crossing (reads Programming's frozen WorkoutVersion, applies an athlete's own Results-owned Scaling Context preference), produces a *RenderedVariant* that is never persisted as authoritative content and is recomputed, cheaply, on every view. Runs constantly (every Workout view, by every athlete).

These have different triggers, different frequencies, different owners of their *output's* persistence, and different failure consequences (a bad Generation Engine proposal wastes a coach's review time; a bad Rendering Pipeline result is shown directly to an athlete and must never silently misrepresent Programming's actual authored content). They share only their deterministic-transformation *nature* and, partially, their input data. This document addresses both, in that order.

---

## 2. Render-time vs. publish-time generation

### 2.1 The question, and why it matters more than it first appears

If Scaling Profiles are generated once, at Publish, and then rendered as static content thereafter, rendering is trivial (a lookup). If Scaling Profiles are generated fresh on every athlete view, rendering is maximally flexible (an athlete's individual context can shape output) but must be provably deterministic to satisfy this package's own Architectural Invariants. Getting this wrong in either direction either loses flexibility Programming's own Adaptive/Masters/Teens future evolution (§6 below) will need, or reintroduces the exact staleness/inconsistency risk `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §5.1 was written to eliminate for Workout content generally.

### 2.2 Decision: generation is publish-time (coach-triggered, one-shot, reviewed); rendering is view-time (automatic, per-athlete, pure function over already-frozen content)

These are not in tension once §1's disambiguation is applied. **Generation** (the authoring-time engine) runs when a coach explicitly requests it, its output is reviewed and becomes ordinary, frozen WorkoutVersion content once accepted — this is publish-time in the sense that matters: by the time any athlete can see it, it is already frozen, structured Scaling Profile content, indistinguishable from hand-authored content (`PROGRAMMING_DOMAIN_V1_2.md` §7). **Rendering** (the view-time pipeline) never generates new content — it *selects and formats* already-frozen content (a Scaling Profile per §render precedence rules, `PROGRAMMING_DOMAIN_V1_2.md` §13) for one athlete's specific Scaling Context and unit preference. No content is invented at view time; only presentation is resolved at view time. This is the direct, load-bearing resolution `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §14.3 already reached, restated here with full mechanism.

### 2.3 Tradeoff table

| | Publish-time-only generation, no view-time rendering step | View-time rendering over publish-time-frozen content (adopted) | Fully live, per-view generation (rejected) |
|---|---|---|---|
| Determinism | Trivial (static lookup) | Provable, given §3's purity constraint | Requires proving determinism across live-changing Rule Sets — much harder |
| Coach trust / reviewability | High (generation reviewed once) | High (identical — generation still reviewed once; rendering never generates) | Low — coach never sees what an athlete will actually be shown before it's shown |
| Flexibility for future per-athlete personalization (Adaptive, §6) | None — one fixed Scaling Profile per tier, no room for individual variation | Rendering can select among multiple frozen Scaling Profiles per athlete signal, without re-generating | High, but at the cost of determinism and coach trust above |
| Staleness risk | None (already frozen) | None — rendering reads only immutable WorkoutVersion content | High — a live-generated view could differ between two views of the same athlete, seconds apart, if a Rule Set changed mid-session |

Adopted: the middle column. It is strictly dominant except on the one axis (unlimited per-athlete personalization) that this package's own constraints (deterministic rendering, coach-reviewable content) explicitly rule out for V1 regardless.

---

## 3. Persisted vs. computed variants

### 3.1 Scaling Profile (Generation Engine output) — persisted

Once a coach accepts, a Scaling Profile is ordinary WorkoutVersion content (`PROGRAMMING_DOMAIN_V1_2.md` §3, §7) — persisted, immutable once its parent WorkoutVersion is created, no different in storage discipline from hand-authored content.

### 3.2 RenderedVariant (Rendering Pipeline output) — computed, optionally cached, never authoritative

A RenderedVariant is the fully-resolved, unit-converted, tier-selected, display-ready view of a WorkoutVersion for one specific `(Member, Scaling Context, unit preference)` triple. It is **not** a new source of truth — it is a pure function:

```
RenderedVariant = render(workoutVersion, scalingContext, unitPreference, renderRuleSetVersion)
```

It **may** be cached (a materialized cache is explicitly permitted, matching Results v1.0 §16's own precedent for Leaderboard caching — "warranted only if real read-latency at scale demands it") keyed on the full input tuple above, with a trivial invalidation rule: **the cache key includes every input; there is no invalidation logic to write, because a changed input produces a different key, never a stale hit under an unchanged key.** This is deliberately the simplest possible caching discipline — content-addressed caching rather than time- or event-based invalidation — chosen specifically because every input to `render()` is either already-immutable (WorkoutVersion) or itself versioned (renderRuleSetVersion, §3.3), making content-addressing free of the staleness class of bugs a TTL- or event-invalidated cache would risk.

### 3.3 What "renderRuleSetVersion" is

Unit conversion and Scaling-Level-to-precedence-tier resolution (`PROGRAMMING_DOMAIN_V1_2.md` §13) are themselves governed by a small, versioned rule set (distinct from the Variant Generation Rule Set, §4 below, which governs *content generation*, not *rendering selection*) — versioned for the same reason: so that `renderVariantHash` (`RESULTS_DOMAIN_V1_1.md` §2) remains reproducible even if Forge later changes, say, its rounding convention for converted units. In practice this rule set changes extremely rarely (a platform-wide display convention, not a per-gym configuration) and versioning it is a correctness safeguard, not an anticipated frequent-change surface.

---

## 4. Deterministic algorithm

### 4.1 Generation Engine algorithm (informal specification, not executable code)

```
generate(baseScalingProfile, targetScalingLevel, movementLibrary, ruleSet):
  for each MovementOverride slot in baseScalingProfile:
    candidateSubstitute = ruleSet.substitutionTable.lookup(slot.movement, targetScalingLevel)
      // deterministic table lookup, never a fuzzy/ML match at generation time — ambiguous
      // or low-confidence Movement resolution (Programming v1.2 §5) is grounds to SKIP
      // proposing a substitution for that slot, not to guess one
    candidateLoad = if slot.loadProfile.prescriptionType == 'literal':
                        slot.loadProfile.value * ruleSet.loadReductionPercent[targetScalingLevel]
                     else if prescriptionType == 'formula':
                        unchanged  // a formula (e.g., bodyweight-relative) scales itself correctly
                                   // per-athlete at RENDER time (§5), never re-scaled again at
                                   // generation time — scaling a formula's multiplier would be a
                                   // double-application bug
    candidateReps = slot.section.repScheme * ruleSet.repReductionRatio[targetScalingLevel]
    emit ProposedOverride(slot, candidateSubstitute?, candidateLoad?, candidateReps?)
  return ProposedScalingProfile(sourceType: 'generated', overrides: all emitted)
```

**Purity requirement**: every input (`baseScalingProfile`, `movementLibrary`, `ruleSet`) is either already-frozen WorkoutVersion content or a versioned, immutable Rule Set snapshot. No wall-clock read, no random number, no live network call. Given the identical four inputs, this algorithm returns byte-identical output, always — the specific, testable claim `PROGRAMMING_DOMAIN_V1_2.md` §9 requires and this document is obligated to make concrete.

### 4.2 Rendering Pipeline algorithm

```
render(workoutVersion, scalingContext, unitPreference, renderRuleSetVersion):
  profile = resolveByPrecedence(workoutVersion, scalingContext.scalingLevelId)
             // PROGRAMMING_DOMAIN_V1_2.md §13, strict precedence, first match wins
  for each override in profile.movementOverrides:
    resolvedLoad = if override.loadProfile.prescriptionType == 'formula':
                       override.loadProfile.formulaReference.resolve(athlete)  // e.g., bodyweight × multiplier
                    else:
                       override.loadProfile.value
    displayLoad = convertUnit(resolvedLoad, override.loadProfile.unit, unitPreference, renderRuleSetVersion)
    emit RenderedMovement(override.substituteMovementId ?? original, displayLoad, override.repOverride ?? default)
  return RenderedVariant(profile.scalingLevelId, all emitted movements)
```

The one non-pure-looking step — resolving a formula Load Profile against "the athlete" — is still deterministic *given* the athlete's own current bodyweight value as an explicit input, not a hidden side effect; this is named explicitly as a real determinism boundary in `RISK_REVIEW.md` (a formula-based prescription's rendered output changes if the athlete's recorded bodyweight changes between two views — correct, expected behavior, but worth naming as the one legitimate exception to "identical inputs, identical output" at the RenderedVariant layer, scoped precisely to formula-type Load Profiles only).

---

## 5. Caching strategy

Content-addressed, as established in §3.2. Two cache tiers, both optional (the system is correct with zero caching, caching is a pure performance optimization per Results v1.0 §16's own precedent):

- **Generation output cache**: keyed on `(sectionId, targetScalingLevel, ruleSetVersion)` — since the Generation Engine's output only changes when the Rule Set version changes, this cache has a very long effective lifetime and very high hit rate once a gym's Rule Set stabilizes.
- **RenderedVariant cache**: keyed on `(workoutVersionId, scalingLevelId, unitPreference, renderRuleSetVersion)` — deliberately **not** keyed on `memberId`, since two athletes with the same Scaling Context and unit preference receive byte-identical RenderedVariant output (with the sole, disclosed exception of formula-based Load Profiles, §4.2, which would require a per-athlete cache key extension if and when a gym's Rule Set actually uses formula prescriptions at scale — named as a scoping detail, not solved further here).

## 6. Invalidation rules

Content-addressed caching (§3.2) means the *literal* invalidation rule is "never — a changed input is a different key." The operationally relevant question is **cache eviction/garbage collection**, not invalidation: entries keyed on a superseded WorkoutVersion or Rule Set version are eligible for eviction once no active reference to that version exists in recent read traffic — a standard LRU-style policy, not a correctness concern, since even a "stale" cache entry (one keyed on an old version) is not wrong, it simply corresponds to a version nothing currently requests.

## 7. Override mechanics

Fully specified in `PROGRAMMING_DOMAIN_V1_2.md` §11 (Coach Override Behavior) — repeated here only as a cross-reference for completeness: an override is an ordinary Scaling Variant edit through the existing editor; `sourceType` transitions from `'generated'` to `'generated-then-edited'`; no separate override entity or workflow exists at the Generation Engine layer.

## 8. Future extensibility

| Future capability | How it extends this design without requiring a redesign |
|---|---|
| **Adaptive** (individualized prescription, not a fixed tier) | Already partially modeled (`RESULTS_DOMAIN_V1_1.md` §7.1) as a Scaling Level whose classification is definitional rather than Rx-Engine-computed. The Generation Engine does not need to *generate* Adaptive content algorithmically at all for V1 — Adaptive content remains coach-authored per-athlete, consistent with its individualized nature; this design's precedence rules (`PROGRAMMING_DOMAIN_V1_2.md` §13) already accommodate "no generated content exists for this tier, coach authors directly" as a first-class case, not a gap. |
| **Masters** (age-based scaling) | A new Scaling Level in Programming's existing gym-extensible catalog (v1.1 §3, unmodified), with its own Variant Generation Rule Set entry (§4.1's `ruleSet.loadReductionPercent['masters']`) — additive configuration, zero engine redesign. |
| **Teens** | Identical mechanism to Masters — a new Scaling Level, a new Rule Set entry. |
| **Competition** | Competition-mode leaderboard behavior (`LEADERBOARD_RULES.md` §7) is a Results-domain, read-time concern, not a generation concern — the Generation Engine is entirely unaffected; a Competition Score Model's stricter Time Cap/Tie-Break rules (`RESULTS_DOMAIN_V1_1.md` §3) plug into the existing Score Model extension points, not into this engine. |
| **HYROX** | HYROX's fixed eight-station structure is a format-composition concern (`SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §4.4, §6.3 — named as Programming's own standing prerequisite, not resolved by this document) plus a "named protocol" reference-data lookup (`FCKB_ARCHITECTURE_REVIEW.md` §12). Once format composition exists, HYROX's per-station Load Profiles and Scaling Profiles use exactly this document's existing mechanisms per station; no new generation or rendering algorithm is required, only a data source (the official HYROX division-weight table) feeding `ruleSet` the same way any other gym's custom Rule Set does. |

This table is this document's own answer to the mission's explicit extensibility question: every named future capability is additive configuration or a dependency on a separately-tracked prerequisite (format composition), never a reason to change §4's core algorithm shape.
