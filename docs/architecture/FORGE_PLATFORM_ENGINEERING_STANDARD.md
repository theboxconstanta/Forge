# Forge Platform Engineering Standard

This document defines the permanent engineering standard for the Forge platform.

Treat this document as the project's architectural constitution.

Unless I explicitly override a rule, every future architectural, product and implementation decision must comply with this standard.

Whenever two possible solutions exist, choose the one that strengthens the Forge platform rather than solving only the current task.

This standard applies to every current and future Forge client.

---

# Vision

Forge is not a collection of applications.

Forge is a single SaaS platform with multiple clients.

Current clients:

- Member Web (PWA)
- Admin Web

Future clients:

- Member iOS
- Member Android
- Admin iOS
- Admin Android
- Any future Forge client

Every client represents the same platform.

The user should never perceive them as different systems.

---

# Platform Philosophy

There is only one Forge platform.

Every client is simply another interface to the same backend, business logic and platform state.

Synchronization is not a feature.

Synchronization is a core platform guarantee.

Every architectural decision must reinforce this principle.

---

# Primary Objective

Build Forge as a platform, not as multiple applications.

Every architectural decision should improve the platform as a whole, never just a single client.

The objective is NOT to make Web communicate with PWA.

The objective is to ensure that every Forge client reflects the same platform state.

---

# Platform Principle

Any CREATE, UPDATE, DELETE, ARCHIVE or RESTORE performed from any Forge client must automatically become visible on every other authorized Forge client that depends on that data, without requiring manual refresh, unless an explicit architectural exception has been approved.

Realtime is infrastructure.

Synchronization is the product behavior.

---

# Working Principles

Before implementing anything:

1. Inspect the existing architecture.
2. Understand the complete data flow.
3. Reuse existing infrastructure whenever possible.
4. Never duplicate business logic.
5. Never introduce client-specific business rules unless explicitly required.
6. Preserve Forge as the single source of truth.
7. Prefer platform-level solutions over page-level fixes.
8. Prefer architectural improvements over temporary fixes.

---

# Business Logic Principles

Business logic belongs to the platform.

Synchronization belongs to the platform.

Clients are responsible only for:

- presenting data
- collecting user interactions
- invoking platform operations
- displaying platform state

Clients should never become the source of truth.

---

# Synchronization Standard

Every shared entity must remain synchronized across all authorized Forge clients.

For every entity verify independently:

- CREATE propagation
- UPDATE propagation
- DELETE propagation
- ARCHIVE propagation
- RESTORE propagation

Do not assume symmetry.

Verify every direction independently.

---

# Definition of Done

A feature is NOT complete until all affected Forge clients remain synchronized.

No manual refresh.

No hidden refresh.

No page reload.

No duplicated logic.

No client divergence.

Polling is acceptable only when explicitly approved as an architectural exception.

---

# Required Analysis

For every shared entity determine:

## Readers

Who can read it?

## Writers

Who can modify it?

## Propagation

If Client A changes it:

Which clients must immediately receive the update?

Verify every direction independently.

---

# Platform Consistency Matrix

Produce a matrix similar to:

| Entity | Writer | Readers | Current | Expected | Status |
|---------|---------|----------|----------|-----------|--------|
| Plans | Admin | Member/Admin | Partial | Immediate | ❌ |
| Subscriptions | Member | Admin/Member | Immediate | Immediate | ✅ |

Status values:

- ✅ Fully synchronized
- ⚠️ Partially synchronized
- ❌ Missing synchronization
- 🚫 Intentional architectural exception

Every shared entity must belong to exactly one category.

---

# Architectural Rules

Never optimize only for today's clients.

Every solution must remain valid for:

- Member Web
- Admin Web
- Native iOS
- Native Android
- Future Forge clients

Avoid architecture that depends on a specific UI framework.

Design around the platform.

---

# Implementation Rules

Never implement speculative features.

Never rewrite working infrastructure without evidence.

Prefer minimal, production-safe changes.

If existing architecture already solves the problem:

Reuse it.

If not:

Extend it.

Do not duplicate it.

---

# Validation

After every implementation verify:

- Multiple browser tabs
- Member → Admin propagation
- Admin → Member propagation
- Admin → Admin propagation
- Member → Member propagation (where applicable)
- Future client compatibility
- Reconnect behavior
- Session restore
- Temporary network loss
- Duplicate subscriptions
- Memory leaks
- Unnecessary refetches
- Cross-tenant leakage
- Financial Domain regression

Synchronization must survive reconnects and temporary network interruptions.

---

# Reporting

After every completed task provide:

## Findings

What was discovered.

## Root Cause

Why the problem existed.

## Solution

Exactly what changed.

## Validation

How the solution was verified.

## Remaining Risks

Anything still unverified.

---

# Stop Conditions

Immediately stop and request approval if:

- Business logic would be duplicated.
- Financial Domain would be modified.
- RLS would be weakened.
- Cross-tenant isolation could be affected.
- Existing architecture must fundamentally change.
- The solution introduces client divergence.

Do not continue until approval.

---

# Decision Rule

When making architectural decisions, always prefer the solution that benefits the Forge platform rather than a single client.

Never optimize for Web.

Never optimize for PWA.

Never optimize for today's implementation.

Optimize for a platform that may have many clients sharing the same backend.

A solution is considered correct only if it remains valid when a new Forge client is introduced.

---

# Golden Rule

Forge behaves as one platform.

Clients never synchronize with each other directly.

Clients synchronize only with the platform state.

If a user can observe inconsistent data between two authorized Forge clients, the implementation is incomplete.

---

# Engineering Standard

Every new feature must answer YES to all of the following questions before it can be considered complete:

- If an Admin changes this data, do all authorized clients update automatically?
- If a Member changes this data, do all authorized clients update automatically?
- If another Admin changes this data, do all Admin clients update automatically?
- If another Member changes this data, do all authorized Member clients update automatically (where applicable)?
- Does synchronization survive reconnects?
- Does synchronization survive temporary network loss?
- Does synchronization work without requiring a page refresh?
- Does synchronization avoid duplicated business logic?
- Will this solution still be correct if Forge gains new clients in the future?

If any answer is NO, the implementation is incomplete unless an explicit architectural exception has been approved.

---

# Expected Quality

Think and implement like a senior platform architect.

Prioritize, in this exact order:

1. Correctness
2. Platform consistency
3. Architecture
4. Maintainability
5. Simplicity
6. Performance

Never optimize only for the current milestone.

Optimize for Forge as a long-term SaaS platform that will support multiple clients over many years.

Every decision should strengthen the platform, not just solve the current task.
