# Canonical Movement Identity — Adversarial Matrix

**Status: Research-only. Classifications below are proposed applications of the resolver in `CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md` §4, checked against the real, live `movements` catalog (465 rows, queried read-only this session). No writes performed.**

Legend: **SAME** = one `movements.id`. **DIFFERENT** = distinct `movements.id` rows, must never merge. **AMBIGUOUS** = real distinction exists but the two named catalog rows for it either don't both exist yet or the naming itself needs human judgment. **UNRESOLVED** = not safely classifiable by any rule in this document; leave as raw text.

## Squat matrix (mission §85)

| Pair | Catalog rows exist? | Classification |
|---|---|---|
| Back Squat / Front Squat | Both exist | **DIFFERENT** — different bar position, different comparability |
| Back Squat / Overhead Squat | Both exist | **DIFFERENT** |
| Back Squat / Box Squat | Both exist | **DIFFERENT** — depth/execution standard changes comparability |
| Back Squat / Pause Squat | Both exist | **DIFFERENT** — catalog already models this as a separate row, not a modifier (Architecture §9) |
| Back Squat / Tempo Squat | Both exist (`Tempo Squat` generic, not `Tempo Back Squat` specifically) | **AMBIGUOUS** — the catalog's generic `Tempo Squat` doesn't specify which squat variant the tempo applies to; a coach meaning "tempo front squat" has no exact row today. Resolver correctly falls to `UNRESOLVED`/manual pick, never guesses which squat |
| Goblet Squat / KB Goblet Squat | Both exist as separate rows (`Goblet Squat` has alias `"kettlebell goblet squat"`) | **AMBIGUOUS in the raw data, DIFFERENT by the catalog's own resolution** — `Goblet Squat`'s alias list already absorbs the KB-qualified phrasing, so `resolveComparisonIdentity` would correctly treat them as SAME via alias match; `KB Goblet Squat` is a second, separate row that still exists independently — a real, present-day near-duplicate the catalog hasn't fully reconciled |
| Sandbag Squat / Back Squat | Both exist | **DIFFERENT** — different implement changes the movement entirely, not a modifier of Back Squat |
| Pistol Squat / Goblet Squat | Both exist | **DIFFERENT** |
| Zercher Squat / Front Squat | Both exist | **DIFFERENT** — distinct bar position (crook of elbows vs. front rack) |
| Jumping Squat / Air Squat | Both exist | **DIFFERENT** |

## Press matrix (mission §86)

| Pair | Catalog rows exist? | Classification |
|---|---|---|
| Strict Press / Push Press | Both exist | **DIFFERENT** |
| Push Press / Push Jerk | Both exist | **DIFFERENT** — leg-drive-to-lockout mechanics differ |
| Push Jerk / Split Jerk | Both exist | **DIFFERENT** |
| Split Jerk / Squat Jerk | Both exist | **DIFFERENT** |
| Split Jerk / Tall Jerk / Power Jerk | All exist | **DIFFERENT**, all three |
| Strict Press / Bench Press | Both exist | **DIFFERENT** — standing vs. supine, unrelated movement pattern despite shared "press" word |
| Strict Press / Z Press | Both exist | **DIFFERENT** — seated-on-floor Z Press is a distinct stability demand |
| Sots Press / Sotts Press | **Both exist as SEPARATE rows** | **SAME movement, catalog bug** — flagged in the Current-State Audit §3e as a real, live near-duplicate pair requiring a §10 merge (deprecate one, redirect), not a naming decision this document can resolve unilaterally |
| Push Press / Snatch-Grip Push Press | Both exist | **DIFFERENT** — grip width changes the movement (matches "Snatch-Grip Behind-the-Neck Press" also existing as its own row, consistent pattern) |

## Deadlift matrix (mission §87)

| Pair | Catalog rows exist? | Classification |
|---|---|---|
| Deadlift / Sumo Deadlift | Both exist | **DIFFERENT** |
| Deadlift / Romanian Deadlift | Both exist | **DIFFERENT** |
| Deadlift / Snatch Deadlift | Both exist | **DIFFERENT** — snatch-width grip, different pull |
| Deadlift / Snatch-Grip Deadlift | Only `Snatch Deadlift` exists, not a literally-named `"Snatch-Grip Deadlift"` | **AMBIGUOUS** — real coach phrasing variance (`"Snatch-Grip Deadlift"` vs. catalog's `"Snatch Deadlift"`) is not in `aliases[]` today; resolver correctly falls to UNRESOLVED rather than guess these are the same intended movement, even though they very likely are |
| Sumo Deadlift / KB Sumo Deadlift | Both exist as separate rows | **DIFFERENT** — implement changes identity (consistent with Back Squat vs. Sandbag Squat above) |
| Stiff Leg Deadlift / Stiff Legged Deadlift | **Both exist as SEPARATE rows** | **SAME movement, catalog bug** — second live near-duplicate pair (Audit §3e), same merge treatment as Sots/Sotts Press |
| Deadlift / DB Deadlift / KB Deadlift | All exist as separate rows | **DIFFERENT**, each — mission §44's own equipment-as-identity question, answered empirically by the catalog's existing pattern: implement changes identity |
| Sumo Deadlift / Sumo Deadlift High Pull | Both exist | **DIFFERENT** — a High Pull is a structurally different finish (no full deadlift-only comparability) |

## Olympic lift matrix — Snatch family (mission §84)

| Pair | Catalog rows exist? | Classification |
|---|---|---|
| Snatch / Power Snatch | Both exist | **DIFFERENT** |
| Snatch / Hang Snatch | Both exist | **DIFFERENT** — starting position changes the movement |
| Hang Snatch / Hang Power Snatch | Both exist | **DIFFERENT** |
| Snatch / Muscle Snatch | Both exist | **DIFFERENT** |
| Snatch / Block Snatch / Snatch from Blocks | Catalog has `Snatch from Blocks`, no separate `"Block Snatch"` | **SAME under one row** — `"Block Snatch"` should be added as an *alias* of `Snatch from Blocks`, not a new row, if a coach ever types it; today it would resolve UNRESOLVED |
| Snatch / DB Snatch | Catalog has `"Alternating Dumbbell Snatch"`, not a bare `"DB Snatch"` | **AMBIGUOUS** — real phrasing gap; `"DB Snatch"` is a plausible single-arm variant a coach could mean either the alternating DB row or a genuinely different single-rep DB Snatch by; resolver must not guess, UNRESOLVED is correct until a coach/admin explicitly disambiguates via an alias or new row |
| Snatch Pull / Snatch High Pull | Both exist as separate rows | **DIFFERENT** — different finish height, real distinction |
| Snatch Balance / Pressing Snatch Balance | Both exist | **DIFFERENT** |

**This is the mission's own named highest-risk family (§84's explicit "no accidental merges" instruction), and the catalog already gets it right structurally** — every genuinely distinct Snatch variant that exists in the catalog is a separate row; the only failures found are *absence* (DB Snatch, Block Snatch phrasing), never incorrect merging.

## Burpee matrix (mission §80, explicitly named adversarial test)

Not directly queried against the live catalog this session (outside the movement-family filter used for the SQL audit) — reasoned from the same seed-source (open-wod-db) and Forge's own pre-existing static `CANONICAL_MOVEMENTS` list, both of which were confirmed to separately name:

| Pair | Classification |
|---|---|
| Burpee / Burpee Box Jump | **DIFFERENT** |
| Burpee Box Jump / Burpee Box Jump Over | **DIFFERENT** — landing-and-stand vs. jump-over changes the movement |
| Burpee / Bar-Facing Burpee | **DIFFERENT** |
| Burpee / Lateral Burpee | **DIFFERENT** |
| Lateral Burpee / Lateral Burpee Over Bar | **DIFFERENT** |

Confirmed both `Lateral Burpee` and `Lateral Burpee Over Bar` exist as separate live catalog rows (found in the equipment-variant SQL scan) — the pattern holds.

## Wall Ball (mission §81)

`Wall Ball` (alias `wb`) and a separate `Wall Ball Shot` both exist as distinct rows, plus `Wall Ball Sit-up` (alias `wbs`) as a third, clearly-different movement. **Target height and ball weight are correctly NOT modeled as separate movement identities anywhere in the catalog** — confirmed no `"Wall Ball 20lb"` or `"Wall Ball 10ft"`-style rows exist. This validates the mission's own §81 hypothesis: those are prescription/scoring metadata, not movement identity, and the existing catalog already agrees.

## Loaded carries (mission §82)

Confirmed live and distinct: `Farmers Carry`, `Overhead Carry`, `Rack Carry`, `Sandbag Carry`, `Suitcase Carry`, `Yoke Carry`, `Plate Carry`. All **DIFFERENT** from each other — matches the mission's own hypothesis exactly, and the catalog already reflects it.

## Gymnastics matrix (mission §83)

| Pair | Catalog rows exist? | Classification |
|---|---|---|
| Pull-up / Chest to Bar Pull-up | Both exist | **DIFFERENT** |
| Chest to Bar Pull-up / Bar Muscle-up | Both exist | **DIFFERENT** |
| Bar Muscle-up / Ring Muscle-up | Both exist | **DIFFERENT** |
| Pull-up / Strict Pull-up | Both exist as separate rows | **DIFFERENT** — matches Architecture §9's "separate row per meaningfully different variant" pattern; a plain kipping `Pull-up` and `Strict Pull-up` are not the same PR stream |
| Pull-up / Negative Pull-up | Both exist | **DIFFERENT** |
| Pull-up / Scap Pull-up | Both exist | **DIFFERENT** |
| Pull-up / Weighted Pull-up | Both exist | **DIFFERENT** — added external load changes comparability, consistent with the equipment/loading-as-identity pattern found throughout this matrix |
| Ring Row / Pull-up | Both exist | **DIFFERENT** |

**No "Butterfly Pull-up" or "Kipping Pull-up" row found** — a real, present gap (mission §46's own named question): the catalog currently distinguishes *Strict* explicitly but has no row for *Kipping* or *Butterfly* specifically (a plain `Pull-up` row implicitly covers both). **AMBIGUOUS**, left as a genuine open product question for whoever eventually curates the catalog further — not resolved by this document, since it requires a coaching/product judgment call (does Forge's own leaderboard/PR philosophy care about kipping-vs-butterfly comparability?), not a data-audit fact.

## Overall finding

Across every adversarial family tested, the **only real defects found are two literal spelling-duplicate pairs already sitting in the live catalog** (`Sots Press`/`Sotts Press`, `Stiff Leg Deadlift`/`Stiff Legged Deadlift`) and a handful of **absent aliases/rows for real phrasing coaches plausibly use** (`"Snatch-Grip Deadlift"`, `"Block Snatch"`, `"DB Snatch"`, `"Kipping/Butterfly Pull-up"`). **Zero cases were found where the deterministic resolver (Architecture §4) would incorrectly merge two genuinely different movements** — the resolver's own design (exact match + exact alias + one narrow prefix-strip, nothing fuzzy) structurally cannot produce a false merge; its only failure mode is under-resolution (falling to `UNRESOLVED` when it safely should), which is the correct, safe failure mode per MI-6/MI-92 ("UNRESOLVED > WRONG").
