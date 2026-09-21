# FORGE — Leaderboard Social Interactions V1

Status: APPROVED, IMPLEMENTING. Forensic produced in a prior Claude Code session
(not committed as a repo document at the time); owner-approved decisions recorded
below; verified against the live repo/DB on 2026-09-21 before implementation.

## 1. Product scope (owner-approved)

Reactions + comments on individual **leaderboard results** (`wod_logs` rows only).
Five emoji: 👍 ❤️ 🔥 💪 👏. One active reaction per member per result — tap a
different emoji to swap, tap the same emoji again to remove. Comments: plain text
1–500 chars, author name/avatar, relative time, edited indicator, author
edit/delete, coach/admin delete-only moderation. No replies, photos, mentions,
notifications, separate feed, or Realtime in V1.

`skill_logs` (34 leaderboard-eligible rows at forensic time) and the derived
Aggregate cross-section block are explicitly OUT of scope for V1 — no polymorphic
result reference; only a real FK to `wod_logs.id`.

## 2. Result identity

`wod_logs.id` (uuid PK) is the stable, edit-surviving identity — already used as
the React key (`cardKey`, `src/App.jsx:2677`). Score edits are in-place
`.update().eq('id', ...)`, never delete+reinsert, so interactions survive edits
automatically. Composer multi-part Overall/Part A/Part B tabs all resolve to the
same `wod_logs.id` (verified: `computeOverallPlacements` in
`src/componentLeaderboard.js` didn't carry `log.id` through — fixed by an additive
`logId` passthrough, see §5).

## 3. Cross-gym target integrity (owner mandatory requirement)

**Verified finding differing from the existing precedent**: `wod_log_media`
(the structural/RLS precedent this ticket otherwise copies byte-for-byte) does
**not** actually enforce that its `wod_log_id` belongs to its own `gym_id` — its
INSERT policy only checks `gym_id = my_gym_id()`, and the plain
`wod_log_id uuid REFERENCES wod_logs(id)` FK only checks the row exists, not that
it's in the caller's gym. This is exactly the forgery the owner's ticket §3 called
out. **Do not copy this specific gap.**

Fix used here (the forensic's "composite FK to a suitably unique (id,gym_id) key"
option): `wod_logs` gets one narrowly-scoped additive constraint,
`UNIQUE (id, gym_id)` (id is already the PK, so this is a free, non-breaking
addition — no data change, no existing-row impact). Both new tables then declare
`FOREIGN KEY (wod_log_id, gym_id) REFERENCES wod_logs(id, gym_id)` instead of a
plain FK on `wod_log_id` alone. A forged `(own gym_id, another gym's wod_log_id)`
pair has no matching row in `wod_logs`, so the FK rejects the INSERT/UPDATE at the
database level regardless of what the client sends. This applies to UPDATE too,
since Postgres enforces FK constraints on UPDATE identically to INSERT — a
retargeted `wod_log_id` that no longer matches the row's `gym_id` fails the same
constraint. Combined with `WITH CHECK (gym_id = my_gym_id())` on INSERT/UPDATE,
neither `gym_id` nor `wod_log_id` can be forged independently or together.

## 4. Schema (migration `20260921090000_leaderboard_social_v1.sql`)

```sql
ALTER TABLE wod_logs ADD CONSTRAINT wod_logs_id_gym_id_key UNIQUE (id, gym_id);

CREATE TABLE wod_log_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wod_log_id uuid NOT NULL,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','🔥','💪','👏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wod_log_reactions_one_per_member UNIQUE (wod_log_id, member_id),
  CONSTRAINT wod_log_reactions_log_gym_fkey FOREIGN KEY (wod_log_id, gym_id)
    REFERENCES wod_logs(id, gym_id) ON DELETE CASCADE
);

CREATE TABLE wod_log_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wod_log_id uuid NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  CONSTRAINT wod_log_comments_log_gym_fkey FOREIGN KEY (wod_log_id, gym_id)
    REFERENCES wod_logs(id, gym_id) ON DELETE CASCADE
);
```

Indexes: `wod_log_reactions(wod_log_id)`, `wod_log_reactions(gym_id)`,
`wod_log_comments(wod_log_id, created_at)`, `wod_log_comments(gym_id)`.

RLS — byte-for-byte the `wod_log_media` shape otherwise, with the composite-FK fix
above and these deliberate deviations:
- Reaction DELETE is **own-only**, no staff clause (an emoji isn't moderatable
  content the way a photo is).
- Comment UPDATE is **author-only, even for admins/coaches** — moderation is
  remove-only, never silent rewriting of a member's words.
- Comment DELETE: `member_id = auth.uid() OR is_coach_or_admin(gym_id)` (owner
  decision: coach-or-admin, matching the `wod_log_media` precedent).

## 5. Client changes (scope, no scoring surface touched)

- `src/leaderboardSocial.js` (new, pure) — reaction/comment reducers, one-per-
  member toggle resolution (add/swap/remove), 500-char validation, relative-time
  formatting.
- `src/leaderboardSocialUI.jsx` (new) — compact summary bar, emoji picker,
  reactor list, comment list + composer, own-comment edit/delete, coach/admin
  delete control. Every control calls `stopPropagation()` (the card's root has an
  `onClick` that collapses/expands it).
- `src/App.jsx`:
  - `fetchClasament` (:9706) — two additional batched queries keyed on the log
    ids already fetched (reactions: `wod_log_id, emoji, member_id`; comments:
    `wod_log_id` count-only), reduced client-side exactly like Feed's `rMap`.
    Reactor identities and comment bodies load lazily, only when a panel opens.
  - `Clasament` (:2313) — new props `user, isAdmin, isCoach, gymId, showToast`;
    mounts the compact summary at the header-row close (:2768/2769) and the full
    panel at the end of the expanded block (:2846/2847); gated on
    `log._source === 'wod_logs'` (skill_logs cards render no affordance, §1).
  - Call site (:14165) — pass the five new props through.
- `src/componentLeaderboard.js` — `computeOverallPlacements` (:190): add
  `logId: log?.id ?? null` to both the `ranked` and `incomplete` return shapes.
  Pure passthrough; no comparator, sort, rank, or points logic touched.
- `src/composerLeaderboardUI.jsx` — forward `logId` into `RankedRow`; mount the
  same compact summary component there so Overall/Part A/Part B show identical
  interactions for the same `wod_logs.id`.
- `src/translations.js` — new RO/EN keys alongside the existing `clasament*`
  block.

Untouched (scoring firewall): `workoutFormats.js`, `prescriptionContract.js`,
`componentContract.js`, `workoutAggregation.js`, `leaderboardSelection.js`,
`rxEngine.js`, `resultProvenance.js`, `resultWorkoutLines.js`,
`prescription_snapshot`/`performed_prescription`, DNF/partial handling,
`isMixedCategory`, `resultCompositionModified`, `sortSectionLogs`,
`dedupLatestPerMember`, `deriveWorkoutAggregate`, Journal Edit. No column added to
`wod_logs`/`skill_logs` other than the additive `(id, gym_id)` unique constraint
required for §3.

## 6. Migration ledger state (verified live, 2026-09-21)

Remote `schema_migrations` registered through `20260907090100`. Two local
migrations are applied to the live schema but **not** registered in the ledger:
`20260915090000` (pg_net extension — confirmed installed live) and
`20260916090000` (Shuttle Run reps capability — confirmed applied live, `reps` is
present in `allowed_prescription_metrics`). This matches the forensic exactly.
Per owner instruction, these two are left untouched (not this ticket's scope,
not re-registered, not re-run). The new migration here is applied via
`supabase db query --linked -f <file>` and its own version is registered
manually — `supabase db push` was not used.

## 7. Verification status

See the implementation report appended after implementation for the
PROVEN AUTOMATED / PROVEN LIVE / NOT VERIFIED breakdown.
