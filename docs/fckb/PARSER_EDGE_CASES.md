# FCKB — Parser Edge Cases

Dedicated, consolidated edge-case reference intended to directly inform parser implementation. Many individual edge cases are already flagged inline in `WORKOUT_FORMATS.md`, `REP_PATTERNS.md`, and `MOVEMENT_ALIASES.md` at the point where they're structurally relevant — this document's job is to (a) consolidate the highest-impact ones in one place a parser engineer can work from directly, and (b) cover categories that don't belong naturally in any of those three documents at all: input-corruption sources (OCR, messaging apps, PDFs), and — specific to Forge's actual deployment context — bilingual Romanian/English parsing, since WOD-SIMPLE is a Romanian affiliate's own production software, not a generic English-only CrossFit product.

---

## 1. Unit & Load Ambiguity

See `REP_PATTERNS.md` Section 10.2 for the base kg/lb notation rules. Additional edge cases:

- **Bare numbers with no unit at all**: "Deadlift 100" — is this 100kg or 100lb? Resolution requires either (a) a gym-level default-unit setting (the correct primary resolution — Forge already has gym-scoped configuration precedent) or (b) inferring from the movement + rep-range + typical loading conventions for that movement (a much weaker, lower-confidence fallback). A bare number should never be silently assumed to be in one specific unit without at least a gym-default check.
- **Mixed units within a single workout**: rare but real, especially in translated/aggregated programming content — a workout with "Deadlift 100kg" and later "Bench 135lb" in the same block. Each load token must be parsed independently with its own attached unit, never inheriting the unit of an earlier token in the same document.
- **Plate math shorthand**: "2 plates a side", "45s" (meaning 45lb plates), "a 20kg bar + 2 blues" (color-coded bumper plate references — "blue" = 20kg in standard IWF bumper coloring, "green" = 15kg, "yellow" = 10kg, "red" = 25kg — real shorthand in oly-adjacent programming that requires a color-to-weight reference table, not just numeric parsing) — this entire category requires an EQUIPMENT REFERENCE layer (standard plate weights and colors) that FCKB's movement/format/rep-pattern documents don't otherwise need, a real, additional data dependency worth flagging for the architecture review.

## 2. Abbreviation Collisions

Consolidated from `MOVEMENT_ALIASES.md` Section 6 (the authoritative source table) — repeated here because collision resolution is fundamentally a PARSING-TIME concern, not just a data-modeling one:

| Abbreviation | Collision | Primary resolution signal |
|---|---|---|
| DB | Dumbbell / Death By | Position + following-token type (movement name vs. colon+list) |
| SC | Squat Clean / Scaled | Position (attached to movement vs. standalone workout-variant label) |
| SDL | Sumo Deadlift / Stiff Leg Deadlift | Unresolvable from the abbreviation alone in many cases — see MOVEMENT_ALIASES.md 6 |
| SB | Sandbag / Snatch Balance | Programming context (general affiliate vs. dedicated oly session) |
| AB | Air Bike / Assault Bike / "Ab" (abdominal) | Adjacent unit tokens (calorie/duration → bike; rep-range typical of core work → abdominal) |
| RX | Never a movement — a variant/qualifier label | N/A — must be filtered from movement-extraction, not resolved to a movement |

**General rule for the parser**: any abbreviation with more than one real resolution should never be silently resolved to whichever candidate happens to be alphabetically or numerically first in a lookup table — it must go through an explicit disambiguation step, and where that step's confidence remains low, the parsed result should carry a confidence score rather than a false-certain single answer.

## 3. Percentage / RPE / RIR Ambiguity

See `REP_PATTERNS.md` Sections 4.1–4.4 for the base notation. Additional cross-cutting edge case: **a bare number immediately following an "@" symbol is ambiguous between a percentage, an RPE, and a literal weight** depending on magnitude and context — "@ 8" alone (no unit) is very likely RPE (percentages below ~30% are essentially never programmed, so a bare small number after "@" defaults toward RPE), while "@ 80" is very likely a percentage (RPE tops out at 10, so 80 cannot be RPE) — this magnitude-based heuristic is real and usable, but the boundary cases (RPE 9-10 vs. a genuinely tiny percentage, which never happens in practice) mean the heuristic is safe in practice despite being theoretically imperfect.

## 4. Tempo Notation

See `WORKOUT_FORMATS.md` Section 7.9 for the structural definition. Parsing-specific detail: the 4-digit tempo code's positions each independently accept either a digit (0-9, seconds) or the letter `X` (meaning "as fast/explosive as possible" for that phase) — a parser must NOT treat the string as a pure 4-digit number (which would fail entirely the moment an `X` appears, e.g. "30X1") and must NOT treat `X` as a multiplication operator or set-count marker, which is its far more common meaning EVERYWHERE ELSE in workout notation ("5x5", "3x", etc.). Disambiguation rule: an `X` is a tempo-phase marker ONLY when it appears as one character within an otherwise-4-character alphanumeric token immediately following a set/rep prescription and preceding (or following) the word "tempo" or appearing in a position consistent with the 4-phase eccentric/pause/concentric/pause structure — in every other position, `X` retains its standard multiplication/set-count meaning.

## 5. OCR Artifacts (Whiteboard Photos)

A real, common source of programming text this document's earlier sections don't address at all: many affiliate coaches photograph a physical whiteboard and either manually retype it or run it through OCR (optical character recognition) rather than typing the workout directly into a digital system. This introduces a distinct class of corruption:

- **Digit/letter confusion**: `5` ↔ `S`, `0` ↔ `O`, `1` ↔ `I`/`l`, `8` ↔ `B` — extremely common OCR failure modes, meaning a rep scheme like "21-15-9" could OCR as "2I-I5-9" or "21-l5-9" and needs a normalization pass that corrects these specific, well-known substitution patterns BEFORE attempting numeric parsing, not after.
- **Handwriting-specific misreads**: cursive or stylized whiteboard handwriting (common in gyms that use a consistent "house style" for whiteboard programming) produces OCR errors that don't follow the clean digit/letter patterns above — e.g. a hyphen written as a long dash and misread as an em-dash or entirely dropped, collapsing "21-15-9" into "211 5 9" or similar. This class of error is much harder to systematically correct and may require flagging the whole line as low-confidence for human review rather than attempting automatic repair.
- **Partial occlusion**: a marker tray, a person's hand, or glare in the photo obscuring part of the board — resulting in genuinely MISSING text, not corrupted text, which is a different failure mode requiring the parser to recognize "this rep scheme has a gap" (e.g. "21-_-9") rather than attempting to force a match on obviously incomplete input.
- **Multi-column whiteboard layout**: many affiliates write the day's strength piece and metcon in separate physical columns/sections of the same board — OCR (and even careful manual transcription under time pressure) can interleave lines from different columns in physical top-to-bottom reading order rather than each column's own logical order, silently merging two unrelated workout blocks into nonsense. This connects to Section 7 below (missing section headers) — a strength block and a metcon block each individually parse fine, but their LINES interleaved incorrectly do not.

## 6. Messaging-App Formatting Loss (WhatsApp, SMS, Class Group Chats)

Workouts are frequently shared via WhatsApp or similar messaging apps (a dominant channel for affiliate class communication generally, and specifically common in the Romanian/European gym context Forge operates in) rather than a dedicated programming tool, introducing:

- **Autocorrect corruption**: mobile autocorrect can silently "fix" a movement abbreviation into an unrelated real word it judges more likely — "DU" (Double Under) autocorrected to "DUE" or "DO", "T2B" left alone (autocorrect rarely touches alphanumeric mixes) but "OHS" occasionally autocorrected to "OHNS" or similar nonsense on some keyboards/locales.
- **Emoji substitution for movements or emphasis**: a real, casual-but-real pattern in social/community-facing workout posts — 🏋️ or 💪 used decoratively adjacent to a movement name (not usually AS a movement name, but close enough in position to confuse a naive tokenizer that doesn't specifically filter emoji before parsing).
- **List auto-reformatting**: WhatsApp and similar apps sometimes auto-convert a hyphen-prefixed list into a different bullet character or auto-number a list the sender didn't intend as numbered, which can visually (and sometimes textually, depending on copy-paste behavior) alter a rep scheme's hyphen-joined notation (`21-15-9`) if the sender typed it as a genuine list rather than inline text — a real collision between "list formatting" and "rep-scheme notation" both legitimately using hyphens/numbers.
- **Line-break collapse on copy-paste**: copying text out of a chat app and pasting it elsewhere frequently collapses multiple newlines into fewer, or single newlines into spaces, depending on the source/destination app pairing — meaning a cleanly-formatted multi-line workout can arrive as a single run-on line, making Section 7's "missing section header" problem (and the general movement-list-splitting problem, `REP_PATTERNS.md` Section 11) much more common in practice than clean, directly-typed input would suggest.

## 7. PDF Line-Break & Layout Loss

Programming distributed as a PDF (common for structured strength programs — 5/3/1 templates, CompTrain/HWPO-style subscription programming, printed affiliate handouts) introduces its own distinct corruption class when the text is extracted (copy-pasted or programmatically parsed) rather than read visually:

- **Column-based layouts**: a PDF laid out in 2 columns (common for compact weekly-program printouts) extracts, via most naive text-extraction tools, in an order that reads straight across BOTH columns line-by-line rather than down one column then the other — silently interleaving two unrelated days' or blocks' content, structurally identical in effect to Section 5's multi-column whiteboard problem but from a completely different source.
- **Hyphenation across line breaks**: PDFs (especially ones generated from print-oriented software) sometimes hyphenate a word at the visual line break for justification purposes — "Chest-to-Bar Pull-up" could extract as "Chest-to-Bar Pull-\nup" with a spurious mid-word line break, which a naive newline-based section-splitter would misread as two separate lines/entries rather than one movement name with an incidental typographic break.
- **Table cell boundary loss**: strength programs frequently present sets/reps/load/RPE as a table; naive PDF text extraction commonly loses the CELL boundaries entirely, producing a flat sequence of numbers/words with no reliable way to tell which number belonged to which column without positional (not just sequential) extraction — a real, hard problem beyond simple regex-based text parsing, more a PDF-extraction-engineering concern than a text-parsing one, but flagged here since it directly determines what TEXT the FCKB parser ever actually receives as input.

## 8. Missing Section Headers

See `REP_PATTERNS.md` Section 11 for the base "bare movement list" fallback pattern. Additional edge case: a workout with MULTIPLE distinct blocks (e.g. a strength piece followed by a metcon) but NO explicit block-separating header at all — just a blank line, or nothing — between them. The parser cannot always safely assume "everything is one workout" nor "every blank line is a hard block boundary" (blank lines are also used for pure visual spacing within a single block by many coaches) — a real, sometimes-unresolvable ambiguity that may require a confidence-scored best-guess split (e.g. splitting where the CONTENT itself changes character — from strength-format numeric patterns to metcon-format rep-movement lists — rather than relying on whitespace alone).

## 9. Nested EMOMs

A real, if less common, structure: an EMOM whose own per-minute content is ITSELF a smaller interval structure, not a flat movement+rep prescription — e.g. "EMOM 30: odd minutes — EMOM-style 20s on/10s off x2 rounds of burpees; even minutes — rest." This is structurally a 2-level nesting the flat `intervals` list model (`WORKOUT_FORMATS.md` 3.4) doesn't cleanly represent, since each "interval slot" itself needs to be able to contain another full interval-format definition rather than just a plain movement/rep pair — the same COMPOSABILITY concern `WORKOUT_FORMATS.md` Section 17 raises generally, surfacing here in its most structurally demanding real form.

## 10. Partner & Shared-Rep Notation Edge Cases

See `WORKOUT_FORMATS.md` Section 9 and `REP_PATTERNS.md` Section 12 for the base structural/notation treatment. Additional edge cases not covered there:

- **Uneven-ability partner scaling**: "Partner WOD, split reps based on ability (stronger partner does more)" — a real, common instruction with NO fixed numeric split at all, meaning the workout's own text provides literally no extractable rule for how reps divide, only a qualitative principle. This is fundamentally unparseable into a fixed `split_type`/ratio and should be captured as a free-text coaching note rather than forced into the structured split model.
- **"RX as a team" ambiguity**: a partner/team workout labeled "Rx" without clarifying whether EACH partner must individually complete RX-standard reps/loads, or whether the TEAM's combined effort needs to meet a team-level RX standard (common in competition-style team events, distinct from casual affiliate partner WODs) — a real scoring-integrity ambiguity, not just a notation one.

## 11. Interval Shorthand Collisions

Consolidated from `WORKOUT_FORMATS.md` Sections 3.2 and 6.3: "E90MOM"/"E90SOM" (every-90-seconds shorthand) is genuinely ambiguous between seconds and an ill-formed minutes notation; "on the X:XX" clock-time notation collides with both time caps and logged result times. Both are real, unresolved-by-a-single-rule ambiguities requiring surrounding context, not a clean regex fix — repeated here as the authoritative consolidated list rather than re-derived.

## 12. Complex Notation — Order Preservation

See `WORKOUT_FORMATS.md` Section 7.7. Restated here because it's a correctness-critical parsing rule, not just a data-modeling note: a Complex's movement list is ORDERED and that order is semantically load-bearing (the complex must be performed in the stated sequence without dropping the bar) — any parsing step that reorders, deduplicates, or alphabetizes a movement list (a reasonable thing to do for a plain, unordered Chipper/For Time movement list) would silently corrupt a Complex's actual meaning. The parser needs an explicit `preserve_order: true` flag or equivalent internal marker the moment it recognizes a Complex format, distinct from its default handling of ordinary movement lists.

## 13. Movement Abbreviations Embedded Inside Rep Schemes

A genuinely tricky, real pattern: "21-15-9 T&P" (Thrusters and Pull-ups, abbreviated to their initials and joined with an ampersand, standing in for the full movement-list that would normally follow a rep scheme on its own line) — this requires the parser to recognize that a short, capitalized, ampersand-or-slash-joined token immediately following a rep scheme is likely a MOVEMENT ABBREVIATION LIST, not a single unfamiliar term, and attempt to expand each letter-group against known movement-initial patterns — a meaningfully harder inference than a normal alias lookup, since the input isn't a full alias string at all, just initials, and initials collide constantly (T could mean Thruster, Toes-to-Bar via "T2B" already abbreviated further, or dozens of other T-movements) — flagged as a LOW-confidence, best-effort pattern rather than one the parser should ever resolve with high certainty, and one where prompting for clarification (rather than silently guessing) is the safer product behavior.

## 14. Profanity-Filter & Platform Corruption

Noted briefly in `MOVEMENT_ALIASES.md` Section 4: "Snatch" is a real English word that automated profanity/content filters in some messaging platforms or forum software can flag or censor (e.g. rendering as "sn*tch" or blocking the message outright), corrupting legitimate workout text purely because of an unrelated, coincidental vulgar-word collision. A parser encountering a censored/starred token in a position consistent with a movement name should attempt movement-name reconstruction from the surrounding context (rep scheme + adjacent known movements + partial character match) rather than failing outright — a real, if narrow, robustness requirement.

## 15. Bilingual Romanian/English Parsing (Forge-Specific)

**This section is not a generic "any language" placeholder — WOD-SIMPLE is the production software of a real Romanian CrossFit affiliate, and Forge's own admin/member-facing UI is already bilingual (RO/EN, per this codebase's own `translations.js` and the completed i18n initiative referenced in this project's history). Bilingual programming text is a real, current, non-hypothetical input Forge already needs to handle correctly, not a speculative future concern.**

- **Mixed-language single workout**: it's extremely common for a Romanian coach to write a workout with Romanian STRUCTURAL words (format labels, instructions) but English MOVEMENT names, since CrossFit movement terminology is overwhelmingly used in its original English form even by non-English-speaking affiliates worldwide (a real, near-universal pattern in the global CrossFit community, not specific to Romania) — e.g. "Pentru timp: 21-15-9 Thrusters, Pull-ups" ("For Time" in Romanian, movement names in English). The parser must recognize Romanian format/structure keywords (`pentru timp` = For Time, `runde` = rounds, `pauza`/`odihna` = rest, `fiecare rundă` = each round) ALONGSIDE English movement names in the SAME line, not assume the whole input is one language.
- **Romanian format-keyword table** (a real, necessary addition beyond the English-only vocabulary implied by the source v1.0 architecture and by `WORKOUT_FORMATS.md`'s own English-centric aliases): `pentru timp` (For Time), `runde` (rounds), `cât mai multe runde posibil` / commonly abbreviated informally (AMRAP, rarely fully translated), `în fiecare minut` (EMOM, "every minute"), `odihnă`/`pauză` (rest), `greutate` (weight/load), `repetări` (reps).
- **Decimal comma vs. decimal point**: Romanian (and most continental European) number formatting uses a COMMA as the decimal separator and a period/space as the thousands separator — the exact inverse of US convention. "21,5 kg" in Romanian text means 21.5kg, NOT "21 and 5" as two separate numbers, and NOT 21,500 as a US-style thousands-separated integer. A parser tuned only for US number formatting will badly misread Romanian-authored load prescriptions containing a fractional kilogram value — a real, concrete, high-consequence bug risk specific to Forge's actual user base, not a theoretical edge case.
- **Diacritics**: Romanian uses ă, â, î, ș, ț — text copy-pasted from sources that strip or mis-encode these (a real, common occurrence with certain keyboard layouts, older software, or cross-platform copy-paste) can corrupt Romanian structural keywords in ways the parser's Romanian-keyword table needs to tolerate (matching both the correctly-diacritic'd and the stripped/corrupted form, e.g. both `pauză` and `pauza`/`pauzä`) — connects to `MOVEMENT_ALIASES.md` Section 1.6's general diacritic-stripping normalization rule, but this is the concrete, non-hypothetical case that rule actually needs to handle in Forge's real deployment, not an abstract internationalization nicety.
- **Date/time formatting**: Romanian convention is DD.MM.YYYY (or DD/MM/YYYY), the inverse of US MM/DD/YYYY — while not a movement-parsing concern directly, any workout text that embeds a date (e.g. referencing "programarea din 05.08" meaning August 5th, not May 8th) is a real source of date-misparsing risk if a US-convention-only date parser is ever applied to Romanian-authored free text — flagged for completeness even though it's adjacent to, not strictly inside, FCKB's own movement/format parsing scope.

## 16. Ambiguous Rest Notation

"Rest 2 min" appearing between two rounds is unambiguous (rest BETWEEN rounds); "Rest 2 min" appearing between two movements WITHIN a single round's description is a materially different, less common but real prescription (rest between exercises, not between full rounds) — e.g. "10 Thrusters, rest 2 min, 10 Pull-ups, rest 2 min" repeated for 3 rounds describes 6 total rest periods, not 3, and a parser assuming "rest" always means "between rounds" would under-count the actual rest prescribed by half.

## 17. Number-Formatting Collisions Beyond Decimal Comma (Section 15)

- **Thousands separators**: "1.000m" (Romanian/European, meaning 1000 meters) vs. "1.000" potentially misread as "1.0" truncated or as a decimal by a US-convention parser — collides directly with Section 15's decimal-comma point but restated here as a general (not Romania-specific) formatting-collision class relevant anywhere Forge's parser encounters European-formatted numbers, including from non-Romanian European coaches whose programming content might also reach Forge (e.g. via imported/shared programming from other European affiliates).
- **Range notation ambiguity**: "8-10 reps" (a genuine range, meaning "somewhere between 8 and 10") is visually IDENTICAL in raw-text form to "8-10" as a rep-scheme hyphenated sequence element (`REP_PATTERNS.md` Section 1) if it appears as the ONLY number in a rep-scheme-shaped position — e.g. is "8-10 Pull-ups" a range prescription for ONE set, or a 2-round descending/ascending ladder of 8 then 10 reps? Genuinely ambiguous from the numbers alone; resolved (when resolvable at all) by whether the surrounding format is strength-oriented (range) or metcon-round-oriented (ladder), the same category of disambiguation already established for several other collisions in this document.

## 18. Missing Edge-Case Categories Identified (Summary)

1. **OCR/whiteboard-photo corruption** (Section 5) — entirely absent from the mission's own example list, despite being a real, common real-world input source for affiliate programming.
2. **PDF layout/extraction loss** (Section 7) — the mission's own list mentions "PDF line breaks" but this document goes further into column-interleaving and table-cell-boundary loss specifically.
3. **Bilingual Romanian/English parsing with decimal-comma numbers** (Section 15) — entirely absent from the mission's own generic list, but directly, concretely relevant to Forge's actual deployment in a way none of the mission's own listed examples are — arguably the single most PRODUCT-RELEVANT edge case in this entire document precisely because it isn't hypothetical for Forge specifically.
4. **Ambiguous rest-notation scope** (Section 16) — absent from the mission's own list.
5. **Range-vs-ladder numeric collision** (Section 17) — absent from the mission's own list.
6. **Equipment/plate-color reference data need** (Section 1) — a real, additional data-maintenance dependency beyond pure text parsing, in the same family as the HYROX/PT-test reference-data dependencies already flagged in `WORKOUT_FORMATS.md`.

## 19. Real Edge-Case Count

18 distinct, numbered edge-case categories cataloged in this document (Sections 1–17, with Section 18 being this summary and not counted as its own case), several containing multiple named sub-cases. This document is explicitly a CONSOLIDATING and EXTENDING document rather than a from-scratch catalog — its role is to make sure a parser engineer has one place to find every edge case flagged across the whole FCKB research package, plus the categories (OCR, messaging/PDF corruption, bilingual parsing) that don't belong naturally inside `WORKOUT_FORMATS.md`, `REP_PATTERNS.md`, or `MOVEMENT_ALIASES.md` individually.
