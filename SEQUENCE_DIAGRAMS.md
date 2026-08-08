# Forge — Sequence Diagrams

**Status:** Draft for review. Every actor/system named below maps directly to an entity or engine defined in the rest of this package; no new actor is introduced here that is not already specified elsewhere.

---

## 1. Coach creates workout

```mermaid
sequenceDiagram
    actor Coach
    participant ProgUI as Programming Authoring Surface
    participant Workout as Workout (Draft)
    Coach->>ProgUI: Open Day, start authoring
    ProgUI->>Workout: Create Draft (gym, day)
    Coach->>ProgUI: Add Section(s), Movements, Format
    ProgUI->>Workout: Update Draft content (freely mutable, nothing external depends on it)
    Coach->>ProgUI: (optional) Assert Benchmark Identity
    Coach->>ProgUI: (optional) Write Coach/Athlete Notes, attach Media
    Note over Workout: No WorkoutVersion exists yet — versioning begins only at first Publish
```

## 2. Workout published

```mermaid
sequenceDiagram
    actor Coach
    participant ProgUI as Programming Authoring Surface
    participant VGE as Variant Generation Engine
    participant Workout
    participant WV as WorkoutVersion (new, immutable)
    Coach->>ProgUI: (optional) "Generate Variants"
    ProgUI->>VGE: generate(baseScalingProfile, targetTier, movementLibrary, ruleSet)
    VGE-->>ProgUI: Proposed Scaling Profile (sourceType: generated)
    Coach->>ProgUI: Review, edit or accept each tier
    Coach->>ProgUI: Publish
    ProgUI->>Workout: status = Published
    ProgUI->>WV: Create WorkoutVersion 1 (frozen snapshot: Sections, Movements, accepted Scaling Profiles, Benchmark Identity, Metadata)
    Note over WV: Immutable from this point forward — never updated, never deleted
    ProgUI-->>Coach: Confirmation
```

## 3. Member requests workout

```mermaid
sequenceDiagram
    actor Member
    participant PWA
    participant Workout
    participant WV as WorkoutVersion (current)
    Member->>PWA: Open today's Workout
    PWA->>Workout: Resolve (gym, day)
    Workout-->>PWA: workout_id
    PWA->>WV: Fetch latest non-withdrawn WorkoutVersion for workout_id
    WV-->>PWA: Frozen content (Sections, Scaling Profiles, Benchmark Identity, Athlete Notes only — no Coach Notes)
```

## 4. Workout rendered

```mermaid
sequenceDiagram
    actor Member
    participant PWA
    participant RenderPipe as Rendering Pipeline
    participant WV as WorkoutVersion
    participant MemberProfile as Member (Scaling Context + unit pref)
    PWA->>MemberProfile: Read Scaling Context, unit preference
    PWA->>RenderPipe: render(workoutVersion, scalingContext, unitPreference, renderRuleSetVersion)
    RenderPipe->>WV: resolveByPrecedence(scalingLevelId)
    Note over RenderPipe: authored/generated-then-edited > generated > Rx-with-inline-scaling (view-time only)
    RenderPipe->>RenderPipe: Convert units, resolve any formula Load Profiles against Member's own attributes
    RenderPipe-->>PWA: RenderedVariant (deterministic; cache-eligible, content-addressed)
    PWA-->>Member: Display
```

## 5. Member submits score

```mermaid
sequenceDiagram
    actor Member
    participant PWA
    participant Results
    participant Snapshot as Scoring Snapshot
    Member->>PWA: Enter Score (fast path: Score + Scaling Context only, per Minimal Core)
    PWA->>Results: Create Result
    Results->>Snapshot: Freeze { scoreModel, scalingContext, workoutVersionRef, renderedVariantHash }
    Note over Snapshot: Written once, never updated afterward
    Results-->>PWA: Result created (id)
```

## 6. Score validated

```mermaid
sequenceDiagram
    participant Results
    participant RxEngine as Rx Engine
    participant WV as WorkoutVersion (Scaling Profiles)
    Results->>RxEngine: validate(resultAttempt, workoutVersion.scalingProfiles)
    RxEngine->>WV: Read frozen Scaling Profile per tier (read-only, no write to Programming)
    RxEngine->>RxEngine: Evaluate decision matrix per dimension (movement, load, reps, equipment, order, cap)
    RxEngine-->>Results: ValidationRecord (performedVariant, prescribedVariant, rxEligible, classifiedTier, leaderboardEligible, deltas, reasons, confidenceScore)
    Results->>Results: Persist ValidationRecord as part of Result's permanent record
    Results->>Results: Run PR-detection check (v1.0 §8.1, unmodified) in the same write transaction
```

## 7. Leaderboard updated

```mermaid
sequenceDiagram
    actor Member
    participant PWA
    participant Leaderboard as Leaderboard Read Model
    participant Results
    Member->>PWA: Open Leaderboard (Workout or Benchmark, category)
    PWA->>Leaderboard: Request(workoutOrBenchmarkId, category, dateRange?)
    Leaderboard->>Results: Query Results where leaderboardEligible AND classifiedTier == category
    Results-->>Leaderboard: Matching Results (best-of-day, per Member, per §Duplicate Prevention)
    Leaderboard->>Leaderboard: Order by Score Model comparison rule, apply Tie-Break Key if declared, apply 1-1-3 ranking
    Leaderboard-->>PWA: Ranked LeaderboardEntry rows (derived, not persisted)
    Note over Leaderboard: No write occurs here — this entire flow is a read
```

## 8. Analytics generated

```mermaid
sequenceDiagram
    participant Results
    participant AE as AnalyticsEvent (append-only)
    participant Analytics as Analytics Aggregation
    Results->>AE: Emit { eventType: 'result-logged', memberId, gymId, timestamp, resultRef, payload }
    Note over AE: Same write transaction as Result creation — never a separate, laggy background job
    Analytics->>AE: Read event stream (windowed, or full replay for rebuild)
    Analytics->>Analytics: Compute trend/consistency/PR-trend/participation aggregations as pure functions over the stream
    Analytics-->>Analytics: Cacheable aggregation output (a read optimization, never the source of truth)
```

## 9. Workout edited after scores exist

```mermaid
sequenceDiagram
    actor Coach
    participant ProgUI
    participant Workout
    participant WVold as WorkoutVersion N (existing, immutable)
    participant WVnew as WorkoutVersion N+1 (new, immutable)
    participant Results as Existing Results (referencing WVold)
    Coach->>ProgUI: Edit already-Published Workout content
    ProgUI->>Workout: Apply edit to current mutable authoring state
    ProgUI->>WVnew: Create WorkoutVersion N+1 (frozen new snapshot)
    Note over WVold: Untouched — remains permanently resolvable exactly as it was
    Note over Results: Scoring Snapshots referencing WVold remain fully valid and correctly interpretable — zero cascade, zero reinterpretation
    Workout->>Workout: "Current content" pointer moves to WorkoutVersion N+1
    par New Results after this point
        Results->>WVnew: New Scoring Snapshots reference WorkoutVersion N+1
    and Old Results, unaffected
        Results->>WVold: Old Scoring Snapshots still resolve correctly against WorkoutVersion N
    end
    Note over Results: A leaderboard read spanning both versions applies Version Isolation rules (LEADERBOARD_RULES.md §4) if the Score Model itself changed between N and N+1
```
