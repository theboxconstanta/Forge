# Segment Domain Model — Specification v1

Status: domain model only. No AI schema, editor UI, renderer, or logging-model
decisions are made here — those are explicitly deferred and must be *derived*
from this spec, not the other way around.

## 0. Position in the frozen hierarchy

```
Workout
  └── WorkoutSection
        └── Segment tree
              └── Movements
```

**WorkoutSection owns identity**: what this is, whether/how it's loggable
(`loggingMode`), how it's scored (`scoreType`), how it's scaled
(`scalingVersions`), who does it (individual/partner/team), where it sits in
the class (type, order), benchmark/hero naming.

**Segment owns shape**: how the prescribed work inside one section is
organized in time — once, rounds, AMRAP, interval, a rep sequence, a
composite of parts with rest between them.

Dividing line, restated as the rule for any future ambiguous case: *if it
affects who logs it, how it's scored, or how it's scaled → WorkoutSection.
If it affects how the work is organized in time → Segment.*

---

## 1. What is a Segment?

A Segment is the recursive unit that describes **temporal/structural
arrangement of prescribed work**, scoped to exactly one WorkoutSection. It
answers "what has to happen, and in what order/repetition" without
committing to *which* scaling level's movements or loads are involved —
those are attached separately (§7–§8). A Segment is either:

- a **leaf** — an atomic block of work: "do these movements" under one
  repetition scheme, or
- a **composite** — an ordered arrangement of child Segments, related by a
  rest rule, with a declared way of combining their results into one.

A Segment tree lives entirely inside one WorkoutSection. No Segment is ever
shared between sections, and no Segment object is ever referenced from more
than one place in the tree (see §9, Invariant 12) — it is a tree, not a
graph.

## 2. Segment types

Exactly two kinds, by design — this is the whole point of the compositional
model. New workout "formats" must be new *values* of `scheme` or new
*combinations* of existing kinds, never a third kind:

- `kind: "leaf"`
- `kind: "composite"`

## 3. Properties on every Segment

| Property | Type | Meaning |
|---|---|---|
| `id` | string | Stable, unique within this WorkoutSection's tree. Addressing target for scaling overrides (§8), logging, and incremental AI updates. |
| `kind` | `"leaf" \| "composite"` | Discriminator. |
| `label` | string, optional | Short coach-facing name ("Buy-in", "Stage 1"). Not required on a lone root segment (the WorkoutSection's own title already names it), but recommended on every composite child. |
| `notes` | string, optional | Freeform escape hatch for anything that doesn't decompose structurally. Valid at any level, in addition to whatever structure *is* captured. |
| `scheme` | Scheme (§ schema) | How many times / for how long **this segment's own content** repeats. For a leaf, that's its movements. For a composite, that's its whole child sequence as a unit (e.g. "3 rounds of [buy-in-style leaf, cash-out-style leaf]" is a composite whose own `scheme` is `rounds(3)`). |

`scheme` is intentionally common to both kinds — a leaf's scheme governs its
movements, a composite's scheme governs its child sequence as a whole. This
is what lets a composite itself repeat as a unit without needing a third
node kind or artificially duplicating identical children N times.

## 4. Composite-only properties

| Property | Type | Meaning |
|---|---|---|
| `children` | Segment[], min 2 | Ordered, full recursive Segments (never id-references — see §6). |
| `restBetweenChildren` | `0 \| seconds \| "as-programmed"` | `0` = chained / "straight into" with no rest. A number = explicit prescribed rest. `"as-programmed"` = normal, unspecified transition (coach's implicit judgment, the common default). |
| `primaryChildId` | string, optional | Which direct child's result *is* the section's score. Required when `resultCombination` is `"primary-only"`. |
| `resultCombination` | `"sum" \| "primary-only" \| "best-of" \| "last"` | How the children's individual results combine into the section's one score. |

A composite with fewer than 2 children isn't composing anything — see
Invariant 4.

## 5. Leaf-only properties

| Property | Type | Meaning |
|---|---|---|
| `movements` | Movement[] | The **canonical (RX)** movement content for this leaf. Reuses the existing Movement shape unchanged (name/canonicalName/reps/weight/distance/calories/equipment/notes). |
| `unbroken` | boolean, optional | Annotation that this leaf's movements must be performed as one continuous unit (complexes). Presentation/coaching metadata, not scoring-relevant. Never valid on a composite (Invariant 10) — a composite already represents temporally distinct, potentially rested pieces, so "unbroken" is meaningless at that level. |

A leaf must have at least one of {non-empty `movements`, non-empty
`notes`} — never a completely empty leaf (Invariant 3).

## 6. How child Segments are represented

Inline, recursively, as an ordered array (`children: Segment[]`) — never by
id-reference. This is a deliberate structural choice, not an
implementation detail: representing children inline makes **cycles
unrepresentable by construction** (§9 guarantees), keeps traversal trivial
for every downstream consumer (AI writer, editor, renderer, validator), and
matches how a coach actually thinks about a composite workout — as *this,
then this, then this*, not as a set of named pieces wired together by
pointers.

## 7. How movements attach to leaf Segments

Directly, as `movements` on the leaf itself (§5), and this is the
**canonical / RX** definition — the tree's own "base truth." This mirrors
how RX already works elsewhere in the platform: it's the complete
definition, and other scaling levels are described as substitutions
against it, not as independent, redundant definitions.

## 8. How scaling variants reference leaves

**Not** by duplicating the tree. A scaling variant is a sparse override
map, scoped to the WorkoutSection (outside the Segment tree entirely — the
tree itself has no notion of "variants," keeping §0's dividing line clean):

```
ScalingOverrides: {
  [variantName]: {                 // "intermediate" | "beginner" | "onramp" (never "rx" — RX is the tree itself)
    [leafSegmentId]: {
      movements?: Movement[]        // replaces the leaf's RX movements for this variant
      repSequence?: integer[]       // replaces scheme.repSequence for this variant, if the leaf's scheme is "rounds"
      schemeParams?: {              // partial override of non-"type" scheme fields only (e.g. durationSeconds, count, rounds)
        ...
      }
    }
  }
}
```

If a variant doesn't override a given leaf, that leaf's RX content applies
unchanged for that variant too — inheritance, not forced redundancy,
consistent with WI-1's "populate what's known, never force a duplicate"
principle.

**Overrides change difficulty, never structure.** A variant may substitute
movements, loads, rep counts, or minor scheme parameters (duration, round
count) for an existing leaf. It may never add or remove children, change a
leaf to a composite or vice versa, or reference anything but an existing
leaf id. If a scaled class is structurally different from RX (different
number of rounds *of different things*, not just fewer reps), that is a
different workout, not a scaling variant of this one — out of scope for
`ScalingOverrides`.

## 9. Invariants

**Structural (hard errors if violated):**

1. `kind` is exactly one of `"leaf"` / `"composite"`.
2. `movements`/`unbroken` present only when `kind === "leaf"`; `children`/`restBetweenChildren`/`primaryChildId`/`resultCombination` present only when `kind === "composite"` — never both sets on one node.
3. A leaf has at least one of {non-empty `movements`, non-empty `notes`}.
4. A composite has at least 2 children (never 0 or 1 — a single "composite" wrapping one child is unrepresentable; that content is just that child directly).
5. Every `id` is unique within one WorkoutSection's tree.
6. No Segment object is reachable from more than one parent (proper tree, not a DAG).
7. `repSequence` is only valid when `scheme.type === "rounds"`, and its length must equal `scheme.count` exactly.
8. `primaryChildId`, if present, must equal the `id` of one of that composite's own *direct* children (never a grandchild, never foreign).
9. `resultCombination === "primary-only"` requires `primaryChildId` to be present.
10. `unbroken` is never present on a composite.
11. `scheme.type === "amrap"` requires `durationSeconds >= 1`.
12. `scheme.type === "interval"` requires `workSeconds >= 1` and `rounds >= 1`.
13. `scheme.type === "rounds"` requires `count >= 1`.
14. A `ScalingOverrides` entry's `leafSegmentId` must resolve to an existing **leaf** (never a composite) in that section's tree.

**Soft (warnings, non-blocking — same spirit as WI-1's review flags, not validation failures):**

- Composite nesting deeper than ~2 levels (technically legal, but no real CrossFit workout has needed it yet — likely a mis-model, worth a coach's eyes).
- `restBetweenChildren: 0` across more than 3–4 children (physically extreme; possibly a mis-parse).
- A leaf with empty `movements` and only `notes` (valid, but signals the structural model gave up on this leaf — worth surfacing for manual review, directly analogous to `ambiguous_format` today).
- `resultCombination: "sum"` across children whose leaves imply incompatible scoring shapes (e.g. summing a load-scored leaf with a time-scored leaf) — the Segment layer alone can't always know this cleanly since scoring *labels* live on WorkoutSection by design (§10); flag for review rather than hard-block.

**Guarantees the model provides to every downstream subsystem:**

- No cycles are representable, by construction (inline children, never references).
- Every leaf is reachable and addressable by a stable id, so scaling overrides, logging, and incremental AI updates can all target an exact leaf unambiguously.
- The tree's *shape* is scaling-invariant: RX and every other variant describe the same skeleton, differing only in leaf-level content. No consumer ever needs variant-specific tree-walking — only variant-specific leaf-content resolution.
- A section's overall result is always computable by a closed, generic function over the tree (`resultCombination` at each composite, `scheme` + movements at each leaf) — no per-format scoring logic required.

## 10. What is explicitly NOT Segment's responsibility

- **Loggability** (whether/how this can be logged) — `WorkoutSection.loggingMode`.
- **Scoring label/unit** (what kind of number gets recorded and displayed — "Time," "Total Reps," "Load") — `WorkoutSection.scoreType`. `resultCombination` only describes *how the tree's own numbers structurally combine* (sum/primary/best/last), never what unit or label the result carries.
- **Scaling variant existence/naming** — `WorkoutSection.scalingVersions`; Segment only exposes addressable leaf ids for variants to hook into (§8).
- **Participation** (individual/partner/team, split mode) — `WorkoutSection`.
- **Benchmark/hero identity** — `WorkoutSection.benchmarkMetadata`.
- **Section duration estimate/display** — `WorkoutSection.durationMinutes` today; whether this becomes *derived* from the tree's own scheme durations instead of separately authored is an open question, deliberately not resolved here.
- **Class placement** (section type, ordering among sections) — `WorkoutSection`.
- **Rendering/presentation, editor UI, AI extraction logic, persistence/versioning mechanics, and the shape of a logged result** — all explicitly deferred, all subsystems that must be *derived from* this spec, none of which this spec makes decisions for.

---

## JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {

    "Movement": {
      "type": "object",
      "required": ["name"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "canonicalName": { "type": ["string", "null"] },
        "reps": { "type": ["integer", "null"], "minimum": 1 },
        "weight": {
          "type": ["object", "null"],
          "additionalProperties": false,
          "properties": {
            "male": { "type": ["number", "null"] },
            "female": { "type": ["number", "null"] },
            "unit": { "type": "string", "enum": ["kg", "lb"] }
          }
        },
        "distance": {
          "type": ["object", "null"],
          "additionalProperties": false,
          "properties": {
            "value": { "type": "number" },
            "unit": { "type": "string", "enum": ["m", "km", "mi"] }
          }
        },
        "calories": { "type": ["integer", "null"] },
        "equipment": { "type": "array", "items": { "type": "string" } },
        "notes": { "type": ["string", "null"] }
      }
    },

    "Scheme": {
      "oneOf": [
        {
          "type": "object",
          "required": ["type"],
          "additionalProperties": false,
          "properties": { "type": { "const": "once" } }
        },
        {
          "type": "object",
          "required": ["type", "count"],
          "additionalProperties": false,
          "properties": {
            "type": { "const": "rounds" },
            "count": { "type": "integer", "minimum": 1 },
            "repSequence": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
          }
        },
        {
          "type": "object",
          "required": ["type", "durationSeconds"],
          "additionalProperties": false,
          "properties": {
            "type": { "const": "amrap" },
            "durationSeconds": { "type": "integer", "minimum": 1 }
          }
        },
        {
          "type": "object",
          "required": ["type", "workSeconds", "rounds"],
          "additionalProperties": false,
          "properties": {
            "type": { "const": "interval" },
            "workSeconds": { "type": "integer", "minimum": 1 },
            "restSeconds": { "type": "integer", "minimum": 0, "default": 0 },
            "rounds": { "type": "integer", "minimum": 1 }
          }
        }
      ]
    },

    "SegmentCommon": {
      "type": "object",
      "required": ["id", "kind", "scheme"],
      "properties": {
        "id": { "type": "string" },
        "kind": { "type": "string", "enum": ["leaf", "composite"] },
        "label": { "type": ["string", "null"] },
        "notes": { "type": ["string", "null"] },
        "scheme": { "$ref": "#/definitions/Scheme" }
      }
    },

    "LeafSegment": {
      "allOf": [
        { "$ref": "#/definitions/SegmentCommon" },
        {
          "type": "object",
          "properties": {
            "kind": { "const": "leaf" },
            "movements": { "type": "array", "items": { "$ref": "#/definitions/Movement" } },
            "unbroken": { "type": "boolean", "default": false }
          },
          "not": { "anyOf": [ { "required": ["children"] }, { "required": ["restBetweenChildren"] } ] }
        }
      ]
    },

    "CompositeSegment": {
      "allOf": [
        { "$ref": "#/definitions/SegmentCommon" },
        {
          "type": "object",
          "required": ["children", "restBetweenChildren", "resultCombination"],
          "properties": {
            "kind": { "const": "composite" },
            "children": {
              "type": "array",
              "minItems": 2,
              "items": { "$ref": "#/definitions/Segment" }
            },
            "restBetweenChildren": {
              "oneOf": [
                { "const": 0 },
                { "type": "integer", "minimum": 1 },
                { "const": "as-programmed" }
              ]
            },
            "primaryChildId": { "type": ["string", "null"] },
            "resultCombination": {
              "type": "string",
              "enum": ["sum", "primary-only", "best-of", "last"]
            }
          },
          "not": { "required": ["movements", "unbroken"] }
        }
      ]
    },

    "Segment": {
      "oneOf": [
        { "$ref": "#/definitions/LeafSegment" },
        { "$ref": "#/definitions/CompositeSegment" }
      ]
    },

    "ScalingOverrides": {
      "type": "object",
      "description": "Keyed by variant name (intermediate | beginner | onramp). RX needs no entry - it IS the tree.",
      "additionalProperties": {
        "type": "object",
        "description": "Keyed by leaf Segment id.",
        "additionalProperties": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "movements": { "type": "array", "items": { "$ref": "#/definitions/Movement" } },
            "repSequence": { "type": "array", "items": { "type": "integer" } },
            "schemeParams": {
              "type": "object",
              "description": "Partial override of non-'type' Scheme fields only (e.g. durationSeconds, count, rounds, workSeconds, restSeconds)."
            }
          }
        }
      }
    }
  },

  "type": "object",
  "required": ["structure"],
  "properties": {
    "structure": { "$ref": "#/definitions/Segment" },
    "scalingOverrides": { "$ref": "#/definitions/ScalingOverrides" }
  }
}
```

---

## Worked examples

Each example shows the relevant slice of one WorkoutSection: its `structure`
(the Segment tree) and, where useful, `scalingOverrides`. WorkoutSection's
own fields (`loggingMode`, `scoreType`, `scalingVersions`, participation,
etc.) are noted in prose but not repeated in full per §10.

### 1. For Time

*"For time: 1000m Row, 50 Burpees, 30 Box Jumps."* Single pass, no
repetition. `scoreType: "Time"`.

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf", "scheme": { "type": "once" },
    "movements": [
      { "name": "Row", "distance": { "value": 1000, "unit": "m" } },
      { "name": "Burpee", "reps": 50 },
      { "name": "Box Jump", "reps": 30 }
    ]
  }
}
```

### 2. 5 Rounds (RFT)

*"5 rounds for time: 10 Deadlifts, 15 Box Jumps, 20 Wall Balls."* Constant
reps every round — no `repSequence` needed. `scoreType: "Time"`.

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf", "scheme": { "type": "rounds", "count": 5 },
    "movements": [
      { "name": "Deadlift", "reps": 10, "weight": { "male": 102, "female": 70, "unit": "kg" } },
      { "name": "Box Jump", "reps": 15 },
      { "name": "Wall Ball", "reps": 20, "weight": { "male": 9, "female": 6, "unit": "kg" } }
    ]
  }
}
```

### 3. Descending Ladder ("Fran": 21-15-9)

`repSequence` overrides each movement's per-round reps uniformly — this is
the same mechanism used for ascending ladders, pyramids, and strength sets
schemes (§ Example 8). `scoreType: "Time"`.

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf",
    "scheme": { "type": "rounds", "count": 3, "repSequence": [21, 15, 9] },
    "movements": [
      { "name": "Thruster", "weight": { "male": 43, "female": 30, "unit": "kg" } },
      { "name": "Pull-up" }
    ]
  },
  "scalingOverrides": {
    "beginner": {
      "seg-1": {
        "movements": [
          { "name": "Thruster", "weight": { "male": 29, "female": 20, "unit": "kg" } },
          { "name": "Ring Row" }
        ],
        "repSequence": [15, 12, 9]
      }
    }
  }
}
```

### 4. Buy-In / Main / Cash-Out

Composite, normal (unspecified) rest between parts, only the main set is
scored. This is the structure that was silently split into 3 separate
sections under today's model.

```json
{
  "structure": {
    "id": "seg-root", "kind": "composite",
    "scheme": { "type": "once" },
    "restBetweenChildren": "as-programmed",
    "primaryChildId": "seg-main",
    "resultCombination": "primary-only",
    "children": [
      {
        "id": "seg-buyin", "kind": "leaf", "label": "Buy-in",
        "scheme": { "type": "once" },
        "movements": [ { "name": "Row", "calories": 50 } ]
      },
      {
        "id": "seg-main", "kind": "leaf", "label": "Main",
        "scheme": { "type": "rounds", "count": 3, "repSequence": [21, 15, 9] },
        "movements": [
          { "name": "Thruster", "weight": { "male": 43, "female": 30, "unit": "kg" } },
          { "name": "Pull-up" }
        ]
      },
      {
        "id": "seg-cashout", "kind": "leaf", "label": "Cash-out",
        "scheme": { "type": "once" },
        "movements": [ { "name": "Row", "calories": 50 } ]
      }
    ]
  }
}
```

### 5. Chained AMRAP ("Jack's Triangle")

Composite with zero rest between children and a summed result — the
structure that was previously flattened into one duplicated movement list.

```json
{
  "structure": {
    "id": "seg-root", "kind": "composite",
    "scheme": { "type": "once" },
    "restBetweenChildren": 0,
    "resultCombination": "sum",
    "children": [
      {
        "id": "seg-1", "kind": "leaf", "label": "Stage 1",
        "scheme": { "type": "amrap", "durationSeconds": 120 },
        "movements": [ { "name": "Deadlift", "weight": { "male": 100, "female": 70, "unit": "kg" } } ]
      },
      {
        "id": "seg-2", "kind": "leaf", "label": "Stage 2",
        "scheme": { "type": "amrap", "durationSeconds": 1140 },
        "movements": [
          { "name": "Pull-up", "reps": 4 },
          { "name": "Wall Ball", "reps": 8, "weight": { "male": 9, "female": 6, "unit": "kg" } },
          { "name": "Row", "calories": 12 },
          { "name": "Air Squat", "reps": 16 }
        ]
      },
      {
        "id": "seg-3", "kind": "leaf", "label": "Stage 3",
        "scheme": { "type": "amrap", "durationSeconds": 120 },
        "movements": [ { "name": "Deadlift", "weight": { "male": 100, "female": 70, "unit": "kg" } } ]
      }
    ]
  }
}
```

### 6. EMOM

*"EMOM 12: 15 Wall Balls."* `scoreType`: completion / reps, per
WorkoutSection.

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf",
    "scheme": { "type": "interval", "workSeconds": 60, "restSeconds": 0, "rounds": 12 },
    "movements": [ { "name": "Wall Ball", "reps": 15, "weight": { "male": 9, "female": 6, "unit": "kg" } } ]
  }
}
```

### 7. Interval

*"5 rounds: 3 min max-cal Row, rest 1 min."*

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf",
    "scheme": { "type": "interval", "workSeconds": 180, "restSeconds": 60, "rounds": 5 },
    "movements": [ { "name": "Row" } ]
  }
}
```

### 8. Strength

*"Back Squat 5-5-5-3-3-3-1-1-1, build to a heavy set."* Same
`rounds` + `repSequence` mechanism as the ladder example — `scoreType:
"Load"` instead of `"Time"`, decided at WorkoutSection, not Segment.

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf",
    "scheme": { "type": "rounds", "count": 9, "repSequence": [5, 5, 5, 3, 3, 3, 1, 1, 1] },
    "movements": [ { "name": "Back Squat" } ]
  }
}
```

### 9. Complex

*"6 sets, build: 1 Power Clean + 1 Front Squat + 1 Push Jerk."*
`unbroken: true` replaces what would otherwise be prose ("perform
unbroken").

```json
{
  "structure": {
    "id": "seg-1", "kind": "leaf",
    "scheme": { "type": "rounds", "count": 6 },
    "unbroken": true,
    "movements": [
      { "name": "Power Clean", "reps": 1 },
      { "name": "Front Squat", "reps": 1 },
      { "name": "Push Jerk", "reps": 1 }
    ]
  }
}
```

---

## Known, deliberate limitations of v1

- **Per-movement rep multipliers within a ladder** (different movements
  scaling at different rates in the same leaf, e.g. "21-15-9 Thrusters but
  9-6-3 Muscle-ups") are not supported — `repSequence` applies uniformly
  to every movement in a leaf. Rare in practice; flagged as a future
  extension, not solved here.
- **Alternating interval content** (e.g. EMOM where odd minutes are
  movement A and even minutes are movement B) is not modeled. It likely
  wants a third composition mode on top of `sequence` (an "alternate"
  rest/ordering rule) — deliberately deferred until a real case demands
  it, consistent with not building generality the model hasn't earned yet.
- **Section duration as a derived value** (summing every leaf's own
  `scheme` duration up the tree, vs. keeping `WorkoutSection.durationMinutes`
  as a separately authored field) is an open question, not resolved here.
- **The shape of a logged result** for a composite section (e.g. does a
  member log three separate numbers for buy-in/main/cash-out, or one?) is
  explicitly out of scope — a separate design pass against `wod_logs`/
  `skill_logs`, to happen once this model is stable.
