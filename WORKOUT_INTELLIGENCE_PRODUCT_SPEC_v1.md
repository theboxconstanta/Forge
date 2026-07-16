# Workout Intelligence — Product Specification v1

**Status: APPROVED as the v1 product vision (2026-07-16).** Phase 0
(Product & Architecture Discovery) is closed. No code, no schema, no
deployment has happened under this initiative — this remains a design
document. Built on top of Workout Engine V2 (Phases 0–8, closed
2026-07-16), which is now Forge's primary architecture. The
Transcription-Assistant-vs-Programming-Advisor distinction below is
confirmed as the framing to carry through the entire roadmap, not just
this document — Programming Advisor is the real long-term product;
Transcription Assistant is only its entry point.

---

## Product Vision

Workout Intelligence is not "an AI that writes workouts." It's the system
that removes the clerical tax of turning a coach's programming into
structured data, so every minute a coach spends in Forge goes toward
programming judgment, not data entry — and, over time, gives coaches a
view of their own programming that no CrossFit platform currently offers,
because none of them structured the data well enough to earn it.

Two distinct jobs live under this one name, and conflating them would be
the single biggest mistake we could make:

- **Job 1 — Transcription Assistant** (the wedge, V1): turn free text a
  coach already wrote into a correctly structured, fully-populated
  Workout Sections draft. Format detection, movement canonicalization,
  scaling drafts. This is parity work — every competitor will eventually
  ship something like this. It's necessary, not differentiating.
- **Job 2 — Programming Advisor** (the moat, V2+): reason across a gym's
  *history* — logged performance, movement rotation, energy-system
  balance, benchmark cadence — because Workout Engine V2 is the first
  time this gym's programming has ever existed as structured, queryable
  data instead of free text in a `wods.type` column. This is what actually
  differentiates Forge, and it was structurally impossible before this
  migration.

**Challenge to the framing as given**: the brief centers Workout
Intelligence on the create → review → publish loop. I'd push back gently
on treating that loop as the whole product. If we design V1 narrowly
around "the paste flow," we risk building confidence-signal and insight
surfaces that don't naturally extend to a calendar-level view later. My
recommendation: scope the *vision* at "Programming Intelligence" altitude
from day one — a system that understands a gym's full programming
reality — even though V1 *ships* only the transcription assistant. Build
the smallest thing (Job 1), but don't paint it into a corner that makes
Job 2 (the actual moat) awkward to add later.

---

## Design Principles

0. **Workout Intelligence exists to make coaches better, not to replace
   them.** Every capability we ship should increase a coach's confidence,
   speed, or programming quality while leaving the final decision entirely
   in human hands. This is the north star every other principle below is
   in service of — when a proposed feature is unclear, this is the test
   it has to pass.
1. **The coach is the editor of record. The AI is a draft generator.**
   Nothing the AI produces is final until a human looks at it in the same
   editor they'd use to write it by hand.
2. **Same editor, not a second mode.** The AI populates the Native Section
   Editor that already exists (Phase 6). There is no separate "AI screen."
   A coach who never touches the AI feature and one who uses it every day
   should feel like they're using the same product.
3. **Uncertainty is shown, never hidden.** A confident-looking wrong guess
   is worse than a visible gap. The AI should mark what it isn't sure
   about, not paper over it.
4. **Nothing is AI-owned forever.** The moment a coach edits a
   field, it's theirs. The AI never "corrects" a human edit back to its
   own suggestion. Once published, a workout carries zero visible trace
   of having been AI-assisted — this was already decided in Workout
   Engine V2's schema design (`metadata`/`benchmark_metadata` explicitly
   exclude AI provenance — "once the coach saves, the WOD is theirs, it
   doesn't carry marks of having gone through AI"). Workout Intelligence
   inherits and must not violate that decision.
5. **Never block. Always suggest.** No modal, no gate, no "are you sure"
   dialog stands between a coach and publishing. The AI's job is to
   surface signal, not to enforce its own judgment over the coach's.
6. **The manual path is never second-class.** Every AI capability must
   have a fully-supported, undiminished manual equivalent, forever. AI
   adoption should be a convenience a coach opts into, not a lane the
   product quietly funnels people down.
7. **Gym-scoped, never cross-gym.** Multi-tenant isolation (already the
   ambient pattern in this codebase) extends to intelligence: a gym's
   programming patterns, movement vocabulary, and logged history never
   inform suggestions for another gym.

---

## The Coach Journey

**1. Paste.**
Coach pastes free text into the existing box — no format required, no
"tell the AI what kind of workout this is." Works exactly as it does
today (`analyzeWorkout`, already built, currently disconnected — this is
the wiring work of V1).

**2. Draft appears — inside the editor, not beside it.**
The AI's output populates the Native Section Editor as a pre-filled draft:
sections, format, movements (canonicalized), scaling variants, benchmark
recognition. Every field is a normal, editable field. There is no "accept
AI suggestion" button per field — there's just the editor, already filled
in, exactly as if the coach had typed it themselves, just faster.

**3. Review — guided by confidence, not by faith.**
This is the step that doesn't exist in the current parser and is the real
product work of V1. Fields the AI is unsure about (unresolved
`canonicalName`, ambiguous format, no explicit weight found in text,
inconclusive benchmark match) carry a small, quiet visual marker — a dot
or badge inside the existing section card, not a separate panel, not a
red error state. The coach's eye goes straight to the handful of things
worth a second look instead of re-verifying all fifteen fields from
scratch. This is the single highest-leverage design decision in this
whole spec: it's the difference between "the AI did something to my WOD"
(anxiety-inducing) and "the AI flagged three things for me to check"
(trust-building).

**4. Edit.**
Identical to today's manual editing — same components, same
`FormatConfigEditor`, same movement search, same variant cards. No new
UI to learn.

**5. Publish.**
Identical to today's publish flow. AI involvement ends the moment the
draft was generated; publish is entirely the existing, human-owned
action, unchanged.

---

## AI Responsibilities

- Detect workout format from free text.
- Canonicalize movement names (already built — alias/plural resolution
  exists in `movementCatalog.ts`, just needs to reach the persisted
  section).
- Draft scaling variants (RX baseline + Intermediate/Beginner/OnRamp)
  from explicit scaling text in the source, when present.
- Recognize known benchmark/hero WODs.
- Flag its own uncertainty, field by field.
- (V2+) Notice patterns across a gym's own history: recent duplicate
  workouts, benchmark retest timing, movement-pattern repetition,
  scaling-weight outliers relative to the gym's own historical range.
- (V2+) Learn a gym's own vocabulary (custom section types, naming
  conventions) rather than only platform defaults.

## Human Responsibilities

- Decide whether to use the AI at all, per workout.
- Review and correct every field before publishing — the AI never
  publishes.
- Own all scaling, weight, and format decisions, always. The AI proposes
  from text; the coach owns the training decision this represents.
- Decide whether a "programming insight" (V2+) is acted on or dismissed —
  insights are observations, never instructions.
- Remain the sole author of record. Nothing downstream (Member View,
  Journal, Leaderboard) will ever indicate a workout was AI-assisted.

---

## UX Philosophy

- **Voice**: terse, factual, dismissible — matching Forge's existing
  product tone throughout this codebase (no chatbot persona, no
  "I think..." conversational framing, no exclamation-point enthusiasm).
- **Placement**: confidence signals live inside the section cards the
  coach is already looking at, not in a separate AI sidebar or modal.
- **Degradation, not error**: an uncertain field looks like an *empty*
  field the coach would've had to fill in anyway — never a red banner
  implying something went wrong.
- **No permanent AI marks**: once published, there is no badge, icon, or
  metadata anywhere downstream indicating "this WOD was AI-assisted." It
  is simply the coach's workout.
- **Insights (V2+) are opt-in surfaces, not ambient nagging**: a
  dedicated "Insights" view a coach visits when they want it, never
  injected into the moment-to-moment act of writing today's workout.

**Visible**: the structured draft itself; field-level confidence markers;
a short, terse "what I understood" summary (e.g. "AMRAP 20:00, primary
section, 3 scaling levels detected") for orientation, not narration.

**Invisible**: model internals, confidence scores as raw numbers, prompt
details, AI provenance/timestamps on the persisted record — consistent
with the decision already made in the V2 schema.

---

## Feature Roadmap

**V1 — Transcription Assistant** (wire what's already built + the new
review layer):
- Connect `analyzeWorkout()`'s response to the Native Section Editor's
  state (currently `console.log`-only — this is the actual gap).
- Field-level confidence/uncertainty markers (net-new — doesn't exist in
  the current schema or UI at all).
- Movement canonicalization surfaced and editable, not silently applied.
- Existing benchmark fast-path (10 well-known WODs) surfaced in the
  review step ("Recognized: this looks like Fran").

**V2 — Gym-Aware Assistant**:
- Learn the gym's own historical scaling-weight ranges; flag outliers
  rather than platform-generic ones.
- Per-gym movement vocabulary and custom section types (the
  `workout_section_types`/`workout_scaling_levels` tables already exist
  for exactly this and are currently unused).
- Duplicate/near-duplicate workout detection within a recent window.
- Benchmark retest cadence awareness, gym-specific.

**Long-term — Programming Advisor**:
- Calendar-level view: movement-pattern balance, energy-system rotation,
  volume/intensity trend over weeks/months.
- Correlate structured section metadata (difficulty, energy system)
  against *actual logged results* — possible for the first time because
  Phase 8 gave `wod_logs`/`skill_logs` a real FK to the section they were
  logged against, not just a legacy `wod_id`.
- Proactive, opt-in nudges surfaced before a coach opens the editor
  ("no pulling-dominant day in 9 days"), living in the Insights surface,
  never blocking workout creation.
- Multi-coach consistency tooling for gyms with programming teams.
- (Careful, much later, possibly never): member-facing personalization —
  see Risks below. Full natural-language program generation ("write me a
  4-week strength cycle") — same caveat.

---

## Future Opportunities Unlocked Specifically by Workout Engine V2

These didn't exist as options before this migration — worth naming
explicitly, since they're the actual argument for why Workout
Intelligence is buildable *now* and wasn't before:

- **There was nowhere to put this data before.** `workout_sections.metadata`
  and `benchmark_metadata` give AI-computed insight (difficulty, energy
  systems, coaching cues) a real, structured, queryable home for the
  first time. Against the old `wods` fixed-column model, this would have
  meant an unstructured text blob or schema abuse — now it's a real
  column with real shape.
- **Logged performance can finally be correlated to section metadata.**
  Phase 8's `workout_section_id` FK on `wod_logs`/`skill_logs` means a
  future Programming Advisor can ask "how did members actually perform
  against high-difficulty AMRAP sections" — structurally impossible
  before Phase 8, since logs only ever pointed at a legacy `wod_id`.
- **Per-gym vocabulary infra already exists, unused.**
  `workout_section_types`/`workout_scaling_levels` were built in Phase 0
  of Workout Engine V2 with zero real consumers today. Workout
  Intelligence's V2 (gym-aware) tier is the first real reason to wire
  them in.
- **Multi-tenant isolation is already the ambient pattern.** No new
  data-isolation design is needed for "don't leak one gym's patterns
  into another's suggestions" — `gym_id` scoping is already enforced
  everywhere via RLS.
- **The `validateSectionsForLegacy` gate becomes a real forcing function.**
  Today it caps the editor at ≤3 non-primary sections so Member View and
  Logging can still fall back to the legacy 4-column model. An AI that
  can genuinely detect 5+ distinct sections in a complex training day
  would have its own output artificially truncated by a debt item from a
  separate initiative (Workout Engine V2's own closed backlog). This
  doesn't have to be solved now, but Workout Intelligence is the
  strongest argument yet for eventually prioritizing that removal.

---

## Risks

- **False confidence.** The single biggest trust risk: an AI that
  guesses a scaling weight or movement match and presents it with the
  same visual weight as a certain field. Mitigated by principle #3
  (uncertainty always visible) — but this has to be enforced rigorously
  in implementation, not just stated as a value.
- **Silent correction of human edits.** If the AI ever re-applies its own
  suggestion over something a coach already changed, trust breaks
  immediately and permanently for that coach. Must be an absolute rule,
  not a "best effort."
- **Feature creep into member-facing automation.** The line "assist
  coaches, never replace them" is easiest to hold for workout creation
  and hardest to hold once Programming Advisor data exists — it becomes
  tempting to auto-suggest scaling for an individual member from their
  logged history. That is coaching a member, not assisting a coach, and
  should require explicit, deliberate, separate product approval before
  ever being built — not an assumed extension of this roadmap.
- **Insight fatigue.** A Programming Advisor that surfaces too much,
  too often, degrades into the same ignored-notification problem every
  analytics dashboard eventually has. Insights should be sparse, opt-in,
  and genuinely actionable, not a constant feed.
- **Multi-coach gyms diluting trust.** If one coach on a team edits every
  AI draft heavily and another accepts everything blindly, the "coach
  stays in control" principle is only as strong as the weakest individual
  workflow — worth watching once Forge's multi-tenant, multi-coach gyms
  start using this, not just solo-owner gyms like CrossFit C15 today.
- **Cost/latency at scale.** Real OpenAI calls (already wired, Phase
  "2C") have a per-request cost and latency; a Programming Advisor that
  runs proactively across many gyms' full histories is a very different
  cost profile than a single on-demand paste-and-parse call. Worth
  sizing before V2 commits to always-on background analysis.

---

## Open Questions

1. Should confidence markers be binary (flagged / not flagged) or
   graduated (e.g. "low / medium confidence")? Binary is simpler and more
   in keeping with the "terse, dismissible" voice principle — graduated
   risks becoming its own thing to interpret. Leaning binary, but worth
   deciding deliberately rather than defaulting to whatever the model API
   naturally returns.
2. Where does "AI Insights" live in the navigation once V2/long-term
   ships? A new bottom-nav tab risks over-promoting it beyond its
   opt-in, occasional-use nature; buried in Admin settings risks nobody
   finding it. Needs its own placement decision, not an assumption.
3. Should Workout Intelligence ever become a per-gym *opt-out* default
   (on by default, gym can disable) or should it always start opt-in per
   gym/coach? Given "the manual path is never second-class" as a
   principle, opt-in-by-default feels safer for trust, but slower for
   adoption — worth a real product decision, not an implementation
   default.
4. For multi-coach gyms: should the AI's uncertainty-flagging behavior be
   per-coach configurable (some coaches want more hand-holding than
   others), or one gym-wide setting? Unclear which serves real coaching
   teams better without talking to one.
5. Is there a version of "photo of a whiteboard" or voice-dictation input
   worth prototyping earlier than "long-term," given how much CrossFit
   programming genuinely starts on a literal whiteboard? Flagged as
   long-term above, but worth revisiting once V1's paste-based flow has
   real usage data — it might turn out to be the more-used entry point
   than pasted text ever was.

---

## V1 (Transcription Assistant) — Proposed Implementation Phases

*Revised 2026-07-16: WI-1 now delivers the complete first user-facing
experience in one phase, not a mapping-only slice — per direction that
the "wow moment" (paste → analyze → populated, review-ready draft) must
land as a single, whole experience, not spread across several releases a
coach would never see the point of individually.*

Design only — no code has been written yet. This breakdown still keeps
the discipline every Workout Engine V2 phase had (independently
validated, reversible increments) — it's just that the *first* increment
is now sized to be the whole coach-facing moment, with the smaller,
purely-internal concerns (re-analysis safety, full rollout validation)
following it as their own phases.

**Two architectural facts driving WI-1**, surfaced now so they don't get
discovered mid-implementation:

- The AI's `sections` output (rich objects: `{name, canonicalName, reps,
  weight, distance, ...}` per movement) and the Native Section Editor's
  local form state (Phase 6 — movements as plain text lines, e.g. inside
  a newline-separated `text`/`variants[key].movements` string) are
  **different shapes**. Wiring the AI response into the editor isn't a
  copy — it requires composing structured movement objects back into the
  same text-line format the editor and `legacyPayloadFromSections`
  already expect. This is real, new, pure-function work, not "connect A
  to B."
- No review-signal concept exists anywhere today — not in the edge
  function's schema, not in the domain model, not in the UI. Per
  direction, this stays deliberately simple for V1: no confidence scores,
  no graduated levels, just a small fixed set of flag *reasons* (unknown
  movement, ambiguous format, missing weight, missing distance,
  unresolved benchmark, and a catch-all for anything else the parser
  couldn't determine) — derived heuristically from signals the schema
  already returns (`canonicalName: null`, missing weight/distance
  fields, a fallback/default format, `isBenchmark` inconclusive). No
  edge-function or prompt changes needed for this.

**WI-1 — Paste-to-Draft: the complete coach experience.**
Everything a coach needs for the full "wow moment," as one phase:

1. **AI Draft → Editor Mapping.** A pure `sectionsFromAiAnalysis(analysis)`
   function (same pattern as `sectionsFromLegacyWod`), composing the AI's
   structured movements into the editor's text-line shape.
   `analyzeWorkout()`'s success handler calls `setWodSections(...)` with
   it instead of `console.log` — the Native Section Editor is populated
   automatically, no extra click, no intermediate screen.
2. **Lightweight review signals.** A pure `deriveReviewFlags(analysis)`
   function producing the small fixed set of flag reasons above, surfaced
   as simple, non-blocking, inline markers directly on the affected
   fields in the existing section components — no separate panel, no
   summary screen, no scoring. A coach's eye should land on exactly the
   handful of things worth a second look within a couple of seconds of
   the draft appearing.
3. **Minimal re-analysis behavior** (just enough to be safe, not the
   full policy): clicking "Analizează" again while a draft already exists
   overwrites it — acceptable for this phase given real usage will start
   as a single coach reviewing their own drafts — but this is explicitly
   a placeholder, not a decided policy; WI-2 below is where the real
   safeguard gets designed and built.

**Acceptance bar for WI-1** (the concrete "done" test, not just a vibe):
a coach pastes a realistic workout, clicks Analizează, and within a few
seconds has a draft that is **approximately 95% complete and immediately
ready for review** — correct format, correct sections, movements
recognized, scaling drafted, with only the genuinely uncertain handful of
fields flagged. Validated with a representative fixture set (AMRAP, For
Time, Complex, Chained AMRAP, a recognized benchmark, and at least one
deliberately messy/ambiguous input) both as unit tests for the two pure
functions and as a live, real-editor pass in local dev before this phase
is considered done.

**WI-2 — Re-analysis Safety.**
Decide and implement the real policy for re-clicking "Analizează" over an
already-edited draft (replacing WI-1's placeholder overwrite-always
behavior). This protects "nothing is AI-owned forever" (principle #4) —
a destructive action distinct from "never block publish" (principle #5),
since it blocks nothing about publishing, only protects against silently
discarding a coach's already-started edits.

**WI-3 — Live Validation + Rollout.**
Full validation pass across format diversity, local dev then production,
with direct DB confirmation of published results — same rigor as every
Workout Engine V2 phase, including cleaning up any test data from the
shared database before closing the phase.

No phase here has been started or approved for implementation. Next step
is your review of this breakdown — adjust, reorder, or approve before any
code is written.
