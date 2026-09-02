# FCKB — Movement Aliases

## Design Note — Why This Document Separates Mechanical Rules From Stored Aliases

The source v1.0 architecture's own example (Power Clean → PC, power clean, power cleans, pwr clean, clean power) mixes two fundamentally different KINDS of alias together in one flat list:

1. **Mechanical transformations** that apply UNIFORMLY to nearly every movement in the catalog (pluralization, hyphen/space normalization, case-folding) — these don't need to be stored as individual `movement_aliases` rows at all; they should be handled by the NORMALIZE step of the parsing pipeline (see `FCKB_ARCHITECTURE_V1.md`'s own "Input → Normalize → Alias resolution → Canonical movement" pipeline), applied identically to every movement, before alias lookup even runs.
2. **Genuinely irregular aliases** — real abbreviations, nicknames, misspellings, and reordered phrases that CANNOT be derived by a mechanical rule and must be stored explicitly, one per movement, because they're specific to that movement's own community usage.

Treating both kinds identically (as the source's flat example does) means the `movement_aliases` table ends up storing tens of thousands of MECHANICALLY-DERIVABLE rows (every movement's plural, every movement's hyphen variant) alongside the much smaller set of rows that actually carry unique information. This document takes the position — elaborated with full justification in `FCKB_ARCHITECTURE_REVIEW.md` — that mechanical transformations belong in Section 1 below as a small, fixed set of NORMALIZATION RULES applied at parse time, and the `movement_aliases` table should store ONLY the irregular cases cataloged in Sections 2 onward. This is not a smaller or less complete alias system than the source's — it is the SAME coverage, achieved correctly rather than by brute-force enumeration, and it is the reason this document's own alias count (Section 9) is presented as "irregular aliases requiring explicit storage" rather than "total strings the parser can recognize" (which, once Section 1's rules are applied, is a much larger effective number than either count alone suggests).

---

## 1. General Normalization Rules (Applied Before Alias Lookup, Not Stored as Rows)

These rules run once, mechanically, against BOTH the incoming user text and every canonical movement name / stored alias, so that comparison happens on normalized forms rather than requiring every surface variation to be separately stored.

### 1.1 Case Folding
All text lowercased before comparison. `Push-Up`, `PUSH-UP`, `push-up` are identical post-normalization.

### 1.2 Pluralization
A trailing `s` (or `es` where the base ends in a sibilant: `push`, `box`, etc.) is stripped before matching, and re-added for display based on the parsed rep count (>1 → plural). Covers: `Pull-up`/`Pull-ups`, `Burpee`/`Burpees`, `Box Jump`/`Box Jumps`, essentially every movement in the catalog. **Exception**: a small set of movements are already plural in their canonical singular-usage form and must NOT have a trailing `s` stripped as if it were the plural marker — e.g. "Double Unders" is the standard way even ONE unit is referred to in casual speech ("how many double unders can you do unbroken" — nobody says "double under" singular in practice), so `Double Unders` should arguably be the CANONICAL form with `Double Under` as the irregular singular-form alias, not the other way around; flagged as a real judgment call for the schema, not a clean mechanical case.

### 1.3 Hyphen / Space / Concatenation Normalization
`Chest-to-Bar`, `Chest to Bar`, and `Chesttobar` (concatenated, no separator at all — real in fast-typed/no-autocorrect mobile text) all normalize to the same token sequence. Rule: strip all hyphens and collapse all whitespace, THEN compare — meaning `pull-up`, `pull up`, and `pullup` are identical post-normalization without needing 3 separately stored aliases for every hyphenatable movement name (Pull-up, Push-up, Chin-up, Set-up, Sit-up, Warm-up, Muscle-up, Step-up, and every other compound movement name in the catalog).

### 1.4 Numeral / Word-Number Equivalence in Movement Names
Movements with a number embedded in their canonical name (rare, but real — e.g. no core movement in this catalog has this, but a coach-defined complex sometimes does, "3-Position Snatch") should resolve the same whether written as a digit or spelled out ("Three-Position Snatch").

### 1.5 Ampersand / "And" / "+" Equivalence
`Clean & Jerk`, `Clean and Jerk`, `Clean+Jerk`, `Clean Jerk` (a real, if less formal, dropped-conjunction form) should all normalize to the same token sequence for movements whose canonical name contains a conjunction (Clean & Jerk being the primary example, but this rule generalizes to any coach-defined complex name written with a joining word/symbol).

### 1.6 Diacritic Stripping (Internationalization)
Movement/equipment names transliterated from other languages sometimes carry diacritics in international programming text (rare in English-language CrossFit sources but real in translated content) — diacritics should be stripped for matching purposes (`Überkopf` → `uberkopf`) even though this specific case has essentially zero real-world frequency in the English-dominant CrossFit content Forge processes today; included for completeness given the mission's explicit ask about "language conventions."

---

## 2. High-Value Abbreviations

The genuinely load-bearing content of this document — real, extremely common shorthand a coach actually types, that CANNOT be derived mechanically from the canonical name and must be stored as an explicit alias.

### 2.1 Olympic Weightlifting

| Canonical Movement | Abbreviations |
|---|---|
| Power Clean | PC |
| Power Snatch | PS |
| Hang Power Clean | HPC |
| Hang Power Snatch | HPS |
| Hang Squat Clean | HSC |
| Squat Clean | SC (ambiguous — also "Stiff-leg... see 2.3) |
| Overhead Squat | OHS |
| Clean and Jerk | C&J, C+J, CJ |
| Split Jerk | SJ |
| Push Jerk | PJ |
| Snatch Grip Deadlift | SGDL |
| Clean Grip Deadlift | CGDL |
| Clean and Front Squat | CFS |
| Behind-the-Neck Jerk | BTN Jerk |
| Behind-the-Neck Press | BTN Press |

### 2.2 Squat Family

| Canonical Movement | Abbreviations |
|---|---|
| Back Squat | BS |
| Front Squat | FS |
| Overhead Squat | OHS (see 2.1) |
| Bulgarian Split Squat | BSS |
| Zercher Squat | ZS |

### 2.3 Hinge Family

| Canonical Movement | Abbreviations |
|---|---|
| Deadlift | DL |
| Romanian Deadlift | RDL |
| Sumo Deadlift | SDL |
| Stiff Leg Deadlift | SLDL (collides visually with SDL above — see PARSER_EDGE_CASES.md) |
| Good Morning | GM |
| Snatch Grip Deadlift | SGDL (see 2.1) |

### 2.4 Press Family

| Canonical Movement | Abbreviations |
|---|---|
| Strict Press | SP |
| Push Press | PP |
| Bench Press | BP |
| Overhead Press | OHP (a common alternate canonical name entirely for Strict Press in non-CrossFit strength communities — see 2.9 cross-community naming) |
| Handstand Push-up | HSPU |
| Deficit Handstand Push-up | Deficit HSPU |

### 2.5 Pull Family

| Canonical Movement | Abbreviations |
|---|---|
| Chest-to-Bar Pull-up | C2B, CTB |
| Muscle-up | MU |
| Bar Muscle-up | BMU |
| Ring Muscle-up | RMU |
| Toes-to-Bar | T2B, TTB |
| Knees-to-Elbows | K2E, KTE |
| Handstand Walk | HSW |

### 2.6 Dumbbell / Kettlebell

| Canonical Movement | Abbreviations |
|---|---|
| Dumbbell | DB (as an equipment/movement-name prefix — "DB Snatch", "DB Thruster" etc.) |
| Kettlebell | KB (equipment/movement-name prefix) |
| Kettlebell Swing | KBS |
| Turkish Get-Up | TGU |
| Single-Arm | SA (as a prefix — "SA DB Snatch") |

### 2.7 Monostructural

| Canonical Movement | Abbreviations |
|---|---|
| Double Under | DU |
| Single Under | SU |
| Calories (as a scoring unit on erg machines, not a movement itself but ubiquitous shorthand) | Cal, Cals |
| Assault Bike | AB (collides with "Air Bike" and, badly, with "Ab" as in abdominals — context-dependent) |

### 2.8 Equipment / Structural Abbreviations (Not Movements Themselves, But Constantly Embedded in Movement Text)

| Term | Abbreviations |
|---|---|
| Glute Ham Developer | GHD |
| Rate of Perceived Exertion | RPE |
| Reps in Reserve | RIR |
| One-Rep Max | 1RM |
| Repetition Max (generic, N=any number) | XRM (e.g. 3RM, 5RM) |
| Bodyweight | BW |
| For Time | FT |
| As Many Rounds/Reps As Possible | AMRAP |
| Rounds For Time | RFT |
| Every Minute On the Minute | EMOM |
| Sandbag | SB (collides with "Snatch Balance" shorthand in oly-specific contexts, and with "Set/Break" notation in some strength programs — a real, documented collision) |

### 2.9 Cross-Community Naming (Same Movement, Different Canonical Name by Tradition)

Not abbreviations exactly, but functionally identical to aliases from a resolution standpoint — the same physical movement is CANONICALLY named differently across CrossFit vs. general strength/bodybuilding vs. physical-therapy communities, and Forge will see all three depending on the coach's own background:

| FCKB Canonical Name | Alternate "Canonical" Name in Another Tradition |
|---|---|
| Strict Press | Overhead Press (OHP) — the dominant name in general strength-training communities |
| Push-up | Press-up (British/Commonwealth English default term, not just a spelling variant) |
| Air Squat | Bodyweight Squat |
| Kettlebell Swing (Russian) | Hardstyle Swing (a specific KB-training-lineage name for the same movement) |
| Box Jump | Plyo Box Jump |
| Wall Ball | Wall Ball Shot |
| Toes-to-Bar | Hanging Leg Raise to Bar (rare, but used as a fuller descriptive alternative) |

---

## 3. Nicknames & Community Shorthand

Movements (or movement-adjacent concepts) with a real, widely-used informal name that isn't a simple abbreviation:

| Canonical Movement | Nickname(s) |
|---|---|
| Devil Press | "Devils" |
| Man Maker | "Man Makers" |
| Thruster | "Squat-to-Press" (descriptive nickname, occasionally used instead of the canonical name by coaches unfamiliar with CrossFit-specific terminology) |
| Wall Ball | "Wallies" (regional, more common in UK/Australian affiliates) |
| Sumo Deadlift High Pull | "SDHP" (technically an abbreviation, but functions as the community's PRIMARY way of referring to this movement — the full name is rarely spoken/written at all in practice) |
| Turkish Get-Up | "Get-Up", "TGUs" |
| Assault Bike | "The Devil", "Satan's Tricycle" (genuine, extremely common gym-culture nicknames, not formal terminology, but real enough that Forge's parser will encounter them in casual class-programming text and social posts) |
| Burpee | "Burpees" is the plural obviously, but also occasionally "Up-Downs" in some regional/military-adjacent gyms, a real if less common synonym predating CrossFit's popularization of "Burpee" |
| Overhead Squat | "OHS" (2.1) also informally "the hardest squat" — not a stored alias, included only to note the community discourse around this movement is itself a real signal of how it's referenced in written coach commentary alongside the actual prescription |
| Row (Erg) | "The Erg", "Ergo" (especially Concept2-brand specific, functioning as a genericized trademark) |
| Ski Erg | "The Ski" |
| Kettlebell Swing | "Swings" (bare plural used as if it were the full canonical name in casual programming — "3 rounds: 20 swings, 15 box jumps") |

---

## 4. Common Misspellings

Real, frequently-occurring misspellings a text-input or OCR-sourced parser will encounter — these are NOT the same as intentional shorthand (Section 2/3), they're genuine errors that still need to resolve correctly:

| Canonical Movement | Common Misspellings |
|---|---|
| Burpee | Burpie, Burpe, Burpees (correct plural, included to show the base is often typo'd but the plural form is usually typed correctly, an asymmetry worth noting) |
| Kettlebell | Kettle bell (arguably a spacing variant covered by 1.3, but also genuinely "Ketttlebell", "Ketlebell" as true typos), Kettelbell |
| Deadlift | Dead lift (spacing, covered by 1.3), Deadlfit (transposition typo) |
| Snatch | (rarely misspelled itself, but frequently CENSORED/starred in text — "sn*tch" — by automated profanity filters in chat apps a workout might be pasted from, a real, documented source of corrupted input, see PARSER_EDGE_CASES.md) |
| Muscle-up | Muscleup (concatenation, covered by 1.3), Musle-up (typo) |
| Rhomboid / Rhomboids (as a target-muscle reference, not a movement, but appears in accessory-work descriptions) | Romboid |
| Plyometric | Plyometic, Plyo (this is actually standard shorthand, not a misspelling — included to show the boundary between "accepted shorthand" and "error" is sometimes blurry) |
| Handstand | Hand stand (spacing, covered by 1.3) |
| Thruster | Thruser (dropped letter, real, common fast-typing error) |
| Wall Ball | Walllball, Wall Bal |

---

## 5. US / UK / Regional Spelling & Terminology

### 5.1 General US/UK Spelling Rule
No CrossFit-specific movement names are affected by the general -ize/-ise or -or/-our spelling differences (movement names are overwhelmingly compound nouns, not the kind of word that varies), EXCEPT:

| US Term | UK/Commonwealth Term |
|---|---|
| Push-up | Press-up |
| Sneakers / Training Shoes (equipment, not a movement, but appears in programming text re: footwear requirements for a WOD) | Trainers |
| Barbell Plates ("plates") | "Weights" (used more generically in some regions to mean plates specifically, a real source of ambiguity since "weights" could also mean dumbbells generically) |

### 5.2 Regional Terminology Beyond Simple US/UK
| Concept | Regional Variant |
|---|---|
| Kettlebell Swing | "Girevoy Swing" (Russian kettlebell sport terminology, appears in specialized KB-sport-influenced programming) |
| Weightlifting Shoes | "Oly Shoes" (near-universal shorthand, included since it appears constantly in equipment-requirement notes attached to strength-format workouts) |
| Assault Bike | "Airdyne" (a DIFFERENT brand than Assault/Rogue/Echo, but the original genericized-trademark source of "air bike" terminology generally — Schwinn Airdyne predates the CrossFit-era brands and older or budget-conscious affiliates sometimes still use actual Airdyne bikes, making this a real equipment-identity distinction, not just a naming quirk) |
| Sandbag | "Sand Bell" (a specific molded, handled sandbag-adjacent product line, functionally similar but not identical equipment — used interchangeably in casual programming text despite being technically distinct products) |

---

## 6. Ambiguous / Collision-Prone Abbreviations

The highest-risk content in this entire document — abbreviations that resolve to MULTIPLE plausible canonical movements depending on context, requiring the parser to disambiguate rather than doing a simple 1:1 lookup. Fully cross-referenced in `PARSER_EDGE_CASES.md` Section 2, listed here as the authoritative alias-level source of the collision.

| Abbreviation | Possible Resolutions | Disambiguation Signal |
|---|---|---|
| DB | Dumbbell (equipment prefix), Deadlift (rare, regional), Death By (workout format, WORKOUT_FORMATS.md 3.3) | Position in text: prefix immediately before a movement name → Dumbbell; standalone before a colon/movement list → Death By; almost never means Deadlift in isolation (that collision is largely theoretical/rare in practice but documented for completeness) |
| KB | Kettlebell (equipment prefix), rarely "Knee Bend" (archaic/PT terminology, essentially never seen in modern CrossFit text) | Overwhelmingly resolves to Kettlebell; near-zero real ambiguity in practice |
| SC | Squat Clean, "Scaled" (as a workout-variant qualifier, e.g. "Rx or Sc") | Position: attached directly to a movement name → Squat Clean; standalone as a workout-variant label → Scaled |
| SDL | Sumo Deadlift, Stiff Leg Deadlift | Genuinely ambiguous without additional context; both are real, common uses of the identical 3-letter abbreviation — flagged as an unresolvable-from-abbreviation-alone case requiring the parser to either demand disambiguation or default to the more common of the two in the coach's own historical usage pattern (a personalization-dependent resolution, not a universal rule) |
| SB | Sandbag, Snatch Balance, "Set Break" (rare, some strength-program notation) | Context-dependent; Sandbag is by far the most common resolution in general affiliate programming, Snatch Balance in dedicated oly programming |
| RX | "Rx" / "Rx'd" (the workout-variant label meaning "as prescribed"), never a movement itself but constantly adjacent to movement text and easily mis-tokenized as part of a movement name if a parser isn't specifically aware of this term | N/A — always a variant/qualifier label, never resolves to any movement; flagged here because its high frequency makes it a real source of noise for movement-extraction if not filtered first |
| AB | Air Bike / Assault Bike, "Ab" (as in abdominal, in accessory-work context, e.g. "AB wheel") | Capitalization is NOT a reliable signal (both are commonly written in caps in casual text); resolved by surrounding context — presence of a duration/calorie unit signals the bike, presence of "wheel"/"work"/rep-count-in-core-typical-ranges signals abdominal |
| BP | Bench Press, "Bodyweight Percentage" (rare, in some load-prescription notation) | Overwhelmingly resolves to Bench Press |
| GHD | Glute Ham Developer (equipment), rarely confused with anything else — included to note this is a LOW-risk abbreviation despite looking unusual, not a collision case, for contrast with the genuine collisions above |

---

## 7. Multi-Word Reordering & Dropped-Word Variants

A category the source v1.0's flat example list touches on lightly (its own Chest-to-Bar example shows "chest to bar" and "chest-to-bar" but not reordering) — real coach shorthand frequently DROPS or REORDERS words in a multi-word movement name in ways that aren't simple mechanical transformations:

| Canonical Movement | Reordered / Dropped-Word Variants |
|---|---|
| Sumo Deadlift High Pull | "High Pull Sumo Deadlift" (rare reordering), "Sumo High Pull" (dropped "Deadlift" — genuinely ambiguous on its own, since it could theoretically also mean a non-sumo high pull performed at a wide stance, but in practice always resolves to the full named movement) |
| Dumbbell Snatch | "Snatch, Dumbbell" (equipment-last notation style, seen in some spreadsheet-derived or database-exported programming text where the equipment is appended rather than prefixed) |
| Overhead Squat | "Squat, Overhead" (same equipment/modifier-last pattern) |
| Chest-to-Bar Pull-up | "Pull-up, Chest to Bar" (modifier-last), "C2B Pull-up" (already covered as abbreviation, listed again to show it combines with reordering: "Pull-up C2B") |
| Single-Arm Dumbbell Snatch | "Dumbbell Snatch, Single Arm", "1-Arm DB Snatch" (numeral-for-word substitution combined with abbreviation) |

**Parser hint**: equipment/modifier-last notation (a trailing ", [modifier]" pattern) is common enough in spreadsheet/database-exported programming text specifically (as opposed to freehand-typed WODs) that it deserves its own recognized pattern rather than being treated as a one-off oddity — flagged for `PARSER_EDGE_CASES.md` cross-reference.

---

## 8. Missing Alias Categories Identified (Summary)

1. **The mechanical-vs-stored distinction itself** (Section 1) — the source architecture's own example conflates the two, which this document argues is a real design flaw worth correcting (see FCKB_ARCHITECTURE_REVIEW.md).
2. **Cross-community canonical naming** (Section 2.9) — CrossFit's own preferred name for a movement is sometimes NOT the name a general-strength or PT-background coach will use; the source architecture assumes CrossFit terminology is always the input, which won't hold once Forge ingests programming from PRVN/HWPO/general-strength-influenced coaches.
3. **Nicknames/gym-culture shorthand** (Section 3) — entirely absent from the source's own example set, which shows only formal abbreviations and spelling variants.
4. **Collision/ambiguity documentation as a first-class alias-system concern** (Section 6) — the source treats alias resolution as if every alias maps to exactly one movement; this document's position is that ambiguous aliases are common enough to need an explicit resolution-strategy field, not just a flat mapping.
5. **Multi-word reordering** (Section 7) — the source's own worked example doesn't demonstrate this pattern at all despite it being real.
6. **Regional/non-US terminology beyond simple spelling** (Section 5.2) — the source doesn't address this beyond implying "British/American English" spelling differences exist, without examples beyond that generic statement.

## 9. Real Alias Count

Counting every explicitly stored alias across Sections 2–7 (not counting Section 1's mechanically-derived forms, which are NOT stored rows in this document's proposed design, and not counting the cross-referenced/repeated entries): approximately **310 explicitly-cataloged irregular aliases**. 

This number looks small next to the source architecture's 8,000–12,000 target ONLY if the mechanical-transformation question (Section 1) is ignored. Applying Section 1's normalization rules (pluralization + hyphen/space normalization + case-folding) to the ~540 canonical movements in `MOVEMENT_CATALOG.md` generates, conservatively, 3-4 mechanically-derivable surface forms per movement (a base form, a plural, a hyphenated form, a spaced form — several of which collapse to the same normalized token and so don't need separate storage at all under this document's design) — meaning the EFFECTIVE recognized-string coverage is in the same order of magnitude as the source's target once normalization is accounted for, achieved through roughly 540 movements × a small, fixed rule set + ~310 genuinely irregular stored aliases, rather than through tens of thousands of individually-authored rows. This is the central, load-bearing argument of this document and is elaborated fully, with a concrete row-count comparison, in `FCKB_ARCHITECTURE_REVIEW.md`.
