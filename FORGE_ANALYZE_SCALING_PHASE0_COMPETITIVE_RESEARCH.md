# Forge Analyze + Scaling — Phase 0 Competitive Research

Research only, conducted via web search against primary sources (vendor documentation, CrossFit HQ materials, help centers) where available. No Forge code referenced or judged in this document — pure external methodology/market survey, per the mission's explicit separation of research from audit.

# Research Method

Web search + primary-source fetches conducted August 2026, covering official CrossFit HQ pages/journal, vendor help centers, vendor blogs, and vendor marketing pages for each named platform. Where only third-party listicles/aggregators (review-comparison sites, SEO blogs) turned up a claim and no primary source could confirm it, that is flagged explicitly as unverified rather than reported as fact. No product accounts were created and no software was used hands-on — all findings are from publicly available documentation, help articles, and marketing/blog copy. This is a documentation-level survey, not a hands-on UX audit of each tool.

# Primary Sources

- CrossFit.com, "Scaling in CrossFit Is a Strategy, Not a Shortcut" — https://www.crossfit.com/essentials/scaling-in-crossfit-is-a-strategy-not-a-shortcut
- CrossFit.com, "Professional Training: Scaling, Part 2" — https://www.crossfit.com/essentials/professional-training-scaling-part-2
- CrossFit.com, "Hitting the Stimulus in Each CrossFit WOD" — https://www.crossfit.com/essentials/crossfit-hitting-the-stimulus
- CrossFit.com, "CrossFit Affiliate Programming (CAP)" — https://www.crossfit.com/affiliate-toolkit/crossfit-affiliate-programming
- CrossFit.com, "Scaling In-Between the Lines: Considerations for Scaling Intermediate-Level Athletes" — https://www.crossfit.com/pro-coach/crossfit-scaling-intermediate-athletes
- CrossFit Journal, "Scaling CrossFit Workouts" by Jeremy Gordon, CF-L4 (2015) — http://journal.crossfit.com/2015/10/scaling-crossfit-workouts.tpl
- CrossFit Journal, "Scaling: How Less Can Be More" by Clea Weiss (2009) — http://journal.crossfit.com/2009/06/scaling-how-less-can-be-more.tpl
- CrossFit.com, "Substitutions" FAQ — https://www.crossfit.com/faq/substitutions
- btwb blog (blog.btwb.com) — AI Planning / AI Logging feature pages
- SugarWOD, "Programming with AI: How to coach smarter with SugarWOD" (2026) — https://www.sugarwod.com/2026/05/smarter-programming-with-ai-how-to-personalize-workouts-at-scale/
- SugarWOD, "The Workout Process" — https://www.sugarwod.com/the-workout-process/
- Wodify Help Center, "Build and Edit Workouts" and "What's New" release notes — help.wodify.com
- PushPress Help Center, "Programming Workouts Using the Train Workout Builder" — https://help.pushpress.com/en/articles/5622292-programming-workouts-using-the-train-workout-builder
- PushPress Help Center, "Become a Pro at Programming with Train by PushPress" — https://help.pushpress.com/en/articles/8365502-become-a-pro-at-programming-with-train-by-pushpress
- TrainHeroic, "Create V2" product page — https://www.trainheroic.com/create-v2/
- TeamBuildr, "BUILD" product page — https://www.teambuildr.com/build
- Mayhem Athlete affiliate program pages (via btwb/Wodify marketplace listings) — https://programs.btwb.com/mayhem/affiliate
- HWPO Training programs page — https://www.hwpotraining.com/programs
- PRVN Fitness programming page — https://prvnfitness.com/pages/programming
- Invictus Fitness, "Introducing Invictus Affiliate Programming" — https://invictusfitness.com/blog/invictus-affiliate-programming

Where a claim rests only on a secondary/aggregator source (comparison blog, SEO listicle) rather than the vendor itself, this is called out inline as "unverified — secondary source only."

# CrossFit Scaling Methodology

**GENERAL COACHING METHODOLOGY (CrossFit HQ's own documented position, not third-party interpretation):**

CrossFit HQ's official materials consistently frame scaling around a single organizing concept: **intended stimulus**. Per crossfit.com/essentials/scaling-in-crossfit-is-a-strategy-not-a-shortcut, the purpose of any scale is to move the athlete "one step closer to the intended stimulus" — explicitly **not** to make a workout more comfortable, but to make it more useful for the athlete's current capacity. The site states substitutions and load/volume reductions should preserve the *effect* of the workout (metabolic pathway, time domain, relative loading) rather than just make it completable.

Key documented principles:
- **Order of operations**: reduce load, then reduce volume, then substitute movement — movement substitution is explicitly described as a last resort, not a first move (crossfit.com/essentials, CrossFit Journal "Scaling CrossFit Workouts," Jeremy Gordon 2015).
- **Preserve time domain / metabolic pathway**: over-reducing reps or over-simplifying movements risks shifting a workout out of its intended energy-system category (same Gordon 2015 article).
- **Directionality**: scaling choices should trend toward Rx over time ("every scale should have a direction") — CrossFit frames scaling as a progression tool, not a fixed permanent tier.
- **Relative intensity**: a scaled movement should be roughly as challenging for that athlete as the Rx movement is for an Rx athlete (Gordon 2015; echoed in "Hitting the Stimulus").

**CONFIRMED PRODUCT/PROGRAM BEHAVIOR — CAP:** "CAP" is a real, documented CrossFit HQ program, but it is **CrossFit Affiliate Programming**, not a "CrossFit Athlete Certification Program" (no such certification exists in the sources found). CAP is a done-for-you daily workout programming service bundled into affiliate membership (crossfit.com/affiliate-toolkit/crossfit-affiliate-programming). It ships with three baked-in tiers per workout — **Beginner, Intermediate, Rx'd** — each with explicit qualification criteria (e.g., Beginner = <6 months experience, cannot sustain 15+ rep sets of bodyweight movements; Intermediate = completes Rx'd workouts roughly a third to half of the time). Scaling within CAP is authored entirely by CrossFit HQ's programming staff/coaching leads — there is no indication anywhere in CrossFit's own materials of AI or automated generation of these tiers. An optional "Compete Track" adds a fourth, harder tier for competition-focused athletes.

# btwb

**CONFIRMED PRODUCT BEHAVIOR:** btwb (Beyond the Whiteboard) is primarily a results-tracking/benchmark-history platform (PRs, leaderboards, athlete performance analytics) rather than a full class-management/programming suite. As of the blog content found (blog.btwb.com), btwb has shipped two generative-AI features:
- **AI Planner** — coaches can paste workout descriptions from the internet or spreadsheets, or start from templates, to quickly generate/populate a structured workout with movements, reps, and loads pre-filled ("smarter over time the more it's used," "powered by over 100 million btwb results").
- **AI Logger** — athletes/coaches paste or type a workout description (including shorthand like "RFT," "HSPU," "95/95") to log a result in seconds, rather than manually building the structured entry.

btwb's own copy describes these as "the first of many AI features coming to btwb." No scaling-tier generation (Rx/Intermediate/Beginner) by AI is described in the material found — the AI features found are about *parsing/authoring the Rx workout itself* and *parsing logged results*, not about AI-generated scaled variants. **Could not verify** whether AI Planner suggests substitutions or scaled loads automatically; the public copy only describes movement/rep/load population from pasted text and templates.

# SugarWOD

**CONFIRMED PRODUCT BEHAVIOR:** SugarWOD is a class programming + performance-tracking platform for CrossFit/functional-fitness gyms. Coaches build a calendar of workouts with movement descriptions, scaling notes, and coaching notes; athletes log Rx, Scaled, or Modified results distinctly (sugarwod.com/the-workout-process/).

**On AI specifically:** SugarWOD published a 2026 article ("Programming with AI: How to coach smarter with SugarWOD") that discusses AI in **general, aspirational terms** — surfacing scaling adjustments from athlete history, flagging progression gaps, tracking readiness — but the article itself does **not** describe a shipped, concrete feature (no screenshots, no named tool, no workflow steps). It explicitly frames AI as advisory: "AI acts as an assistant, not the authority," with coaches retaining final say. This reads as thought-leadership/content marketing rather than a product announcement. **Could not verify** that SugarWOD has a shipped AI parsing or AI-scaling-generation feature comparable to btwb's AI Planner — the primary source found stops at conceptual discussion.

# Wodify

**CONFIRMED PRODUCT BEHAVIOR:** Wodify's workout builder is a manual, drag-and-drop authoring tool (help.wodify.com "Build and Edit Workouts," "Creating Programs"). Coaches configure warm-ups, coaching notes, and per-client scaling defaults (e.g., a client-level preference for "Default Scaling to Rx" vs. "Scaled," confirmed via Wodify's May 2026 release notes and "Default Client Workout Settings" help article). Scaling is represented as a binary/simple toggle at logging time rather than as AI-generated tiered content.

**On AI:** Wodify's product pages reference AI-driven **retention/churn-prediction** tooling ("Wodify Retain") and communication automation ("Wodify Workflows") — these are member-relationship features, not workout-authoring or scaling features. A secondary source (G2 review) referenced an "AI beta group," but this could not be corroborated on Wodify's own site and is **not** treated as confirmed. No evidence was found of AI-assisted workout parsing, generation, or automated scaling-tier creation in Wodify's own documentation.

# PushPress

**CONFIRMED PRODUCT BEHAVIOR:** PushPress "Train" is a manual workout builder (help.pushpress.com). Confirmed features: copy/paste and quick-edit of workouts, superset structuring, template reuse, keyboard shortcuts/hotkeys for fast entry, video attachment per movement, and a notable **inline percentage calculator** that computes prescribed loads from an athlete's stored 1RM/benchmark data (a deterministic, rules-based feature — not AI). Scaling appears to be handled via manual notes/alternate blocks within the builder rather than a dedicated AI-generated tier system.

**On AI:** No evidence found — in help docs or marketing pages — of AI-assisted workout parsing or AI-generated scaling in PushPress Train. **No public documentation found.**

# TrainHeroic

**CONFIRMED PRODUCT BEHAVIOR:** TrainHeroic ("Create V2") is positioned for strength & conditioning / weightlifting-style programming: a library of 1,300+ exercises with video/points-of-performance, reusable programs/sessions/circuits, and team-wide publishing to athlete groups (trainheroic.com/create-v2/, support.trainheroic.com). It supports individualized tweaks to an athlete's assigned calendar from a shared template, which functions as a manual, coach-driven scaling mechanism (adjust load/volume per athlete) rather than a named RX/Intermediate/Beginner tier system.

**On AI:** One third-party comparison listicle (coachway.io) asserted that "several platforms now include AI assist for first-draft programs" and implied TrainHeroic was among them, but this claim is **unverified — secondary source only**. Fetching TrainHeroic's own Create V2 page and its Help Center found **no mention of AI-assisted program generation, parsing, or authoring**. Treat any TrainHeroic AI-authoring claim as unconfirmed.

# TeamBuildr

**CONFIRMED PRODUCT BEHAVIOR:** TeamBuildr "BUILD" is a manual strength & conditioning programming environment (teambuildr.com/build): date-based or free-form programming, drag-and-drop construction, keyboard shortcuts, undo, a "progression view" to compare the same day-of-week across weeks, a 1,000+ exercise database, custom exercises, percentage-of-1RM and tempo entry, and reusable templates. This is a deterministic/manual toolset aimed at coach efficiency (fast data entry), not generative content creation. No scaling-tier (Rx/Intermediate/Beginner) concept was found — TeamBuildr's audience (school/college/pro/tactical strength staffs) generally programs per-athlete or per-team rather than using CrossFit-style broadcast scaling tiers.

**On AI:** No evidence found of AI-assisted authoring, parsing, or scaling generation. **No public documentation found.**

# Other Relevant Systems

Content-programming brands (Mayhem, HWPO, PRVN, Invictus) sell a pre-written daily program that gyms subscribe to and pipe into whichever software the gym already uses (Wodify/SugarWOD/PushPress) rather than being software vendors themselves; treat all findings here as thinner/marketing-derived.

- **Mayhem Athlete/Mayhem Affiliate**: confirmed multi-tier structure — competitive/RX plus two named scaling tiers ("Independence" and "Liberty" per marketplace listing text), delivered ~3 weeks after use at the flagship Mayhem gym, with equipment-substitution guidance for gyms lacking specialty equipment (programs.btwb.com/mayhem/affiliate). Authoring is by named human coaches. No AI mentioned anywhere.
- **HWPO Training**: three named program tracks (Class, Sweat, Focus), each including scaling options and coaching cues (hwpotraining.com/programs). No AI mentioned.
- **PRVN Fitness**: leveled scaling options plus full coaching notes and video briefs, authored by named coaches (Tia-Clair Toomey/Shane Orr organization) (prvnfitness.com/pages/programming). No AI mentioned.
- **Invictus Affiliate Programming**: multiple class "tracks" distributed through Wodify/SugarWOD/PushPress marketplaces. No AI mentioned.
- **Zenplanner / Exercise.com**: general gym-management platforms; no evidence of AI workout-authoring or LLM-based parsing tied to their core products. **No public documentation found.**
- General web search for LLM-based fitness program generators surfaced only independent/hobbyist projects (GitHub repos, generic consumer "AI workout planner" apps) unaffiliated with any gym/box-management vendor above — confirming these are a separate market category.

All four content-programming brands are consistent in one respect: scaling is presented as **hand-authored by name-brand human coaches** as a marketing/credibility feature, not as software-generated — for these businesses, "a real coach wrote this" is part of the value proposition, so AI-generated scaling would arguably undercut their own positioning.

# AI Authoring Evidence

| Vendor | AI workout-text parsing (Rx authoring) | AI-generated scaling tiers | Status |
|---|---|---|---|
| btwb | **Yes** (AI Planner: paste text → structured workout) | Not described in sources found | Confirmed, partial |
| SugarWOD | Described conceptually, not confirmed shipped | Described conceptually, not confirmed shipped | Marketing/thought-leadership only |
| Wodify | No | No | Not found; AI effort is retention-focused |
| PushPress Train | No | No | Not found |
| TrainHeroic | No (one unverified secondary claim) | No | Not found on vendor's own pages |
| TeamBuildr | No | No | Not found |
| Mayhem/HWPO/PRVN/Invictus (content programs) | No — human-authored | No — human-authored, pre-set tiers | N/A (content businesses) |

**Overall finding: btwb is the only vendor found with a confirmed, shipped, publicly documented generative-AI feature for turning free-text workout descriptions into structured workout data**, and free-text results into logged data. **No vendor researched — including btwb — has public documentation of AI *generating* Rx/Intermediate/Beginner scaled variants from a base workout.** This absence, across seven software vendors and four programming-content brands, is itself a notable finding: AI-generated scaling-variant creation does not appear to be an established or even emerging industry pattern as of this research, in contrast to AI-assisted free-text-to-structured-data parsing, which has at least one confirmed shipped example.

# Manual Authoring Patterns

Across Wodify, PushPress Train, TrainHeroic, and TeamBuildr, the dominant authoring pattern is a **manual, structured builder**: drag-and-drop or form-based entry of movements/reps/loads, reusable templates and libraries (exercise databases of 1,000+ to 1,300+ movements with video), copy/paste of previously-built workouts (structured-object copy within the same tool, not free-text parsing), and keyboard shortcuts for speed. Percentage-based load calculation (TrainHeroic, PushPress) is common and deterministic (computed from stored 1RM/benchmark data), not AI-driven. The category has converged on "fast structured entry + reusable libraries" as the default solution to authoring friction, rather than free-text/NL parsing — with btwb as the one outlier attempting NL-to-structured parsing.

# Scaling Patterns

Two structurally distinct scaling patterns appear across the sources:

1. **Fixed named tiers authored per-workout by a human** (CrossFit CAP: Beginner/Intermediate/Rx'd with explicit qualifying criteria per tier; Mayhem: RX/Independence/Liberty). The CrossFit-native pattern — tiers are consistently named, criteria-based, and written by a program's coaching staff, not generated per-athlete.
2. **Per-athlete manual adjustment against a shared template** (TrainHeroic, TeamBuildr) — common in strength & conditioning software outside CrossFit-style group classes, where a coach tweaks an individual athlete's numbers off a shared program rather than authoring named universal tiers.

Wodify and PushPress represent a lighter-weight middle ground: a binary Rx/Scaled flag at the logging level, with the actual scaling substance captured as free-text coaching notes rather than a structured, separately-tracked variant object.

No vendor researched implements scaling as an *automatically generated, athlete-agnostic set of alternate structured workouts* (base workout plus N fully-independent structured variants produced without a human writing them) — CrossFit's own CAP tiers, the closest documented three-tier model in the market, are entirely human-authored by HQ programming staff.

# Coach Control

Every documented system in this research — including the one with confirmed generative AI (btwb) — describes the coach/programmer as the final authority. SugarWOD's own language is explicit: "AI acts as an assistant, not the authority" and "coaches still apply judgment, context, and experience when making final programming decisions." CrossFit HQ's own scaling doctrine is fundamentally about *coach judgment applied per-athlete, per-day* (injury status, training history, day-to-day mindset/energy cited in CrossFit Journal 2015 as inputs a coach weighs) — explicitly not a fixed lookup table, notable since CAP's three written tiers exist in tension with that same doctrine (HQ resolves this by treating the CAP tiers as a starting point/default, not a replacement for coach judgment).

# Lessons for Forge

- The one confirmed precedent for LLM-based free-text-to-structured workout parsing in this space (btwb's AI Planner/AI Logger) frames the AI's output explicitly as a starting point that "gets smarter over time," implying users are expected to review/correct output rather than trust it blindly — consistent with a coach-review checkpoint being the norm wherever AI touches workout authoring.
- CrossFit's own scaling doctrine (order of operations: load → volume → movement substitution, in that priority) is a documented, decades-old, source-backed methodology that any scaling-generation logic in this space would be measured against by CrossFit-literate coaches — a real external benchmark, not something to invent internally.
- CAP demonstrates that the market's most credible three-tier (Beginner/Intermediate/Rx) scaling model ships with explicit, criteria-based tier definitions (experience thresholds, rep-capacity thresholds) rather than vague labels — the tiers are legible and audit-able by a coach at a glance.
- No competitor was found publicly claiming AI-generated scaling tiers as a shipped feature; SugarWOD's own AI content is careful to describe AI as advisory only. A coach-editable review step before scaled variants go live is consistent with how the one vendor with real generative-AI workout tooling (btwb) frames its own product, and with how the only content-marketing discussion of AI scaling (SugarWOD) frames the idea.
- The strength & conditioning side of the market (TrainHeroic, TeamBuildr) solves "how do less-capable athletes train the same program" differently — per-athlete number adjustment against a shared template — rather than named universal tiers. A structurally different model, worth being aware of even if not directly applicable to CrossFit-style group-class scaling.

# What Forge Should NOT Copy

- Nothing in the researched market suggests copying a specific vendor's UI/workflow verbatim is warranted — most competitors (Wodify, PushPress, TrainHeroic, TeamBuildr) have not shipped anything resembling AI-assisted authoring at all, so there is no dominant "industry standard AI workflow" to imitate.
- The content-programming brands' practice of naming scaling tiers after their own brand/identity ("Independence," "Liberty") is a marketing differentiator specific to those businesses' positioning around named human coaches — not a pattern with architectural relevance.
- SugarWOD's 2026 article is content marketing, not a product spec; its "AI as assistant, not authority" language is a useful directional data point but should not be treated as describing a concrete, tested workflow — it does not.
- Given that only one vendor (btwb) has public documentation of any generative-AI workout-authoring feature, and even that documentation is thin (no detail on error handling, accuracy, or how corrections are surfaced to the coach), this space does not yet offer a mature reference implementation to benchmark against for reliability, edge-case handling, or UX polish — those questions remain open industry-wide, not just for Forge.

---

*Research conducted by a dedicated research pass (web search against the primary sources listed above) as part of this Phase 0 mission; synthesized here unchanged in substance from that pass's findings, reformatted to this document's required structure.*
