# Canonical Movement Identity — Competitive Research

**Status: Research-only, feeds `CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md`. No implementation.**

## Method

Every claim below is tagged **VERIFIED** (public help-center/docs pages found and cited) or **INFERENCE** (general industry knowledge / reasonable deduction, not confirmed against a live source this session). No proprietary schema was invented or copied — this document extracts *patterns*, not implementations.

## SugarWOD — VERIFIED

- SugarWOD ships a fixed, curated **"Tagged Movements"** library. Coaches tag a workout's movements from this list so members can see movement-level history/PRs across repeated WODs.
- **Coaches/gyms cannot add their own custom movement to the tagged-movements library.** The only "custom" authoring surface is custom *benchmarks* (whole workouts), not individual movements.
- Implication: SugarWOD chose **curated-global-only, no gym-scoped custom movements, no coach-facing alias editing**. Simplicity over flexibility — a closed vocabulary a member can always trust, at the cost of coaches being unable to represent gym-specific/novel movements with the same first-class tracking.

Sources: [Tagged Movements in Workouts – SugarWOD Knowledge Base](https://help.sugarwod.com/hc/en-us/articles/115005408447-Tagged-Movements-in-Workouts), [SugarWOD 101](https://www.sugarwod.com/gym-programming-videos-2/)

## Wodify — VERIFIED

- Base tier: movements/exercises come from Wodify's own built-in library.
- **Wodify Perform** (paid add-on): unlocks **"Custom Components"** — gym-specific movements/workouts that get their own scoring and progress tracking, explicitly scoped to that one business (gym-scoped, not shared across Wodify's whole customer base).
- Separately, an **individual athlete** using the app can "Create new workout/exercise" if one isn't found — but that athlete-created entry is private to their own profile only, never promoted to the gym or platform level.
- Implication: Wodify runs a **three-tier scope model** — platform library (global), gym custom components (gym-scoped, coach-authored, paid feature), and member-private ad hoc entries (never merge upward). This is the closest verified precedent to a "global + gym-scoped hybrid," and it additionally shows a *third*, even-narrower scope (individual-private) that neither Forge's current `movements` table nor this mission's own proposed model considers — worth noting as a considered-and-rejected option (see Architecture doc §"Global vs Gym-Scoped").

Sources: [Creating Custom Components – Wodify](https://help.wodify.com/hc/en-us/articles/1500001591502-Creating-Custom-Components), [Track Custom Workouts – Wodify](https://help.wodify.com/hc/en-us/articles/208737758-Track-Custom-Workouts)

## Hevy (general strength-tracking app, not CrossFit-specific) — VERIFIED

- Global library of 400+ exercises, filterable by equipment/muscle group, with search.
- Users can create custom exercises (free tier capped at 7, unlimited on paid) via an explicit **"Create"** flow requiring name + exercise type + equipment + muscle groups — never inferred from free text.
- **Duplication-as-creation**: a user can select any existing library exercise and "duplicate" it into a custom variant (pre-fills the same category, so a "Back Squat (Beltless)" custom variant still carries "Squat"/"Legs" taxonomy without the user re-entering it). This is a deliberate anti-fragmentation UX pattern: starting from an existing entry rather than a blank text field.
- **Exercise "type" is immutable after creation** — to change it, the user must delete and recreate. Everything else (name, equipment, muscles) stays editable.
- Implication: even a single-tenant consumer app treats one dimension (exercise "type", roughly equivalent to Forge's `movement_pattern`) as **identity-defining and frozen**, while treating name/equipment/muscle-tags as **mutable metadata**, not identity. This maps cleanly onto this mission's own MI-3/MI-4 distinction (rep scheme and PR-eligibility are not movement identity) — Hevy independently arrived at "one structural dimension is identity, the rest is editable metadata."

Sources: [Hevy Exercise Library](https://help.hevyapp.com/hc/en-us/articles/35688251991575-Hevy-Exercise-Library-400-Exercises-and-Custom-Exercises), [How to Create Custom Exercises in Hevy](https://help.hevyapp.com/hc/en-us/articles/35700328894103-How-to-Create-Custom-Exercises-in-Hevy), [Custom Exercises – Hevy](https://www.hevyapp.com/features/custom-exercises/)

## btwb, TrainHeroic, TeamBuildr, Strong, StrengthLog, Garmin/TrainingPeaks, CrossFit CAP/Games ecosystem — INFERENCE only

No live source was fetched for these this session; the general shape below is **industry-common knowledge, not confirmed against current docs**, and should be treated as directional only:
- **btwb**: known publicly (from its own marketing/UX, widely mirrored across CrossFit gym blogs) to track PRs against a benchmark-and-movement library with per-gym leaderboard scoping, similar in spirit to SugarWOD's curated-list model — not independently re-verified here.
- **TrainHeroic / TeamBuildr**: general-purpose strength & conditioning platforms aimed at coaches programming many athletes; publicly known to support large, coach-editable exercise libraries with video demos, closer to Wodify's "gym-scoped custom" tier than SugarWOD's closed list — not independently re-verified here.
- **Strong / StrengthLog**: single-user strength trackers, same general shape as Hevy (global library + user custom exercises) — not independently re-verified here.
- **Garmin / TrainingPeaks**: primarily endurance/monostructural (run/bike/swim), where "movement identity" is closer to *activity type* than a discrete strength-movement catalog — not a close analog for Forge's barbell/gymnastics-heavy problem.
- **Official CrossFit / Olympic weightlifting terminology**: CrossFit's own published movement/glossary terminology (Back Squat, Front Squat, Snatch family, etc.) and IWF's official lift terminology are the de facto shared vocabulary the entire industry already converges on informally — this is *why* Forge's own static `CANONICAL_MOVEMENTS` list and the seeded `movements` catalog already look like every competitor's list: there is one real public taxonomy everyone is drawing from, not several competing ones.

## Domain taxonomy question (mission §5-6)

**Should Forge adopt an external taxonomy, build its own, hybrid, or avoid one entirely?**

Forge has already answered this empirically, before this mission began: the `movements` catalog (465 rows, seeded 2026-08-20) is a **hybrid** — Forge's own pre-existing ~250-300-name static list, enriched with `category`/`equipment`/`movement_pattern`/`aliases` data merged in from **open-wod-db** (CC BY 4.0, a genuinely public, permissively-licensed CrossFit/functional-fitness movement dataset), with two commercial/restrictively-licensed sources (WODCAT, GetEvox) explicitly evaluated and excluded on licensing grounds (see `MOVEMENT_CATALOG_CONSOLIDATION_REPORT.md`). This research independently arrives at the same conclusion the platform already committed to: **hybrid, own-list-plus-permissively-licensed-enrichment**, not a from-scratch taxonomy and not a single external taxonomy adopted wholesale. No reason found in this research to revisit that decision.

## What this research does NOT support

- No competitor evidence found for **automatic fuzzy-match identity assignment** on logged Results — every verified source either uses a closed picklist (SugarWOD) or an explicit create/duplicate flow (Hevy, Wodify custom components). This corroborates the mission's own MI-6 invariant (no fuzzy automatic identity) rather than contradicting it.
- No competitor evidence found for **movement families as a first-class, member-visible hierarchy** (e.g. grouping all Snatch variants under one "Snatch family" UI concept) — SugarWOD/Wodify/Hevy all track movements as a flat, searchable list. This weakly supports deferring movement families (mission §8/§49) rather than building them now.
