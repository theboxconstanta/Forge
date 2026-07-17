# Workout Composer — Architecture & Philosophy v1

Status: architecture only. No React components, no rendering implementation.
Workout Engine V2 and Workout Intelligence are both frozen inputs here —
this document changes neither.

Success criterion, and the only one that matters: **an athlete should
understand any workout in 2–3 seconds, without reading explanatory text.**
If the athlete has to mentally reconstruct the workout from movement
descriptions, the design has failed, regardless of how clean the code
behind it is.

## 0. The worked example this whole document answers to

Given:

```
50 Cal Row
Then
21-15-9
Thrusters
Pull-ups
Cash-out:
50 Cal Row
```

**Today**, this persists as three `WorkoutSection`-shaped pieces (or, after
the Buy-In/Cash-Out merge, one section whose `formatConfig` holds
`buyIn`/`cashOut`/`mainFormat`) and renders as individual movement cards —
technically correct, cognitively flat. There's no visual signal that "50
Cal Row" appears twice for a *reason*, no signal that Thrusters and
Pull-ups share a rep scheme, no signal that the buy-in and cash-out are
framing rather than the point.

**The Composer's job** is to turn that into something that reads like:

```
BUY-IN
50 Cal Row

21-15-9
Thrusters
Pull-ups

CASH-OUT
50 Cal Row
```

— large, unmistakable "21-15-9" as the thing the eye lands on first; the
two movements underneath it with no repeated rep count; buy-in and
cash-out visually present but clearly secondary framing, not competing
for attention with the main work. Every rule below is in service of
producing exactly this, generically, for every format — not just this
one example.

## 1. Responsibility within the architecture

One job: **`WorkoutSection → ComposedWorkout`**, a pure, stateless
transform. Given a section exactly as Workout Engine V2 already persists
it, produce a small, ordered, coach-native description of how that
section reads — the way a human would actually write it on a whiteboard,
not a rendering of the database record.

Not the Composer's job: logging, scoring computation, PR detection,
editing UI, AI extraction, persistence, or any pixel/typography decision.
If a rule needs any of those, it doesn't belong here.

## 2. Inputs and outputs

**Input**: one `WorkoutSection` in its current, unmodified V2 shape,
plus which scaling variant to compose (RX/Intermediate/Beginner/OnRamp).
No schema change required to use the Composer — see §9 for the one place
where a *small, additive, already-precedented* field would meaningfully
improve output quality, called out explicitly rather than assumed.

**Output**: a `ComposedWorkout` — ordered content **blocks**, each
carrying a semantic `role` (not a raw string), plus **transitions**
between blocks. Never a string, never JSX — a small closed vocabulary any
future consumer (React card, share-image generator, print view, voice
announcer) can consume identically.

```
ComposedWorkout = {
  identity: { name: string | null },        // benchmark/coach-given name, only if present
  primary: { text: string },                 // "21-15-9" / "AMRAP 15" / "5 ROUNDS" / "EMOM 20" - see §3, §7
  blocks: ContentBlock[],
}

ContentBlock = {
  role: 'buy-in' | 'cash-out' | 'main' | 'stage' | 'per-round-addon',
  weight: 'primary' | 'secondary',           // visual hierarchy, see §6 - not a font size
  scheme: string | null,                      // "21-15-9", "5-5-5-3-3-3-1-1-1", null if nothing to hoist (see §9)
  movements: string[],                        // composeMovementLine() output, reps already stripped when hoisted into `scheme`
  transitionBefore: 'then' | 'straight-into' | 'rest' | null,  // null for the first block
  restSeconds: number | null,                 // only when transitionBefore === 'rest'
}
```

`weight` is the same relative-emphasis idea as before, simplified to two
levels because that's what actually reads clearly on a whiteboard:
buy-in/cash-out/per-round-addons are `secondary`, the main/stage work is
`primary`. Nothing here is a font size — see §8.

## 3. The composition pipeline

Five steps, run once per section per variant, each one a concrete answer
to "what would a coach do":

1. **Classify the archetype and find the primary format text.** Not from
   the format's internal name — from its structural shape (§7). For a
   composite (buy-in/cash-out, chained), the primary text comes from the
   *main* block's own shape (`mainFormat`), never from the outer format
   label. A coach never says "this is a Buy-In/Cash-Out" — they say
   "twenty-one fifteen nine," and that's what becomes `primary.text`.
2. **Hoist shared structure.** Before composing individual movement
   lines, check whether the block's movements share a structural fact:
   an identical rep count across every movement, or a structured rep
   sequence on the format's own config (`setsScheme` on Strength Sets,
   `repsScheme` on Ladder). If found, that fact becomes the block's
   `scheme` (rendered once, above the movement list) and is **stripped**
   from each individual movement line — this is the direct fix for
   "Double Unders (50-40-30-20-10) / Sit-ups (50-40-30-20-10)" becoming
   "50-40-30-20-10 / Double Unders / Sit-ups." If no shared structure is
   found, `scheme` stays `null` and movements render as composed lines,
   exactly as today — no guessing, ever (see §9 for the honest limit of
   what's detectable today).
3. **Compose movement lines** for whatever wasn't hoisted, reusing
   `composeMovementLine()` (Workout Intelligence) verbatim.
4. **Attach transitions**, only between blocks, never within one: `then`
   for a normal-rest handoff (buy-in → main), `straight-into` for
   zero-rest chaining, `rest` (with `restSeconds`) when the workout
   explicitly prescribes rest between stages. Phrased at render time as
   "THEN" / "STRAIGHT INTO" / "REST 2:00."
5. **Omit anything the layout already says.** This is a filter, not an
   addition: if a structural fact is already unambiguous from the
   `scheme`/`primary` text as it will be typeset, no block or label
   restates it in words. "50-40-30-20-10" is visually self-evident as a
   descending scheme — the word "Descending Ladder" never appears
   anywhere in the output. The same filter suppresses a `scoreNote`
   whenever the `primary` text already implies it (an AMRAP heading
   already implies "rounds + reps," it gets no redundant footer).

## 4. Grouping rules

- Movements sharing one `scheme` are always one block, never split —
  they're read as one cohesive unit.
- Buy-in and cash-out are their own blocks, `role: 'buy-in'` /
  `role: 'cash-out'`, `weight: 'secondary'` — visually present, never
  competing with the main block for attention.
- A per-round add-on ("after each round: 5 shoulder press @ 80%") is its
  own block, `role: 'per-round-addon'`, `weight: 'secondary'` — never
  folded into a movement's free-text description, where it would be
  invisible to the layout and forced back into prose the athlete has to
  parse.
- Chained stages stay **separate** blocks (`role: 'stage'`), connected by
  `straight-into` transitions — never re-merged into one flat list. This
  is a direct guarantee against reintroducing the exact flattening bug
  the Chained AMRAP fix already solved on the input side; the Composer
  must not undo that on the output side.
- Multiple `WorkoutSection`s (warmup → strength → metcon) stay out of
  scope — the Composer composes the inside of *one* section; V2's
  section boundaries are untouched.
- Scaling variants are alternate **movement fillings of the same
  skeleton** — `primary`, `scheme`, transitions, and block roles don't
  change between RX and Beginner, only `movements` does.

## 5. Ordering rules

- Identity, then `primary`, then blocks in the workout's own authored
  order (buy-in before main before cash-out; stage 1 before stage 2), a
  per-round-addon block placed immediately after the block it modifies.
- Movements within a block: exact stored order, always — never
  alphabetized, never reordered by load. A coach wrote
  thrusters-then-pull-ups on purpose.
- Nothing is ever reordered by "importance" — authored order **is** the
  correct order, by definition.

## 6. Visual hierarchy

Two weights, because a whiteboard doesn't have five:

1. **`primary`** — the thing the eye lands on first: the identity name
   (if any) and the `primary` text ("21-15-9," "AMRAP 15," "5 ROUNDS,"
   "EMOM 20"), plus the main/stage movement blocks.
2. **`secondary`** — everything that frames the main work without being
   it: buy-in, cash-out, per-round add-ons, transition labels. Present,
   legible, unmistakably subordinate.

No third tier for "metadata" or "scoring notes" — §3 step 5 means most of
what would have needed one is omitted outright. If something can't be
omitted and doesn't fit `primary`/`secondary`, that's a signal the
composition rules are missing something, not a reason to add a tier.

## 7. How it stays generic across every format

The mechanism, concretely:

- **The primary heading is a structural fact, never the format's
  internal name.** "AMRAP," "For Time," "EMOM," "5 Rounds" come from
  `family` + `scoreMode`/`rowMode` + the relevant duration/rounds field —
  the same tags the catalog already carries for every format today. The
  literal strings "Buy-In/Cash-Out," "Strength Sets," "Complex," or any
  `type`/section-type label **never** appear as the primary heading —
  those are internal taxonomy, not something an athlete has a mental
  model for. A Complex's heading is "6 SETS" (from its own `rounds`
  config), not the word "Complex." A Strength Sets section's heading is
  the movement name plus its hoisted `setsScheme` ("BACK SQUAT" /
  "5-5-5-3-3-3-1-1-1"), not the words "Strength Sets."
- **Composite formats derive their heading from the *main* block, not
  the outer label.** `family: 'mixed'` sections (Buy-In/Cash-Out, AMRAP
  with Buy-In) never surface their own name as `primary` — the main
  block's own `mainFormat` (or scoreMode) supplies it, exactly per the
  worked example in §0.
- **Field-type-driven, not format-name-driven**, same as before: one
  hoisting/phrasing rule per config field *type* (`repsSchemeList`,
  `duration`, `stageList`), reused by every format that declares a field
  of that type. A new format in a known family, or a new field of a
  known type, needs zero Composer changes.
- **Honest boundary, restated**: `family` alone is coarse (`'mixed'`
  covers structurally different shapes) — archetype classification needs
  `family` plus a look at which structural fields are actually present.
  Still small, still closed, still field-driven.

## 8. How React consumes the composed output

Still architecture, not implementation, but concretely: React never
branches on `format`. It branches on `block.role` and `block.weight` —
a fixed, small set (five roles, two weights) instead of twenty-three
formats. One generic block-rendering component reads `scheme` (if
present, typeset large, above the movement list) and `movements` (a
plain list below it); one generic transition component reads
`transitionBefore` and phrases/styles it by its three possible values;
the top-level component reads `identity`/`primary` and lays out `blocks`
in order. No component ever imports or checks a format id. This is the
concrete payoff of §7: the *number of React components* is bounded by
the block vocabulary (small, closed, already fully enumerated above),
not by the format catalog (23+ and growing). Extending the format
catalog within a known family/field-type therefore requires **zero**
new or modified React components — only the Composer's data-transform
step changes, never the render step.

## 9. An honest limitation, found while designing this — needs a decision

The worked example in §0 assumes "21-15-9" is available to hoist. Checked
against the real data: it usually isn't, yet. `Strength Sets.config.
setsScheme` is genuinely structured (an array of numbers) and hoists
perfectly, always. But the well-known descending schemes this whole
design is anchored on (Fran's 21-15-9, Annie's 50-40-30-20-10) are
tagged format `'For Time'`, not `'Ladder'` — Workout Intelligence's own
prompt deliberately steers the parser that way — and `'For Time'` has no
rep-scheme field in `formatConfig` at all. Today, that breakdown exists
**only** as free-text inside a movement's `notes` (e.g. `"Reps facute
21-15-9 (45 total)"`), if it exists anywhere.

The Composer will not parse that prose to reconstruct "21-15-9" —
regex-scraping a human-written note is exactly the fragile,
non-deterministic guessing this whole project (Workout Intelligence's
"never invent" principle, applied consistently since WI-1) has been
built to avoid, and it would only work for hand-authored fixtures, not
real coach input. Three honest options, not a silent default:

1. **Graceful degradation for `'For Time'`-family formats without a
   structured scheme**: hoist only when the identical-rep-count check in
   §3 step 2 finds something (works when every movement shares one flat
   total), otherwise show composed movement lines as today. Zero data
   change, but "21-15-9" specifically won't appear as a heading for a
   `'For Time'`-tagged benchmark unless its movements happen to share an
   identical total reps count (Fran does: 45/45 — so a *coarser* hoist,
   "45" not "21-15-9", is honestly achievable there; Annie's 150/150 the
   same way).
2. **A small, additive field**, not a new data model: give `'For Time'`/
   `'RFT'`/`'Chipper'` the same `repsScheme` free-text field `'Ladder'`
   already has (`REP_SCHEME_QUICK_OPTIONS` already exists and is already
   wired into the admin editor for exactly this) — a coach or Workout
   Intelligence's mapper fills it in when the scheme is known, the
   Composer hoists it verbatim when present. This is the only way to
   reliably get "21-15-9" specifically (not just the coarser shared
   total) onto the heading for the majority of real benchmark workouts.
3. **Leave it exactly as free text**, surfaced verbatim as a secondary
   caption under the primary heading rather than parsed — honest about
   not being structured, still visible to the athlete.

Recommendation: **option 2**. It's the smallest possible change (one
field, on formats that already have a sibling format with the identical
field), it's the only option that actually delivers the §0 worked
example as written, and it keeps the Composer itself free of any
text-parsing logic. But this is a real, load-bearing decision about
whether "no new data model" tolerates one small additive field — not
mine to make silently.

## Language stays out of the Composer

Blocks carry structured facts (`role`, `scheme`, `restSeconds`), not
pre-baked sentences. Phrasing into RO/EN text ("THEN," "CASH-OUT," "REST
2:00") happens at a thin, separate step taking a `ComposedWorkout` plus
the existing `t.xxx` translations object — the same data/display-string
separation already used throughout the app. The Composer itself never
imports a translation.

## Deliberately deferred, not decided here

- The actual React/typography Renderer (§8 defines the *contract* it
  consumes, not its implementation).
- Cross-section composition (warmup+strength+metcon read together).
- Print/share/voice-specific shaping.
- The full phrasing template library (RO+EN, one per archetype/field
  type) — this pass defines the mechanism, not the catalog.
- The §9 decision — needs your call before any implementation begins.
