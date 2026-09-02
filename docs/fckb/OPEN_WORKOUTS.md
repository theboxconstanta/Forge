# FCKB — CrossFit Open Workouts

## Honesty Disclosure — Read This Before Using This Document

This document requires a materially different confidence standard than `BENCHMARK_WORKOUTS.md` and `HERO_WORKOUTS.md`. The Girls and Hero workouts are long-stable, extremely-widely-republished, decade(s)-old facts I have high confidence recalling precisely. **CrossFit Open workouts are a different kind of fact**: ~60-90 distinct, individually-announced competitive events spread across 15+ years (2011–present), each with precise rep schemes, movement standards, weights, and time caps that were announced once per year and are the basis for real, live leaderboard scoring — getting these details wrong isn't a stylistic imperfection, it's presenting fabricated competitive-history data as fact in a system whose stated purpose is to be a *canonical, production, 10-year reference*.

I do not have reliable, verified recall of the precise details for the full Open catalog, and I will not fabricate specific rep schemes, weights, or movement lists for workouts I'm not genuinely confident about, even though that means this document is the least "complete" of the nine deliverables relative to the source architecture's "all official seasons" target. This is a direct application of the mission's own instruction — correctness over hitting an arbitrary completeness bar — and I'd rather deliver an honestly partial document here than a confidently-wrong one, given the real-world stakes of Open data specifically (it underpins competitive standings and PR history that real athletes care about being accurate).

**What Forge should actually do**: treat the full Open workout archive as a data-IMPORT task from CrossFit's own official Games site/API (which maintains the authoritative, complete historical record), not as content to be authored from an LLM's training-data recall. This document provides the STRUCTURAL framework FCKB needs to correctly INGEST that imported data (Section 1-2), plus a small number of individual workouts I have genuine, high confidence in (Section 3), clearly separated from the rest.

---

## 1. Structural Facts (High Confidence)

- **Naming convention**: `[2-digit year].{workout number within that season}` — e.g. "24.1" is the first workout of the 2024 Open season. This is a completely mechanical, reliable naming pattern the parser can rely on with high confidence, independent of the underlying workout CONTENT.
- **Annual cadence**: the Open has run every year since 2011, making 2026 (Forge's current operating year) approximately the Open's 16th season.
- **Workout count per season**: has varied across the Open's history — earlier seasons (early-to-mid 2010s) commonly ran 5 workouts across 5 weeks; later seasons have run fewer (as few as 3) across a shorter window. The exact count is season-specific and should be sourced per-season from the official archive rather than assumed constant.
- **Divisions & Scaling**: every Open workout is published with (at minimum) an RX and a Scaled version, and in more recent seasons also age-group/adaptive divisions — meaning a single `open_workouts.canonical_definition` (per the source v1.0 schema's implied single-definition-per-workout shape) is almost certainly insufficient; this connects directly to the multi-variant/scaling-level modeling need already established in Forge's own production Programming domain (`wods.movements_rx`/`_intermediate`/`_beginner`/`_onramp` — see `PROGRAMMING_DOMAIN_ARCHITECTURE.md`) and should reuse that same pattern rather than inventing a new one.
- **Submission/scoring model**: Open workouts are scored and submitted through CrossFit's own official leaderboard system — FCKB's role is to hold the CANONICAL WORKOUT DEFINITION (movements, format, standards) for parsing/recognition purposes, not to replicate the leaderboard/scoring-submission infrastructure itself, which is out of FCKB's scope entirely (a scope boundary worth stating explicitly, matching the same reasoning `WORKOUT_FORMATS.md` Section 11.3 applied to Points-based competition scoring generally).
- **Movement standards documents**: each Open workout is published alongside a detailed MOVEMENT STANDARDS document (exact rep-counting rules, no-rep criteria, judging standards) separate from the workout description itself — this is a real, additional layer of structured content beyond what `canonical_definition` alone captures, and is likely significant enough to warrant its own field or related table (`workout_movement_standards`) rather than being folded into free-text `canonical_definition`.

## 2. Format Patterns Observed Across Open History (General, Not Year-Specific)

Without claiming precise recall of individual years, some structural PATTERNS are well-established and safe to state generally:

- Open workouts are overwhelmingly For Time, AMRAP, or (less commonly) a multi-part combination of the two (e.g. an AMRAP with a Max Load finish) — consistent with `WORKOUT_FORMATS.md`'s general taxonomy, not requiring any Open-specific format additions beyond what's already cataloged there.
- Later-era Open workouts (roughly the past several seasons) have trended toward including a **time cap with a "if you finish, proceed to the next part" escalating structure** — e.g. a workout where reaching a certain point within a time window unlocks additional, harder work, functioning similarly to the Multi-Part Workout format (`WORKOUT_FORMATS.md` Section 11.1) but compressed into a single continuous score rather than separately-scored parts. This is a real, distinctive Open-era pattern worth flagging even without pinning it to a specific year.
- Dumbbell movements (DB Snatch, DB Hang Clean and Jerk) and Wall Balls have been recurring, frequently-reused movement choices across many recent seasons — a real pattern in movement selection frequency, though I'm not confident enough in which SPECIFIC years to attribute this to individually stated workout numbers without risking a wrong attribution.

## 3. Individual Workouts I Have Genuine, High Confidence In

A deliberately small list — included because I'm specifically confident in these, not as a representative sample of what a complete document would contain.

| Workout | Format | Structure | Confidence Note |
|---|---|---|---|
| **14.5** | For Time | 21-15-9 reps of: Thrusters (43/30kg), Bar-Facing Burpees | High confidence — this is one of the most-referenced individual Open workouts in general CrossFit discourse (a "Fran-with-burpees-instead-of-pull-ups" structure using the classic 21-15-9 scheme), commonly used informally as its own benchmark independent of Open-season context. |

That is the extent of what I'm willing to state with genuine confidence as a specific, precisely-detailed individual Open workout in this document. Every other Open workout I could attempt to recall carries meaningfully lower confidence on the EXACT numbers (rep counts, specific loads, time caps) than I'm willing to present as settled fact in a canonical reference — the risk of a subtly-wrong number (e.g. misremembering 15.5 vs. 16.5, or transposing a rep scheme from one year to another) is real and, per this document's own opening disclosure, not a risk worth taking here.

## 4. Recommended Path to Real Completeness

1. Source the full, precise Open workout archive directly from CrossFit's own official Games site/API rather than LLM recall — this is a data-import/licensing/attribution task, not a research-writing task, and belongs to a different phase of FCKB's build-out than this document.
2. Once imported, apply this document's Section 1 structural framework (naming convention, RX/Scaled/age-group variant modeling reusing Forge's own existing `wods` scaling-level pattern, separate movement-standards content) to structure the imported data correctly.
3. Cross-reference imported Open workouts against `MOVEMENT_CATALOG.md`/`MOVEMENT_ALIASES.md` to confirm movement-name coverage — Open workouts have, historically, occasionally introduced genuinely novel movement combinations or standards not seen in affiliate-level programming (e.g. specific complex-and-carry combinations), which may surface real gaps in the movement catalog once real Open text is run against it, distinct from anything this document can predict in advance without the actual source text in hand.

## 5. Missing / Gap Notes

This document does not meet the source v1.0 architecture's "all official seasons" target, and says so plainly rather than padding toward it. This is the one document in this whole research package where I judged that PARTIAL, HONEST coverage is the correct deliverable over confidently-stated but unverifiable completeness — directly following the mission's own stated priority ("correctness and completeness" together, not completeness alone, and explicitly: "do not fabricate to hit a number").
