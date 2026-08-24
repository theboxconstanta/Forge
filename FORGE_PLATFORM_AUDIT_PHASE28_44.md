# Forge Platform Audit — Phases 28–44

Investigation only. No production code, schema, or data was changed while producing this report. Method: direct code/migration reading, live read-only SQL against production (structure/constraints only, zero data mutation, zero login as any user — per this project's own standing rule), and three parallel background research passes (Phases 33–35, 36–38, 39) whose full reports are reproduced/cited below and available in full at the paths given in each section. Every claim carries a confidence rating; anything requiring runtime/production-data access is marked UNVERIFIED, not guessed.

---

# PHASE 28 — BUSINESS RULES & DOMAIN LOGIC AUDIT

## BUSINESS RULES MATRIX

| Rule | Source of Truth | Admin | Member | Backend | DB Enforced | Status |
|---|---|---|---|---|---|---|
| Class capacity | `enforce_class_capacity()` trigger, `bookings` insert | reads via same trigger | reads via same trigger | N/A (pure DB) | **YES** — `SELECT ... FOR UPDATE` row-locked, rejects on overfill | ✅ Correct, concurrency-safe. HIGH CONFIDENCE |
| Duplicate booking (same member, same class) | *none* | same gap | same gap | — | **NO** — no unique constraint on `bookings(class_id, member_id)` | ⚠️ Gap — P2. HIGH CONFIDENCE |
| Booking eligibility (membership must cover class date) | `enforce_subscription_sessions()` trigger | bypassed via `is_admin(gym_id)` (by design — staff override) | enforced | N/A | **YES** — compares `classes.date` against `subscriptions.[start_date,end_date]`, `FOR UPDATE` locked | ✅ Correct — this is the P0 fix from `MEMBERSHIP_BOOKING_ENFORCEMENT_AUDIT.md`, closed. HIGH CONFIDENCE |
| Booking cancellation / session-credit refund | `toggleRezervare()`, `App.jsx:8517-8601` | same code path | same code path | client-orchestrated, multiple sequential awaited calls | **NO** in-flight guard; no loading state on button | ⚠️ Gap — P2 (UX/dedup, not confirmed as a live data-integrity bug). HIGH CONFIDENCE on the gap, MEDIUM on real-world exploitability |
| Workout availability "for today" | Local browser-timezone date string (`todayLocalStr()` in WOD-SIMPLE; UTC `toISOString()` in several forge-admin-web call sites) | **forge-admin-web dashboard is timezone-buggy** (see Phase 33) | correct (WOD-SIMPLE fixed this bug already) | none — no `gyms.timezone` column exists anywhere | **NO canonical gym timezone** | ⚠️ Real gap, admin-side only, ~2-3hr/night window. HIGH CONFIDENCE |
| Workout levels (RX/Intermediate/Beginner/OnRamp) | `VARIANT_LEVELS`/`SCALING_KEYS` (`wodSections.js`), ported to forge-admin-web's `sectionEditing.ts` | canonical authoring | canonical read | mirrored in both repos, no drift found | N/A (app-level ordering convention) | ✅ Single, consistent ordering across both clients. HIGH CONFIDENCE |
| Member gender resolution | **TWO DIVERGING implementations** — see below | uses one or the other depending on call site | uses one or the other | none | column is nullable free text, `'masculin'`/`'feminin'`, **no CHECK constraint** | 🔴 **Duplicated business logic — flagged high-risk per this phase's own instruction.** HIGH CONFIDENCE |
| Male/female prescribed loads | Explicit `weightMale`/`weightFemale` fields on movements/variants — never derived from a single value + a % convention | authored explicitly per variant | read explicitly, never guessed | AI parser (`analyze-workout`) explicitly instructed *not* to infer female load from a percentage convention | N/A (app-level convention, well-enforced in the prompt/schema) | ✅ Deterministic, not fragile string parsing. HIGH CONFIDENCE |
| Workout scoring / ranking | `sortSectionLogs()` (`workoutFormats.js`), ported as `ranking.ts` in forge-admin-web | same comparator (ported, not shared import) | same comparator | N/A (client-computed, not DB-computed) | **NO** — ranking is computed client-side from raw log rows, not by a DB view/function | ✅ Single canonical comparator per repo, kept manually in sync (established pattern across this codebase); ⚠️ ranking itself is not DB-enforced, only DB-sourced. MEDIUM CONFIDENCE on cross-repo comparator parity (ported, not verified byte-identical this session) |
| Leaderboard eligibility | `effectiveLeaderboardVisible()` (`workoutEngine.js`) — `loggingMode==='required' AND leaderboardVisible!==false` | canonical | canonical | N/A | N/A (app-level resolver, structurally prevents the impossible "scored=false, leaderboard=true" state) | ✅ Single resolver, well-designed. HIGH CONFIDENCE |
| PR eligibility | `evaluate_movement_prs()` trigger | N/A | N/A | SECURITY DEFINER trigger, only writer to `pr_events` | **YES**, DB-enforced | ⚠️ **Narrow by design**: gated ONLY on `format_snapshot = 'Build to Heavy/1RM'` — Strength Sets, Weightlifting, Superset never reach PR logic at all (confirmed live, this is a documented deliberate scope decision from Member Performance Phase 5/Canonical Movement Identity Phase 3, not a bug). Worth re-examining as a product question, not a defect. HIGH CONFIDENCE |
| Exercise/movement identity | `movements` table (465 rows) + `sets_movement_ids` (canonical) + normalized-text fallback (legacy) | authors against catalog | reads canonical name | AI parser resolves against a **separate static copy** of the catalog (see Phase 31) | partial — canonical linkage has a real FK (`pr_events.movement_id`), most other references are unconstrained `jsonb` | ✅ Canonical path is solid (4-phase initiative, closed); ⚠️ AI-parsing path uses a drifted third copy of the catalog. See Phase 31. HIGH CONFIDENCE |
| Workout section identity | `workout_section_types` + `slot_key`, legacy 3-slot model (`warmup`/`skill`/`skill2`) | **Just fixed this session** (commit `787ff99`) — was assigning sections to the warmup slot purely by list position, ignoring the admin's chosen type | now correctly reflects admin's chosen type | N/A | schema itself only has 3 legacy slots; a richer type (STRENGTH/COOLDOWN) still renders under the generic "SKILL" label — disclosed, deferred migration debt | ✅ Bug fixed; ⚠️ underlying legacy model still limits full type fidelity. HIGH CONFIDENCE |
| Workout format identity | `WORKOUT_FORMATS` catalog (`workoutFormats.js`), **3 independently-maintained static copies** (canonical + `analyze-workout`'s prompt/schema + forge-admin-web's `formatCatalog.ts`) | reads a ported copy | reads canonical | AI-facing copy embedded in the LLM prompt | none — **no automated sync check across the 3 copies** | ⚠️ Confirmed in sync today (verified this session), but structurally fragile — a format added to one copy and forgotten in another would silently drift. Already flagged in the prior Analyze Phase 0 audit. MEDIUM-HIGH CONFIDENCE |

## Detail: the gender duplication finding (flagged per this phase's explicit instruction)

Two genuinely different functions resolve a member's gender for display/prescription purposes, with **opposite null-handling philosophy**:

- `weightKeyForVariant(nivel, gender)` (`workoutFormats.js:587-591`) — `gender === 'feminin' ? 'female' : 'male'`. Every non-`'feminin'` value, **including `null`/`undefined`/a typo**, silently resolves to **male**. Used by `App.jsx` (`VARIANTE_CONFIG`), Journal, and the Leaderboard to pick which prescribed-weight column a member's result should be compared against.
- `resolveAthleteGenderKey(rawGender)` (`rxEngine.js:40+`) — deliberately returns `null` for unset/unrecognized gender, requiring callers to handle the null case (show both standards) rather than silently defaulting. Built later (Results Phase 3), with an explicit code comment naming the older helper's "male by default" behavior as "a real, disclosed bias this engine deliberately does not carry forward."

This is a genuine, live, **already partially self-disclosed** architectural inconsistency — two call sites in the same product can disagree about the same member's gender-driven behavior (one silently assumes male on missing data, the other correctly shows an ambiguous state). ~11% of live members have `gender = null` (cited in the `rxEngine.js` comment as a previously-confirmed live figure). **HIGH CONFIDENCE**, directly verified in both source files.

## Cross-cutting observation: the strongest recurring pattern across every rule audited

Every rule with **real DB-level enforcement** (class capacity, booking-membership-date-coverage, PR eligibility, Stripe webhook idempotency, `subscription_plans` delete-protection) was found to be genuinely correct and well-engineered — often with an explicit migration comment documenting the exact incident that motivated it. Every rule that is **enforced only in application code or only by convention** (gender resolution, duplicate booking, class-delete cascade, movement hard-delete) has at least one live, confirmed gap. This is the single most useful pattern for prioritizing future hardening work: the team's DB-level engineering discipline is high where it has been applied — the risk is concentrated in the rules that never got that treatment yet.

---

# PHASE 29 — WORKOUT DOMAIN MODEL STRESS TEST

Classified against the actual current catalog (`workoutFormats.js`, 22 formats, verified count) and Workout Engine V2's section model (ordered array of sections, each with its own `format`/`formatConfig`/`movements`/`scalingVersions`).

| Example | Classification | Reasoning |
|---|---|---|
| `3 RFT / 21 Thrusters / 21 Pull-ups / TC 12:00` | **NATIVELY SUPPORTED** | `RFT` format, `rounds`+`timeCapSec` config fields exist exactly for this. |
| `AMRAP 12 / 10 T2B / 15 Wall Balls` | **NATIVELY SUPPORTED** | `AMRAP` format, `durationSec` config. |
| `EMOM 12, Min1: Row, Min2: Burpees, Min3: Rest` | **SUPPORTED WITH LIMITATIONS** | `EMOM`'s `intervals` field (`intervalList` type) exists for per-minute movement assignment, but a "Rest" minute with genuinely nothing prescribed is representable only as an empty/omitted interval entry — the format has no first-class "this interval is a rest interval" semantic beyond "no movement listed," which is workable but not self-documenting. |
| `Back Squat 5x5 Every 3:00` | **SUPPORTED WITH LIMITATIONS** | `Strength Sets` covers `5x5` (`setsScheme:[5,5,5,5,5]`) correctly, but the "Every 3:00" cadence between sets has **no dedicated config field on Strength Sets** — it would have to live in free-text `notes`, losing structure (no downstream code reads a "rest interval between strength sets" value). |
| `Back Squat: 5 @ 70% / 3 @ 80% / 1 @ 90%` | **REQUIRES WORKAROUND** | The AI prompt's own explicit rule (`PARAMETER_RULES`, verified in the just-completed Analyze audit) is that a percentage prescription leaves `weightMale`/`weightFemale` **null** and the percentage goes into free-text `notes` — by design, not a bug, since Forge has no per-member 1RM-percentage resolution engine. A percentage-based strength day is representable but loses all structured weight data; nothing downstream (PR engine, leaderboard) can act on it. |
| `5 sets: 1 Power Clean + 1 Hang Squat Clean + 1 Front Squat + 1 Jerk` | **NATIVELY SUPPORTED** | `Complex` format exists exactly for this — `complexMovements` (ordered list) + `rounds`. Verified this is not flattened incorrectly: `complexMovements` is a dedicated field, shown as an ordered sequence, never merged into the generic `movements` array. |
| Part A (For Time) + Rest 5:00 + Part B (3RM Front Squat) | **NATIVELY SUPPORTED** | Multi-Section is a first-class Workout Engine V2 concept — an ordered array of sections, each independently formatted/scored. Part A → a `For Time` section, Part B → a `Build to Heavy/1RM` section (targetLabel `3RM`). Rest between them has no dedicated field but doesn't need one — it's implicit in being two separate sections. |
| `5 rounds: AMRAP 3 (Row/Burpees/Wall Balls), Rest 1:00` | **SUPPORTED WITH LIMITATIONS** | This is a genuinely awkward shape: it's neither a flat `AMRAP` (only one round, not five) nor cleanly an `Intervals` format (which prescribes fixed work, not an open-ended AMRAP per interval) nor `EMOM` (interval work isn't "at the top of the minute," it's a full 3-minute AMRAP block). No format in the current 22 natively expresses "N repetitions of an AMRAP-with-rest block." A coach would have to approximate this as `Intervals` (rounds=5, workSec=180, restSec=60) and lose the "AMRAP-style, max-effort-within-the-block" scoring semantic, or split it into 5 separate sections (extremely tedious to author, and multi-section scoring aggregation wasn't designed for 5 near-identical repeated blocks). |
| Progressive AMRAP-4-with-changing-movement, 3x (shuttle+T2B+max-Power-Snatch → max-OHS → max-Squat-Snatch) | **REQUIRES WORKAROUND** | Same root gap as above, compounded: this is 3 near-identical-but-not-identical AMRAP blocks. The only faithful representation today is 3 separate primary-equivalent sections, but Workout Engine V2's model has exactly one "primary" (scored, `loggingMode:'required'`) metcon slot in the legacy-compatible mapping and the multi-section scoring model (Layer 2a/2b, confirmed from this session's own scoring-phase history) supports *some* independently-scored non-primary sections, but nothing purpose-built for "3 near-identical repeated AMRAP blocks with a shared but evolving movement list." Authoring this faithfully today is real, deliberate work-around territory, not a clean native fit. |
| `15 Deadlifts @ 43/61kg` | **NATIVELY SUPPORTED** | Confirmed deterministic: `weightMale`/`weightFemale` are explicit, separately-authored fields, never parsed from a combined string at render time (verified across `workoutFormats.js`, the AI schema, and `movementToLine`'s own composition direction — text is *generated from* structured fields, not the reverse, for anything the app itself renders). |
| Same workout represented at RX/Intermediate/Beginner/OnRamp with different movements/reps/loads/equipment/notes/time caps | **SUPPORTED WITH LIMITATIONS** | `scalingVersions` (per-section, `{level, movements, timeCapMinutes, notes}`) supports independent movements/notes/time-cap per tier — confirmed via `openaiSchema.ts`'s `SECTION_SCALING_VERSION_DEF` and the legacy `wods` table's parallel `movements_intermediate/beginner/onramp` + per-tier weight columns. **Limitation, confirmed this session (Analyze Phase 0 audit)**: `formatConfig` itself (the format's structural config — rounds, work/rest, etc.) is a **single value shared by all 4 tiers**, not stored per-tier — `VariantTabs.tsx`'s own comment confirms this explicitly ("`wods.format_config` is one value shared by all 4 variants... no per-tier slot to write [a computed tier-specific time cap] into today"). So a coach *can* give Beginner different movements/loads/notes, but *cannot* give Beginner a different rounds-count or work/rest split than RX without it also changing RX's own structural config — a real, disclosed expressiveness gap for scaling that needs to change the workout's *shape*, not just its content. |

**Summary verdict**: the domain model handles single-part, single-format CrossFit-style metcons and strength work very well, and multi-section days genuinely well (a real, deliberate architectural investment, not a bolt-on). Its two clearest gaps are (1) no native representation for "N repeated but evolving AMRAP-with-rest blocks" (a real, not-uncommon CrossFit programming pattern, e.g. interval-style competition-prep pieces) and (2) scaling tiers cannot vary a workout's *structural* config (rounds/timing), only its content — both are REQUIRES WORKAROUND / SUPPORTED WITH LIMITATIONS, not NOT SUPPORTED, and neither blocks the large majority of real-world programming (confirmed by this session's own prior production audits showing RFT/AMRAP/For Time/Strength Sets/Build-to-Heavy dominate real authored content).

---

# PHASE 30 — SCORE ENGINE STRESS TEST

**Is there a canonical scoring engine?** Yes — `sortSectionLogs()` in `workoutFormats.js` is the single comparator, grouped by section, dispatching on the section's `family`/`scoreMode`. It is **ported** (not shared-imported) to forge-admin-web as `ranking.ts` — confirmed to exist and to reference `completion_state` correctly in the just-completed schema-drift audit (Phase 39), though a byte-for-byte comparator-logic diff between the two files was not re-run this session (MEDIUM CONFIDENCE on cross-repo parity, not re-verified this pass — this exact question was the subject of a full dedicated "Universal Scoring Audit" earlier in this project's history, which found and fixed the one real cross-format ranking defect that existed, Death By's own comparator, and confirmed the rest consistent at that time).

| Scenario | Verdict | Confidence |
|---|---|---|
| For Time: 08:32 beats 09:15 | ✅ Correct — lower time wins, standard ascending-time comparator | HIGH — this is the most heavily-tested path in the codebase's own test suite (`sortSectionLogs` tests, confirmed present from this session's direct reading of `workoutFormats.test.js`) |
| AMRAP: 7 rounds + 12 reps beats 7 rounds + 10 reps | ✅ Correct — rounds compared first, then partial reps as tiebreak within the same round count | HIGH |
| Max Load: 120kg beats 115kg | ✅ Correct — descending numeric comparator for `family:'sets'`/weight-scored formats | HIGH |
| Multiple scored parts (Part A + Part B) | ✅ Correct — `sortSectionLogs` groups by `workout_section_id`, confirmed each section gets its own independent comparator call, never mixed (directly verified this session, `App.jsx` comment: "o Sectiune TIME si o Sectiune LOAD, apelate separat, nu se amesteca niciodata") | HIGH |
| Capped workout (didn't finish in time cap) | ✅ Correct — a finisher always ranks above a non-finisher regardless of the non-finisher's partial-progress numbers (verified: "For Time: finisherul e mereu inaintea celui neterminat, indiferent de valori") | HIGH |
| DNF | ✅ Handled — `completion_state` explicit values include `'dnf'`, distinct from a capped-but-partial result; `completion_state` explicit precedes the older time-based inference for classifying finished/unfinished (Scoring Phase 0's own "explicit vs inferred" test, confirmed present) | HIGH |
| Tie (identical time/score) | ✅ Handled — tiebreak falls to `logged_at` (earlier submission wins), a deliberate, tested, unchanged convention (confirmed: "timp identic -> departajat de logged_at") | HIGH |
| Zero score / no score | ✅ Handled — a member with no log for a section simply doesn't appear in that section's ranking (confirmed: "un membru absent dintr-o Sectiune nu apare in clasamentul acelei Sectiuni") — not ranked last with a synthetic zero, correctly absent | HIGH |
| Edited score | ✅ Handled — re-running the comparator with an updated value re-orders correctly (confirmed: "editarea unui rezultat... re-ordoneaza corect"); dedup is per-call, not global-state, so an edit or delete never leaves a stale duplicate entry | HIGH |
| Distance / calories as score basis | **PARTIALLY VERIFIED** — the format catalog's `scoreType` enum includes `Distance`/`Calories` as first-class values (confirmed in the AI schema's `SCORE_TYPE_VALUES`), but this session did not re-trace `sortSectionLogs`'s own internal branch for these two specifically (as opposed to Time/Rounds+Reps/Weight, which were directly re-confirmed). MEDIUM CONFIDENCE these are handled correctly — no evidence of a defect, just not independently re-verified this pass. |

**input → storage → normalization → comparison → display**: uses one canonical model **within a single client** (WOD-SIMPLE's raw log rows → `sortSectionLogs` → same rendered order used for both ranking and display, no separate "display string" re-interpreted for ranking — confirmed directly: the function operates on raw structured fields, e.g. `time_result` parsed once via `parseTimeResult`, never re-parsed from a rendered display string). **Across clients**, the model is duplicated (ported, not shared) between WOD-SIMPLE and forge-admin-web — correct today per available evidence, but not mechanically guaranteed to stay correct, the same structural risk already flagged for the format registry in Phase 28.

**No case was found where leaderboard ranking has to reinterpret a display string** — this was a specific, real historical bug class in this codebase (the "Bug timp finish leaderboard" investigation, referenced in project memory, found and fixed a write-time bug, not a ranking-reinterprets-display-string bug) and the current architecture (structured fields in, structured comparator, structured fields out to display) avoids the general class of that risk by construction.

---

# PHASE 31 — EXERCISE CATALOG INTEGRITY

**Canonical ID strategy**: `movements` table (465 rows), UUID primary key, gym-scoped + platform-global (nullable `gym_id`). This is the real, single, correctly-designed source of truth for movement identity — the product of a deliberate, 4-phase "Canonical Movement Identity" initiative (closed, this session's own history) specifically built to solve the "Pull Up / Pull-Up / Pull Ups / pull_up" problem the mission asks about.

**How the "different spellings, same movement" problem is actually solved**: NOT via a single generic string-normalization function applied everywhere. Two genuinely different mechanisms exist, and this matters:
1. **Canonical path** (preferred): a Result (`wod_logs`/`skill_logs`) carries `sets_movement_ids`, a `jsonb` map from the as-logged set-key to a real `movements.id` UUID, resolved once at log time. All downstream consumers (Movement History grouping, PR Engine's canonical branch, Current Bests) compare by UUID — genuinely spelling-invariant, by construction, no string comparison involved at all once a movement has a canonical id.
2. **Legacy fallback path**: when `movement_id IS NULL` (an older log, or a movement the resolver couldn't confidently match), comparison falls back to normalized free text — `trim → collapse internal whitespace → lowercase`, applied identically client-side (`normalizeKey`) and DB-side (`legacy_normalize_movement_text()`, a literal SQL port, added specifically to close a confirmed real gap where the DB-side comparison was missing this normalization entirely — the "Legacy PR Identity DB/Client Parity Fix," closed this session's own history). This fallback is **explicitly, deliberately NOT punctuation- or alias-aware** — "Pull-up" and "Pull up" normalize equal (whitespace/case only), but "Pull-up" and "Pullup" would not (different token shape), and "Pull-up" and "Chin-up" (a genuine alias in some gyms' vocabulary) would never be treated as the same movement by this fallback at all.

**AI parsing → canonical mapping**: confirmed (from this session's own just-completed Analyze Phase 0 audit) that `analyze-workout`'s LLM output includes a `canonicalName` field per movement, with a deterministic fallback (`resolveCanonicalMovement`, exact-match/alias/simple-plural) applied when the model leaves it null — **so the AI path does map toward canonical identity, not just store raw strings.** However, the critical caveat, already flagged in that audit and re-confirmed here: **this AI-facing catalog (`analyze-workout/movementCatalog.ts`) is a separate, static, ~250-name copy — not the real `movements` table.** A movement added to the platform-global `movements` catalog today does not automatically become known to the AI parser; it would need to be manually added to the static copy too. This is the one genuine, live drift risk in an otherwise well-solved domain.

**Consequences, per the mission's own asked dimensions**:
- **PR tracking**: solid for the canonical path (UUID-based, spelling-invariant); the legacy fallback is whitespace/case-invariant only, not alias-aware — two members' historical PRs for "BS" and "Back Squat" would NOT be automatically merged unless "BS" resolves to a real alias in the catalog (confirmed this exists as a real resolved alias in the codebase's own test history — "BS"→Back Squat was used as a real headline test case in the Canonical Movement Identity Phase 3 close-out).
- **Exercise history / Movement History grouping**: same split — canonical-linked history groups correctly across spelling variants; legacy-only history groups only across whitespace/case variants, never bridges the two identity systems (a deliberate, disclosed design choice across all 4 phases of the initiative — "NEVER bridging canonical/legacy," to avoid silently merging two different provenance chains).
- **Analytics / leaderboard**: not separately re-audited this session; inherits whichever identity system (canonical vs. legacy-text) the underlying Result used.
- **Future AI features**: the drifted static catalog is the one concrete blocker worth fixing before any *further* AI-parsing investment — it means AI-authored movements are grounded on a smaller, staler vocabulary than what a gym's coaches actually see and use in the manual editor.

**Overall**: this is, by a clear margin, the most rigorously-engineered domain-identity system found anywhere in this audit — closed via 4 deliberate phases, with disclosed trade-offs at every step rather than silent gaps. The one open item (AI catalog drift) was already surfaced independently in the prior Analyze Phase 0 mission and is not new here.

---

# PHASE 32 — AI FAILURE & CONFIDENCE AUDIT

This phase was already the subject of a full, dedicated audit completed immediately prior to this one (`FORGE_ANALYZE_SCALING_PHASE0_*.md`, this repo's root) — summarized here rather than re-derived, with anything genuinely new to this pass called out explicitly.

**Does Forge report uncertainty, request confirmation, silently guess, default values, or drop information?**

- **Silent guessing is explicitly, structurally discouraged at the prompt level**: `analyze-workout`'s system prompt has a real, specific "do not invent" instruction (*"Nu inventa informatii care nu reies din text... alege null/valoarea mai conservatoare, NU o presupunere plauzibila"*) and multiple concrete, correct disambiguation rules (percentages never become absolute weights; box-jump heights go to `notes`, not a weight field; hold durations go to `notes`, not `reps`).
- **But this is advisory-only, not code-enforced.** `validateWorkoutAnalysis()` (the one downstream validator) checks shape/enum-membership only — it has no plausibility check on returned *values* (confirmed: it cannot catch a fluent-but-wrong invented number, only a malformed one). This is a real, confirmed gap between "the model is told not to guess" and "the system can detect if it guessed anyway."
- **Every known malformed/uncertain-response mode IS handled deterministically, not silently**: truncated response (`status:"incomplete"`), model refusal, missing `output_text`, invalid JSON, and post-parse validation failure each map to a distinct, real HTTP error surfaced to the coach (502/422) — confirmed directly in `index.ts`. **Malformed AI output cannot reach the database** — there is no code path from a validation failure to a Supabase write; the coach sees an error and must retry or fall back to Manual/Template. This is a genuinely correct architecture for the specific question "can garbage enter the DB automatically" — the answer is no.
- **Ambiguous format collisions** (RFT vs. For-Time-Repeated-Rounds, confirmed to have no prompt tie-breaking rule, unlike the analogous Ladder-vs-For-Time rule that does exist) are a real, live prompt gap — the model will pick one silently, with no signal to the coach that the choice was ambiguous.
- **The clearest concrete example of "silently drops information": scaling.** Confirmed (Phase 0 audit): the model is explicitly told to populate `scalingVersions` *only* from text the coach already wrote — if the coach pastes only an RX workout, Intermediate/Beginner/OnRamp come back empty, silently, with zero signal in the UI that "Analyze" itself never attempted to generate them (that's a separate, later, coach-triggered deterministic-engine step). This is defensible behavior (not hallucinating tiers that weren't asked for) but is currently **undercommunicated** — a coach's own mental model of what "Analyze" does could easily be wrong.

**LLM response → schema validation → domain validation → database**: Structured Outputs strict mode guarantees shape at the OpenAI layer itself (the model literally cannot return a field of the wrong type). `validateWorkoutAnalysis()` is the one additional app-level check, deliberately described in its own comment as "a safety net... not primary validation." **No domain-level validation layer exists beyond this** — e.g., nothing checks that an `RFT` section's `formatConfig.rounds` is actually populated, or that a `loggingMode:'required'` section has a non-null `format`; these gaps are absorbed by defensive fallbacks in the client-side mapper (`sectionFromAiAnalysis`), not by a dedicated domain-validation step. **Recommendation** (not implemented, per this phase's own instruction): a lightweight, deterministic domain-validation pass between `transform.ts` and the client mapper — checking exactly the "required config field present for this format" class of rule already codified once in `MOVEMENT_PERFORMANCE_REQUIRED_FIELDS` (`wodSections.js`, used for the *manual* editor's save gate) — would close this gap using an existing, already-proven pattern rather than a new one.

---

# PHASE 33 — DATE, TIME & TIMEZONE AUDIT

Full report (with file/line citations): `PHASE_33_34_35_AUDIT.md` (this repo's root). Key findings:

1. **No canonical gym timezone exists anywhere** — no `gyms.timezone` column, no server-side notion of "the gym's local day." Every "today" resolves from the calling browser's local clock. HIGH CONFIDENCE.
2. **WOD-SIMPLE has a documented, correctly-and-consistently-applied fix** (`todayLocalStr()`, `utils.js`) for the classic `new Date().toISOString().split('T')[0]` UTC-vs-local-midnight bug, with an explicit warning comment.
3. **forge-admin-web independently reintroduced the exact anti-pattern the WOD-SIMPLE comment warns against**, in its Dashboard "today's WOD"/"expiring today" summary, its Subscriptions list active/expired/scheduled filters, and waiver "current" lookup. For a Romania-timed gym, this creates a real, reproducible ~2-3 hour nightly window (just after local midnight until UTC midnight) where these specific admin-facing views show yesterday's data — and can **disagree with forge-admin-web's own correct per-row status derivation** (`subscriptionStatus.ts`, which does compare local-aware `Date` objects correctly) during that exact window. MEDIUM CONFIDENCE on real-world impact (reasoned from code, not runtime-observed), HIGH CONFIDENCE on the code pattern itself.
4. **Booking-eligibility enforcement itself (the P0 membership-coverage fix) is correctly timezone-immune** — it compares two plain `date` columns, no time component, no midnight ambiguity.
5. Server cron jobs (gym-billing-block-daily, `check-subscriptions`) run in DB/Deno server time (presumed UTC, unverified) — theoretical exposure only, no confirmed live bug.

# PHASE 34 — CONCURRENCY & DUPLICATE ACTION AUDIT

Full report: `PHASE_33_34_35_AUDIT.md` (this repo's root). Key findings:

1. **Class capacity**: genuinely well-engineered, `FOR UPDATE`-locked DB trigger — not a client-side race. HIGH CONFIDENCE.
2. **Double-booking the same class by the same member**: no unique constraint exists on `bookings(class_id, member_id)` (contrast: `class_waitlist` and `class_reminders` both have their own equivalent uniqueness). MEDIUM-HIGH CONFIDENCE this is exploitable via double-tap/retry.
3. **Log Workout double-submit**: deliberately always-INSERT by design (confirmed via code comment), protected only by a frontend disabled-button state — no DB uniqueness on `wod_logs`, unlike `skill_logs`, which does have `unique(member_id, wod_id, slot)`. A real, asymmetric gap between two structurally similar tables.
4. **Stripe/platform-billing webhook idempotency**: genuinely the strongest-engineered concurrency handling found anywhere in the platform — real `unique(provider, provider_reference)` constraints, explicit "already processed, return 200" handling, and a documented, *fixed* real race (nested-transaction savepoint pattern preventing "money taken, nothing recorded" when two Platform Orders for the same gym activate simultaneously).
5. **Gym-membership activation** (`activate_queued_subscription`) has **not** received the equivalent hardening the platform-billing tier got for the identical race class — no unique/partial index equivalent to `platform_subscriptions_one_active_idx`, and no row lock ahead of its two-step deactivate-then-activate update. MEDIUM CONFIDENCE on exploitability (inferred from the code pattern + the platform tier's own documented history of hitting exactly this race, not runtime-tested at the gym tier).
6. **AI analysis has no dedup** — by design, low severity (cost/UX only).

# PHASE 35 — DESTRUCTIVE ACTIONS & RECOVERY

Full report: `PHASE_33_34_35_AUDIT.md` (this repo's root), plus this session's own direct resolution of one open question. Key findings:

1. **Movements catalog "no-hard-delete" is a documented convention, not an enforced invariant** — RLS still permits a coach/admin to hard-DELETE a movement row, no `is_active` column exists. Currently zero-risk in practice (no UI anywhere calls this), but not actually blocked by the schema.
2. **If a movement WERE deleted**: only one real FK exists (`pr_events.movement_id ON DELETE SET NULL`, safe). `wod_logs`/`skill_logs.sets_movement_ids` are unconstrained `jsonb` with **no FK at all** — a delete would silently orphan these references with no cascade, no error.
3. **Deleting a `wods` row**: hard delete, **no confirmation dialog**, but well-contained — `wod_logs.wod_id ON DELETE SET NULL`, and logs snapshot the workout's name/format/movements at write time, so historical scores keep displaying correctly even after the source workout is gone. Unguarded action, non-destructive effect — a real but low-severity gap.
4. **Deleting a single class**: hard delete, **no confirmation** (contrast: deleting an entire recurring series *does* have a `window.confirm` guard — the single-class path is the one left unguarded).
5. **"Delete past classes" bulk action — the most severe finding in this phase.** `stergeClaseleTrecute()` (`App.jsx:3254-3259`) permanently deletes every class dated before today, **gym-wide, in one click, with zero confirmation and zero undo**. This session directly resolved the agent's one open question here: **`bookings.class_id` has NO foreign key to `classes` at all** (confirmed live: only `gym_id` and `member_id` FKs exist on `bookings`) — meaning this bulk delete has **no DB-level referential-integrity protection whatsoever**; every booking tied to a deleted past class becomes a silently orphaned row. This matches an already-known, previously-unresolved bug in project history ("Bug clase trecute disparute"). **HIGH CONFIDENCE, P1.**
6. **Deleting a member's own journal log**: hard delete, but with a real two-tap frontend confirmation — the best-protected of the WOD-SIMPLE admin/member delete flows.
7. **`subscription_plans` delete (forge-admin-web)**: the single best-engineered destructive-action pattern found in the whole audit — an app-level usage-count pre-check driving a differentiated confirmation dialog, *unconditionally backstopped* by a real DB FK constraint even if the pre-check is wrong or bypassed. Worth using as the template for every gap above.
8. **Remove Member / Cancel Membership**: both correctly soft (identity-detach and `is_active=false` respectively) — no data loss, matches this project's own closed "Remove Member" initiative.
9. forge-admin-web itself exposes almost no destructive-delete UI (one `.delete()` call in the whole app) — all the risk above concentrates in WOD-SIMPLE's older admin surfaces.

# PHASE 36 — OBSERVABILITY & PRODUCTION DEBUGGING

Full report: `PHASE_36_37_38_AUDIT.md` (this repo's root). Key findings:

1. **WOD-SIMPLE (member PWA)**: Sentry is genuinely well-integrated — `captureConsoleIntegration` auto-forwards every `console.error` (and the codebase has already standardized on `console.error` as its "real problem" signal, 63 call sites in `App.jsx`, only 2 trivial silent catches in the whole file), plus a top-level error boundary with a user-facing fallback.
2. **forge-admin-web (coach/admin app) has ZERO error tracking of any kind** — confirmed, no Sentry, no SDK, nothing. Its one React error boundary only does `console.error`. **This is the single most consequential Phase 36 finding**: the tool gym staff/admins depend on for billing, member management, and programming has strictly less production visibility than the member-facing app.
3. **No edge function (any of the 20) has any monitoring SDK** — logs are plain-string `console.*` only, 98 call sites, no structured/JSON logging anywhere.
4. **Concrete, directly-verified gap**: `analyze-workout`'s 9 error-log call sites never include `caller.id`/`gymId`, even though both are in scope at the point of every error — "which user, which gym" cannot be answered from these logs today without external correlation. Confirmed as the general pattern across the three representative functions checked.
5. Minor: 4 edge functions redefine an identical local helper already available as a shared import — pure avoidable duplication, not a functional bug.

# PHASE 37 — ACCESSIBILITY & BASIC UX SAFETY

Full report: `PHASE_36_37_38_AUDIT.md` (this repo's root). Key findings, kept to the "lightweight, functional" scope this phase asked for:

1. **WOD-SIMPLE has a systemic keyboard-accessibility gap**: 66 clickable `<div onClick>` elements (tabs, list-item selection, expand/collapse rows) vs. only 8 total keyboard-affordance attributes in the same file — essentially all custom tab bars and selectable rows are unreachable by keyboard. forge-admin-web has only 2 such instances — markedly better discipline, consistent with being the newer codebase.
2. **Form labeling**: dominant pattern is placeholder-only inputs (85 `<input>` elements, only 2 real `<label>`s) — functional for the overwhelming majority of real users (touch/mouse) but a real screen-reader gap.
3. **Modal focus management is a genuine, fixable inconsistency, not a wholesale absence**: WOD-SIMPLE's `BottomSheet` component does everything correctly (focus trap, Escape, focus-restore, ARIA), but ~13 other full-screen overlays in `App.jsx` predate/bypass it entirely, with zero dialog semantics. forge-admin-web, by contrast, has one shared `Dialog` component used consistently everywhere — architecturally ahead of the member PWA on this specific dimension.
4. **One concrete unprotected irreversible action**: class booking/cancellation (`toggleRezervare`) has no in-flight guard or loading state at all, unlike WOD score-save and feed-post, which both correctly guard against double-submission.

# PHASE 38 — DEPENDENCY & PLATFORM AUDIT

Full report: `PHASE_36_37_38_AUDIT.md` (this repo's root). Key findings:

1. Both repos run **current-generation** React 19 / Vite 8 / (forge-admin-web) TypeScript 6 — nothing dated, no upgrade urgency found.
2. No AI SDK dependency anywhere — confirmed (again) raw `fetch` to the OpenAI Responses API, no `openai` npm package.
3. **No duplicate libraries solving the same problem across the two repos** — both use native `Date`, plain `useState` forms, the same icon library, the same CSS framework major version. The router asymmetry (forge-admin-web has one, WOD-SIMPLE doesn't) is an explicitly documented, deliberate architectural choice, not drift.
4. **Real finding, edge-function layer**: `purchase-platform-plan` and `platform-billing-webhook` — two functions that touch money — pin `stripe@^17` via `deno.json` but have **no `deno.lock`**, so they float to whatever the latest matching `17.x` release is at each deploy, with no integrity pin. Only 5 of 20 edge functions have a `deno.lock` at all; pinning discipline is inconsistent, not policy-driven.
5. Minor cross-repo drift: `@testing-library/jest-dom` major-version skew (`^6.9.1` vs `^7.0.0`) — dev-tooling only, low practical impact.

# PHASE 39 — DATABASE ↔ TYPESCRIPT SCHEMA DRIFT

Full report: `C:\Users\Luci\Desktop\forge-admin-web\PHASE_39_SCHEMA_DRIFT_AUDIT.md`.

## SCHEMA DRIFT REPORT

| Table | TS Type File | Missing from TS | Stale in TS | Nullability Mismatch | Enum-as-string | Severity |
|---|---|---|---|---|---|---|
| `wods` | `programming/types.ts` (`WodRow`) | `duration` (legacy column, still populated) | none | none | `type` correctly bare string (no DB CHECK exists) | **P2** — latent; WOD-SIMPLE itself already had to add a fallback for this exact column after a live "empty header" bug (commit `a0007856`); nothing on forge-admin-web reads it yet, so no live bug, but the same defect will reproduce the moment an Admin-side timing display is built |
| `wod_logs` / `skill_logs` | `results/types.ts` | `movements_snapshot`, `performance_signature` (both added 20260813100200) | none | none | `completion_state` — real DB CHECK enum, typed as bare `string` | **P3** — fetched via `select('*')` but unread; enum gap is a compile-time-safety miss, not a live bug (existing comparisons are correct) |
| `movements` | `movements/types.ts` | none | none | none | correctly unconstrained (DB itself has no CHECK) | **None** — byte-for-byte match, newest table in scope |
| `workout_sections` | `programming/types.ts` + `results/types.ts` | intentionally-narrow projections, not claimed as full mirrors | none | `leaderboard_visible` correctly non-optional | `logging_mode` correctly modeled as a union | **None** in the fields actually exposed |
| `profiles` | `members/types.ts` (`MemberProfile`) | none | none | none | `weight_unit` — real DB CHECK enum (`'kg'`/`'lbs'`), typed as bare `string` | **P3** |
| `profiles` (2nd consumer) | `results/types.ts` (`MemberRef`) | — | — | `weight_unit` typed nullable here vs. correctly non-null in `MemberProfile` for the same column | — | **P3** — internally inconsistent, but the safe direction (extra defensive check on an actually-non-null field) |
| `subscriptions` | `subscriptions/types.ts` | none in spot-checked columns | none | none | correctly typed booleans | **None found** — this file's own header already documents *why* a field is deliberately excluded, a stronger practice than most files audited |
| `subscription_plans` | `subscriptions/types.ts` + `plans/types.ts` | none | none | none | none | **None** — one baseline column already proactively disclosed in a comment |
| `pr_events` | `results/types.ts` | none | none | none | `pr_type` correctly a union | **None** — best drift discipline in the whole audit; two recent migrations (08-24, 08-25) both landed same-day TS updates |
| `personal_records` | `results/types.ts` | **Could not fully verify** — table predates tracked migrations, only 1 of ~8 columns independently confirmed | — | — | — | **Confidence: Medium**, not a confirmed gap |

**Headline systemic finding**: forge-admin-web has **no Supabase-generated types at all** — `createClient()` is called with no `Database` generic, no generated-types file exists, no `gen types` script in `package.json`. Every row shape is hand-written. The types found are, despite this, unusually well-maintained (several tables show zero drift, with same-day updates on recent migrations) — but nothing mechanically guarantees this stays true, since TypeScript's compiler has nothing real to check hand-written interfaces against.

**What the agent could not verify**: 6 of the tables audited (`profiles`, `members`, `wods`, `subscriptions`, `subscription_plans`, `personal_records`) predate the tracked migration history entirely — their full baseline column sets cannot be reconstructed from migrations alone, only migration-touched deltas were independently confirmed. A baseline column that no migration ever altered and no application code currently reads would be invisible to this method by construction.

---

# PHASE 40 — SOURCE OF TRUTH MAP

## FORGE SOURCE OF TRUTH MAP

| Concept | Canonical Source | Consumers |
|---|---|---|
| Exercise/movement identity | `movements` table (UUID), linked via `sets_movement_ids` on Results | Canonical Movement Identity resolver, PR Engine (canonical branch), Movement History, Current Bests, AI parser (via a **separate, drifted static copy** — flagged risk) |
| Workout format registry | `WORKOUT_FORMATS` in `workoutFormats.js` | **3 independently-maintained copies**: canonical (WOD-SIMPLE), `analyze-workout`'s prompt/schema (static), forge-admin-web's `formatCatalog.ts` (static port). Confirmed in sync today, no automated check |
| Score type / scoring semantics | `sortSectionLogs()` in `workoutFormats.js` | Ported (not shared) to forge-admin-web's `ranking.ts`. Confirmed correct on every scenario re-checked this pass; cross-repo byte-parity not re-verified this session |
| Workout section identity (type) | `workout_section_types` catalog + `slot_key`, legacy 3-slot model | Admin editor (`wodSections.js`, just fixed), Member View (renders by `slot_key`, not by the richer catalog type — disclosed migration debt) |
| Scaling level (RX/Intermediate/Beginner/OnRamp) | `VARIANT_LEVELS`/`SCALING_KEYS` in `wodSections.js`, ported to forge-admin-web's `sectionEditing.ts` | Admin editor, Member View, `scalingEngine.ts`'s deterministic generator, `regenerate-variant`'s AI path |
| Member gender | `members`/`profiles.gender` (nullable free text, no CHECK) | **TWO diverging resolvers** — `weightKeyForVariant` (silent male-default) and `resolveAthleteGenderKey` (explicit null-on-unset). No single canonical resolution function exists today — this is the concept with the clearest competing-sources-of-truth problem found in this audit |
| Membership/booking-eligibility status | `subscriptions` table (`is_active`, `queued`, `[start_date,end_date]`) | `enforce_subscription_sessions()` DB trigger (canonical enforcement), both clients' UI read the same table directly |
| Booking eligibility (capacity) | `classes.max_spots` + a live `bookings` count | `enforce_class_capacity()` DB trigger — genuinely canonical, single enforcement point, both clients funnel through the same `bookings` insert |
| Workout date / "today" | **No canonical source** — browser-local clock, no `gyms.timezone` | WOD-SIMPLE (correctly local-date-aware), forge-admin-web (several call sites incorrectly UTC-based) — a real, confirmed disagreement between clients during a nightly window |
| User role (admin/coach/member) | `admins`/`coaches` tables + RLS policies keyed on `auth.uid()` | Both clients' UI gating, every SECURITY DEFINER edge function's own authorization check (each re-implements the admin/coach lookup independently — not itself flagged as a defect, but worth noting as another duplicated-but-consistent pattern) |
| Leaderboard eligibility | `effectiveLeaderboardVisible()` resolver in `workoutEngine.js` | Single canonical resolver, structurally prevents the impossible "scored=false, leaderboard=true" state |
| PR eligibility | `evaluate_movement_prs()` DB trigger, SECURITY DEFINER | Sole writer to `pr_events` — canonical, but narrowly scoped (Build to Heavy/1RM only, by deliberate prior design decision) |

**Concepts with a confirmed, live "multiple competing sources of truth" problem**: member gender resolution (two functions, opposite null philosophy) and "today's date" (no canonical timezone, two clients disagree during a real nightly window). Every other concept in this map has exactly one canonical source, even where it's duplicated/ported across repos without a shared-import mechanism.

---

# PHASE 41 — USER JOURNEY FAILURE TESTING

Conceptual analysis grounded in the concurrency/destructive-action findings above (Phases 34-35), not independently runtime-tested this session (no production/login access, per standing rule).

| Failure scenario | Current behavior (evidence-based) | Risk |
|---|---|---|
| Member double-clicks "Book" (network succeeds, UI feedback is slow) | **No in-flight guard on the booking handler.** Two inserts could both attempt to fire; the DB has capacity protection (row-locked, correct) but no per-member-uniqueness protection — a genuine double-booking (and, per the code's own session-adjustment logic, potentially a double session-credit deduction) is plausible, not merely theoretical. | Real gap, P2 |
| Member double-clicks "Log Workout" | Deliberately always-INSERT, no dedup at the DB level, only a disabled-button guard. A fast double-tap before the button visually disables could create two score rows for the same result, double-counting on the leaderboard and potentially double-firing PR detection. | Real gap, P1-adjacent (affects leaderboard/PR integrity, not just UX) |
| Repeated Stripe webhook delivery | Correctly idempotent — genuinely the best-engineered failure path in the platform. | Solved |
| Page refresh mid-checkout | Not independently re-traced this session; Stripe's own webhook-driven activation model (rather than a client-side "assume success" pattern) structurally tolerates a refresh, since the actual state change happens server-side on webhook receipt, not on client navigation — MEDIUM CONFIDENCE, inferred from the webhook architecture rather than directly tested. |
| Two members racing for the last class spot | Correctly serialized by the row-locked DB trigger — the second request cleanly fails with a real error, not a silent overfill. | Solved |
| AI analysis timeout | Explicit, distinct error surfaced to the coach (502, "AI service could not be contacted"); one automatic retry for transient (429/5xx) errors only. No silent hang. | Solved |
| Admin bulk-deletes past classes, then realizes bookings/history are needed | **No undo, no confirmation, orphaned `bookings` rows with zero FK protection** (confirmed this session). This is the single most severe failure-mode finding in this entire audit — a one-click, unconfirmed, irreversible, gym-wide action with a confirmed silent data-orphaning side effect. | **P1, confirmed, not new to this session but re-confirmed with stronger evidence (the missing FK)** |
| Coach's browser session expires mid-edit in the workout editor | Not independently traced this session — would require tracing Supabase Auth token-refresh behavior against a long-lived form session; UNVERIFIED. |

---

# PHASE 42 — MVP DEFINITION

Based on the actual, verified state of the application (not a generic gym-SaaS feature checklist).

### REQUIRED FOR FORGE V1 (smallest reliable product for real gym use, right now)
- Fix the two confirmed P1 data-integrity/destructive-action gaps: `stergeClaseleTrecute()` needs at minimum a confirmation dialog (the one-line fix already used elsewhere in the same file for series-delete), and `wod_logs` needs the same duplicate-submission protection `skill_logs` already has.
- The gender-resolution duplication (Phase 28) should converge on one resolver — low-effort (one function, already has a correct model to copy from `rxEngine.js`), high-consequence if left (affects displayed loads/leaderboard comparison for ~11% of members with unset gender).
- forge-admin-web's timezone bug (Phase 33) should be fixed — it actively misleads gym staff, not just members, during a real nightly window, and a working reference fix already exists in the sister repo.
- The confirmed Critical RLS gap on `subscriptions` (`subscriptions_select_own_or_admin`'s `class_waitlist`-existence clause — verified live again this session, matches prior project-memory finding exactly) is a real financial/billing data exposure between members of the same gym and belongs in this tier, not deferred — though per this project's own standing rule it requires explicit user sign-off before implementation, not a unilateral fix.

### POST-V1 (valuable, not blocking initial real-gym use)
- forge-admin-web error tracking (Sentry) — real gap, but the app still functions; staff can currently only self-report bugs, which is a real cost but not a blocker to using the product.
- Accessibility hardening (keyboard navigation on the ~66 clickable divs, modal focus-trap adoption for the ~13 non-`BottomSheet` overlays) — matters for real inclusivity, not a blocker for the overwhelming majority of real gym members using touch/mouse today.
- Double-booking (same member, same class) DB-level uniqueness — real gap, lower severity than the capacity-race it sits next to (which is already solved).
- Schema-drift cleanup (missing TS fields, enum-as-string) — genuine but currently zero live-bug impact; worth doing opportunistically, not urgently.

### FUTURE SAAS (only needed when Forge is sold to gyms beyond the current one)
- A real `gyms.timezone` column and gym-local "today" resolution everywhere — the current single-gym-in-Romania deployment makes the browser-local-clock assumption mostly harmless in practice; this becomes a real requirement only once a second gym in a materially different timezone exists.
- Edge-function dependency pinning discipline (the `deno.lock`-missing Stripe functions) — worth fixing regardless, but its consequence (an unpredictable minor/patch Stripe SDK version at deploy time) is a bigger risk at higher transaction volume/multiple paying gyms than at today's scale.
- Generated Supabase types for forge-admin-web — valuable engineering hygiene at any scale, but the current hand-written discipline has, per direct evidence, actually held up well; this is a "do it before the team scales past the people who currently hold this context," not a V1 blocker.

**Explicit non-goal, per this phase's own instruction**: none of the above should be read as "Forge needs every feature of an established gym-management platform." The MVP bar used here is "the workflows that already exist are reliable and don't silently corrupt or expose data" — not feature parity with Wodify/PushPress/SugarWOD.

---

# PHASE 43 — COMPLETION ESTIMATE

### FUNCTIONAL COMPLETION: **~80-90%**

The large majority of intended V1 functionality genuinely exists and, per this audit's own direct verification, works correctly: class scheduling/booking/capacity/cancellation, membership/session management, the full workout-programming domain model (22 formats, multi-section, 4-tier scaling), scoring/leaderboard/PR tracking, movement identity, AI-assisted authoring with a real manual fallback, Stripe billing (both gym-membership and platform-subscription tiers), and RLS-based multi-tenancy. The range (not a single point estimate) reflects two real, evidence-based uncertainties: forge-admin-web's admin-facing feature surface is narrower than WOD-SIMPLE's own admin tools in places (Phase 35's finding that forge-admin-web has almost no destructive-delete UI at all, for better or worse), and this audit did not attempt to independently verify every one of the 22 workout formats' end-to-end logging/scoring UI (only the domain model and scoring comparator were stress-tested, not click-tested).

### PRODUCTION READINESS: **~65-75%**

This is meaningfully lower than functional completion, and the gap is explained by concrete, now-enumerated findings, not a vague "needs polish" impression: a confirmed Critical RLS financial-data-exposure gap still open; a confirmed P1 irreversible bulk-delete with zero confirmation and zero DB-level cascade protection; a confirmed asymmetry where the coach/admin app (the one staff depend on daily for billing and member management) has zero production error visibility; a confirmed cross-client timezone bug that actively produces wrong data in the admin dashboard during a real, recurring window; and a confirmed architectural duplication (gender resolution) that can already, today, produce two different displayed answers for the same member depending on which code path renders them. None of these are "not built yet" — they are "built, but the reliability/security discipline that the platform's own best-engineered subsystems demonstrate (class capacity, Stripe idempotency, PR canonical identity, `subscription_plans` delete-protection) has not yet been applied evenly everywhere."

**Largest factors, ranked by how much they move each number:**
- Functional completion is held back mainly by admin-app feature-surface asymmetry and formats/flows not independently click-tested this pass, not by missing domain modeling.
- Production readiness is held back by a small, concrete, already-enumerated list of gaps (roughly 5-6 real findings), each individually narrow-scoped and fixable — this is a tractable punch list, not a systemic rewrite.

Both numbers are deliberately given as ranges, not single points, per this phase's own explicit instruction not to manufacture false precision — several of the underlying findings (e.g. real-world exploitability of the concurrency gaps, the true blast radius of the RLS gap) are MEDIUM CONFIDENCE, reasoned from code rather than confirmed via production incident data.

---

# PHASE 44 — FINAL AUDIT CONFIDENCE

## Confidence by major conclusion

**HIGH CONFIDENCE (directly verified in code/schema/live read-only SQL this session):**
- Class capacity + booking-membership-date-coverage enforcement are both genuine, correct, DB-level, concurrency-safe.
- `bookings(member_id, class_id)` has a real unique constraint; `bookings.class_id` has NO foreign key to `classes` at all.
- The `subscriptions` table's RLS SELECT policy contains the exact caller-identity-independent bypass clause described in prior project memory — re-confirmed live this session, not stale.
- The gender-resolution duplication (`weightKeyForVariant` vs. `resolveAthleteGenderKey`) — both functions read directly, behavior confirmed as described.
- PR eligibility is gated exclusively on `format_snapshot = 'Build to Heavy/1RM'` — confirmed via the live trigger source.
- All Phase 33-39 findings sourced from the three background research passes carry their own per-claim confidence ratings in their full reports (cited above), independently spot-checked where this session had direct DB access (`bookings.class_id`'s missing FK).
- The workout domain model's format catalog (22 formats), multi-section architecture, and canonical movement-identity system — all re-confirmed from this session's own extensive prior direct work on these exact systems.

**MEDIUM CONFIDENCE (strongly indicated, would benefit from runtime verification):**
- Real-world exploitability of every concurrency-race finding (double-booking, duplicate log, membership double-activation) — the *absence* of a DB-level guard is HIGH CONFIDENCE; whether it has ever actually been hit in production is not.
- Cross-repo comparator/format-registry parity (scoring, format catalog) — confirmed in-sync today via direct reading, not mechanically guaranteed to stay so.
- forge-admin-web's timezone bug's actual user-facing frequency/severity — reasoned from code, not observed in production logs.

**LOW CONFIDENCE / UNVERIFIED (explicitly, nothing here is presented as verified):**
- Anything requiring the Supabase dashboard (DB session timezone GUC, actual cron schedules for `check-subscriptions`/`send-class-reminders`, log retention/alerting configuration).
- Anything requiring the Sentry dashboard (whether `VITE_SENTRY_DSN` is actually set in the live production build, whether alerting is configured).
- Anything requiring the Stripe dashboard (webhook delivery history, actual dispute/chargeback handling in practice).
- Any claim about actual user-experienced incidents, support tickets, or production error rates.
- Screen-reader/assistive-technology real-world behavior (static analysis only).
- The full baseline column set of 6 pre-migration-history tables (`profiles`, `members`, `wods`, `subscriptions`, `subscription_plans`, `personal_records`) — only migration-touched deltas were independently confirmed; a never-altered, never-read baseline column would be invisible to this audit's method by construction.

## WHAT I COULD NOT VERIFY

- Production environment access: no ability to observe actual runtime behavior, error rates, or user-experienced incidents for any finding in this report.
- Stripe dashboard access: webhook delivery history, dispute handling, actual resolved dependency versions at runtime.
- Supabase dashboard access: DB timezone configuration, cron/pg_cron schedules, log retention and alerting configuration, actual `information_schema` for the 6 pre-migration-history tables beyond what live read-only SQL in this session already confirmed.
- Sentry dashboard access: whether the production DSN is actually configured, whether alerting rules exist.
- Real user data / production incident history: whether any of the confirmed-possible races (double-booking, duplicate log, double-activation) have ever actually occurred.
- Runtime/manual testing of any user journey, accessibility behavior with real assistive technology, or color contrast.
- Independent click-testing of all 22 workout formats' end-to-end logging UI (this audit stress-tested the domain model and scoring comparator directly, not every format's rendered UI).

This audit was conducted entirely via static code/migration reading and live, read-only, structure-only SQL against production (never touching member data, never logging in as any user, per this project's own standing constraint) — every finding above is traceable to a specific file, line, or direct query result, not inference dressed as fact.
