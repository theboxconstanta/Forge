# Workout Composer — Architecture & Philosophy v1

Status: architecture only. No React components, no rendering implementation.
Workout Engine V2 and Workout Intelligence are both frozen inputs here —
this document changes neither.

Guiding principle, restated because everything below answers to it:
**the athlete should understand the workout from a single glance.** Any
rule that doesn't serve that gets cut, not kept "for completeness."

## 0. Where this sits, and what it isn't

Two closed milestones feed this one without being touched by it:

- **Workout Engine V2** — the persisted model (`Workout` → `WorkoutSection`,
  each with `format`/`formatConfig`/`movements`/`scoreType`/etc.) stays
  exactly as it is. The Composer reads it, never changes its shape.
- **Workout Intelligence** — the AI pipeline that turns a coach's pasted
  text *into* that persisted model. The Composer is its conceptual
  inverse: the parser goes text → structure, the Composer goes
  structure → human-readable text. Same "parser describes, UI decides
  how to display" principle from the Workout Intelligence spec, applied
  on the output side now instead of the input side.

This codebase already has one rendering step in this space:
`describeFormatConfig()` (`workoutFormats.js`), which walks a format's
catalog config schema generically to produce a compact "Label: value ·
Label: value" summary for places like the Home card, Jurnal, and
Leaderboard. The Composer does **not** replace it — those call sites keep
using it unchanged. The Composer is a new, additive, higher-fidelity
sibling: where `describeFormatConfig` answers "what are the settings,"
the Composer answers "how would a coach actually say this out loud."
Both share the same underlying philosophy (walk the catalog's own field
declarations generically, never hardcode per format) — the Composer
extends that philosophy toward whiteboard-quality phrasing instead of a
settings dump.

**Renderer is a separate, later thing.** The Composer's output is plain,
renderer-agnostic data. Painting that data to pixels (React components,
typography, colors) is explicitly out of scope here, per the request —
a future initiative consumes the Composer's output, it isn't designed yet.

## 1. Responsibility within the architecture

One job: **`WorkoutSection → ComposedWorkout`**, a pure, stateless
transform. Given a section exactly as Workout Engine V2 already persists
it (format, formatConfig, movements, scoreType, benchmarkMetadata,
participation, etc.), produce a small, ordered, renderer-agnostic
description of how that section reads.

Explicitly **not** the Composer's responsibility, the same way these were
carved out of Segment's scope: logging, scoring computation, PR detection,
editing UI, AI extraction/parsing, persistence, or any decision about
fonts/colors/pixels. If a rule would require any of those, it doesn't
belong in the Composer.

## 2. Inputs and outputs

**Input**: one `WorkoutSection`, in its current, unmodified V2 shape,
plus which scaling variant to compose for (RX/Intermediate/Beginner/
OnRamp — see §5). No new fields, no schema change. The Composer must work
with what already exists, because the mandate is explicitly "don't
redesign V2."

**Output**: a `ComposedWorkout` — an ordered list of **presentation
blocks**, each a plain data object from a small, closed vocabulary of
`kind`s. Not a string, not JSX. This is the actual generic contract: any
future consumer (a whiteboard-style card, a shareable image generator, a
print view, a voice announcer reading the WOD aloud) consumes the *same*
small block vocabulary, never format-specific data.

Illustrative shape (informal, not a formal schema — this round is
philosophy, not implementation):

```
ComposedWorkout = {
  identity: { name: string | null },              // benchmark/coach-given name, only if it exists
  blocks: PresentationBlock[],                     // see kinds below
}

PresentationBlock =
  | { kind: 'heading', emphasis: 'primary', text: string }         // "AMRAP 20:00", "5 Rounds For Time", "21-15-9"
  | { kind: 'participation', emphasis: 'secondary', text: string } // "With a partner, splitting reps"
  | { kind: 'movementList', emphasis: 'primary', items: string[] } // composed movement lines, unchanged order
  | { kind: 'connector', emphasis: 'tertiary', text: string }      // "STRAIGHT INTO"
  | { kind: 'bookend', emphasis: 'tertiary', label: string, items: string[] } // "Buy-in", "Cash-out"
  | { kind: 'scoreNote', emphasis: 'quiet', text: string }         // "Score: total reps across all rounds"
```

`emphasis` is a *relative weight tag*, not a font size — it's how the
Composer expresses visual hierarchy (§4) without knowing anything about
typography.

## 3. Composition rules

A small ordered pipeline, run once per section per variant:

1. **Classify the archetype.** Not by format name (23+ values) — by the
   catalog's existing `family` + `scoreMode`/`rowMode` tags, which every
   format already carries today (`workoutFormats.js`). A handful of
   archetypes cover everything: `single-pass` (once through a movement
   list), `repeat-block` (N rounds, optionally with a rep sequence),
   `timed-block` (AMRAP/EMOM/interval-shaped), `composite-block`
   (chained stages or buy-in/main/cash-out — sections whose `formatConfig`
   carries `stages` or `buyIn`/`cashOut`), `open-block` (Not-For-Time /
   Max Effort, no real scheme to state). This mirrors the same
   archetype-vs-format reduction from the Segment discussion, but derived
   at render time from data that already exists, not from a schema
   change.
2. **Compose the heading.** The single most important line — what a
   coach writes *first* on a whiteboard: "AMRAP 20:00," "5 Rounds For
   Time," "21-15-9." One phrasing template per archetype, filled from
   whichever `formatConfig` fields that archetype declares (duration,
   rounds, rep sequence) — never a per-format template.
3. **Compose the movement list.** Reuses the existing, already-proven
   `composeMovementLine()` (Workout Intelligence) verbatim — the Composer
   does not reinvent movement-line phrasing, it consumes it.
4. **Compose structural connectors**, only for `composite-block`: a
   connector between stages with zero rest ("STRAIGHT INTO"), or bookend
   labels for buy-in/cash-out — driven by the same structural fields
   (`stages`, `buyIn`/`cashOut`) already read in step 1, not by a second
   per-format check.
5. **Compose the score note**, only when it adds clarity beyond what the
   heading already communicates (an AMRAP's heading already implies
   "rounds + reps," it doesn't need a redundant footer; a chained
   composite genuinely benefits from "Score: total reps across all
   stages," since that's not obvious from the heading alone).

Governing rule for all five steps: **the Composer never re-derives or
guesses information the data model didn't already commit to a field.**
If a field is missing, the corresponding block is simply omitted — never
filled with a guess. This is the same "populate what's known, never
invent" discipline Workout Intelligence already established, applied to
the output side.

## 4. Visual hierarchy

Expressed as block order + `emphasis`, not pixels:

1. **Identity** (`primary`, highest) — the workout's name, shown only
   when one exists. Never synthesized.
2. **Heading** (`primary`) — the scheme. Always present. The thing a
   coach reads first and the thing that, alone, should already convey
   "what kind of effort is this."
3. **Movement list** (`primary`) — the actual work. Usually the largest
   block on screen, but conceptually subordinate to the heading — you
   read the shape before the specifics.
4. **Connectors/bookends** (`tertiary`) — structural context (stage
   breaks, buy-in/cash-out labels). De-emphasized relative to the
   movement list they frame; they're scaffolding, not the point.
5. **Participation note** (`secondary`) — placed right after the
   heading, before the movement list (see §6), because it changes *how*
   you read the movements, not an afterthought.
6. **Score note** (`quiet`, lowest) — last, smallest, and often absent
   entirely per §3's rule 5.

## 5. Grouping rules

- Movements belonging to one scheme are **always** one `movementList`
  block — never split across blocks, matching how a coach actually reads
  a round of work as one cohesive unit.
- A composite/chained section's stages are **separate** blocks connected
  by `connector`/`bookend` blocks, not merged into one flat list — this
  is the direct fix for the exact bug (flattened, duplicated Chained
  AMRAP movements) that motivated the Workout Intelligence roadmap's
  stage support; the Composer must not reintroduce that flattening on
  the output side after WI-1 fixed it on the input side.
- Buy-in/cash-out bookends are grouped *with* the main work as one
  visual unit, but visually subordinate (`tertiary`) — they frame the
  WOD, they aren't the WOD.
- Multiple `WorkoutSection`s within one `Workout` (warmup → strength →
  metcon) are **not** the Composer's concern — V2's own section
  boundaries are untouched; the Composer composes the inside of *one*
  section at a time. Composing how sections relate to each other is a
  different, later problem, out of scope here by design ("I don't want
  to redesign Workout Engine V2").
- Scaling variants (RX/Intermediate/Beginner/OnRamp) are **alternate
  fillings of the same skeleton**, not separate composed structures: the
  heading/connectors/archetype are variant-independent (the *shape*
  doesn't change between RX and Beginner), only the `movementList`
  content differs per variant. `compose(section, variantKey)` is a
  simple, stateless call per variant — the skeleton reuse falls out
  naturally rather than being a special case the caller has to manage.

## 6. Ordering rules

- Identity, then heading, then participation note, then movement
  list(s)/connectors in the workout's own written order, then score note
  last.
- Stages/bookends are **never reordered** — buy-in first, main, cash-out
  last; stage 1 before stage 2 before stage 3 — always exactly the order
  the workout is structured in. The Composer has no "importance"
  heuristic that overrides authored order.
- Movements within a block: **exact stored order, always.** No
  alphabetizing, no reordering by load or movement pattern. A coach wrote
  thrusters-then-pull-ups on purpose; silently reordering would be a
  real, confusing regression, not a neutral cleanup.

## 7. How it stays generic across every V2 format

This is the actual mechanism, not just an aspiration:

- **Key off `family`, never off the format name.** The catalog already
  tags every one of the 23+ formats with one of five families
  (`scored`/`sets`/`mixed`/`nft`/`chained`) plus finer-grained
  `scoreMode`/`rowMode` values (`amrap`/`fortime_or_amrap`/
  `single_value`, `interval`/`movement`/`round`) — all of this already
  exists in `workoutFormats.js` today, added for the editor, reusable
  as-is for archetype classification. A new format added to an existing
  family+scoreMode combination is composed correctly with **zero**
  Composer changes, the same payoff the Segment discussion aimed for,
  achieved here without touching the data model at all.
- **Walk config fields by declared type, not by name.** The catalog's
  per-format `config` schema already declares each field's `type`
  (`duration`, `movementList`, `stageList`, `repsSchemeList`, `select`) —
  the same declarations `FormatConfigEditor.jsx` already reads generically
  to build its inputs. The Composer has one phrasing rule *per field
  type*, reused by every format that declares a field of that type. A
  format gaining a new field of an already-known type needs no Composer
  change.
- **Honest boundary**: `family` alone is coarse — `'mixed'` currently
  covers both `'Buy-In/Cash-Out'` (a true 3-stage bookend structure) and
  `'AMRAP with Buy-In'` (a single continuous AMRAP with a preamble),
  which read differently on a whiteboard. Archetype classification needs
  `family` *plus* a look at which structural fields are actually present
  (`stages`? both `buyIn` and `cashOut`?) — still a small, closed check,
  still driven by fields the catalog already declares, just not a naive
  one-to-one `family → archetype` lookup. Worth stating plainly rather
  than glossing over.

## 8. Evolving without format-specific rendering logic

- New format, existing family + scoreMode: zero changes (§7).
- New config field, existing declared type: zero changes (§7) — picked
  up automatically by the type-keyed phrasing rule.
- A genuinely new archetype (a structural shape never seen before):
  exactly one new archetype-detection rule plus one new heading-phrasing
  template, additive, touching nothing existing — the same
  "one contained addition, not a cross-cutting ripple" property the
  Segment design aimed for, achieved here purely at the presentation
  layer.
- **Testing collapses the same way coverage does**: validate with one
  representative fixture per *family* (five, not twenty-three), plus a
  couple of live checks per family against real formats — mirroring how
  `describeFormatConfig` and the Workout Intelligence mapper are already
  tested in this codebase, not a new testing philosophy.

## Language is a rendering-time concern, not the Composer's

This codebase is bilingual (RO/EN, `translations.js`, the `t.xxx`
pattern used everywhere). The Composer's blocks should carry **structured
facts** (archetype, duration, rounds, rep sequence), not pre-baked
English or Romanian sentences — phrasing into an actual language string
happens at a thin, separate step that takes a `ComposedWorkout` plus a
`t` translations object, the same separation of data and display strings
already used throughout the rest of the app. This keeps the Composer
itself language-agnostic and keeps translation additions from ever
requiring a Composer change.

## Illustrative examples (composition only, no visual design)

**AMRAP** ("AMRAP 20 minutes: 5 Pull-ups, 10 Push-ups, 15 Air Squats"):
heading `"AMRAP 20:00"` → movementList `["5 Pull-ups", "10 Push-ups", "15 Air Squats"]`.
Reads in one glance: what kind of effort, for how long, doing what.

**Descending ladder / Fran-style** (21-15-9 Thrusters/Pull-ups):
heading `"21-15-9"` → movementList `["Thrusters @ 43/30kg", "Pull-ups"]`.
No separate "rep scheme" footer — it's already in the heading, exactly
how a coach would actually write it.

**Chained AMRAP** ("Jack's Triangle"): identity `null` → heading
`"Chained AMRAP"` → block 1 (heading `"AMRAP 2:00"`, movementList
`["Max Deadlifts @ 100/70kg"]`) → connector `"STRAIGHT INTO"` → block 2
(heading `"AMRAP 19:00"`, movementList of 4 items) → connector
`"STRAIGHT INTO"` → block 3 (identical to block 1, kept separate, not
merged) → scoreNote `"Score: total reps across all 3 rounds"`.

**Buy-In/Cash-Out**: bookend `"Buy-in"` (movementList `["50 Cal Row"]`,
tertiary) → heading `"21-15-9"` (primary) → movementList (primary) →
bookend `"Cash-out"` (movementList `["50 Cal Row"]`, tertiary). The main
set visually dominates; the bookends read as framing, matching how a
coach would actually emphasize it out loud.

**Partner WOD**: participation `"With a partner, splitting reps as you like"`
placed right after the heading, before the movement list — because it
changes how the reader interprets everything that follows.

## Deliberately deferred, not decided here

- The actual React/typography layer (the "Renderer" proper) — a
  separate, later initiative, consuming `ComposedWorkout` as its input.
- Cross-section composition (how warmup/strength/metcon read together as
  one class) — out of scope, V2's section boundaries are untouched.
- Print/share/voice-specific output shaping — same `ComposedWorkout`,
  different future consumers; not designed yet.
- The exact phrasing template library (one per archetype × field-type
  combination, in both RO and EN) — this spec defines the *mechanism*
  (§3, §7, "language is rendering-time"), not the full template catalog;
  that's implementation, deliberately not done in this pass.
