-- M10.1b - Lifecycle Backfill.
--
-- Brings every pre-M10.1 Gym to the same structural state as a Gym created
-- through bootstrap_owner_gym: exactly one gym_activation_state row and
-- exactly one gym_commercial_state row each. Purely additive - inserts
-- only rows that do not already exist; never updates, never deletes,
-- never touches a row this migration did not itself create.
--
-- Defaults, each derived from already-frozen decisions, none invented here:
--
-- activation_state = 'activated' - M10_IMPLEMENTATION_PLAN.md's own M10.1
-- milestone already specified this exact backfill policy verbatim
-- ("already-operating Gyms marked activated/paying, per a one-time
-- backfill"). Every Gym in production today is a real, currently-operating
-- gym (verified below, Production Analysis) - 'activated' is the only
-- value in OWNER_LIFECYCLE_STATE_MACHINE.md's vocabulary that honestly
-- describes that.
--
-- first_value_at / activated_at = left NULL, deliberately, not
-- reconstructed. A real historical value could in principle be derived
-- (the earliest non-owner membership ever created for each gym), but doing
-- so would require re-deriving "who was the first genuinely distinct
-- member" per gym after the fact, for a field nothing in this system reads
-- today - the risk of misattributing history for zero present consequence
-- outweighs the completeness. activation_state = 'activated' already
-- correctly represents the real, current, structural truth (this Gym has
-- demonstrably passed this milestone); the exact original timing is
-- honestly recorded as unknown rather than fabricated.
--
-- owner_admin_id = gyms.owner_id - verified live, individually, for all
-- three production Gyms before writing this migration: every gyms.owner_id
-- already resolves to a matching admins row for that same gym_id (the
-- exact precondition this column's NOT NULL + FK requires). Not assumed.
--
-- commercial_state = 'paying' - same M10_IMPLEMENTATION_PLAN.md backfill
-- policy. Also the only value in the vocabulary that guarantees these real,
-- already-operating Gyms are never later blocked by trial-expiry
-- enforcement (a future milestone, M10.8, not yet built) - 'trial_running'/
-- 'trial_ending' would falsely imply a ticking clock that was never
-- agreed to; 'expired'/'past_due'/'cancelled' would falsely imply these
-- Gyms should lose access, which they must never do as a side effect of
-- this migration. gyms.is_active (a separate, pre-existing, unrelated
-- platform-level block mechanism - confirmed all three production Gyms are
-- is_active=true) is left untouched; commercial_state is deliberately
-- uniform across every Gym regardless of is_active, matching the
-- already-frozen plan, which draws no such distinction.
--
-- trial_started_at / trial_ends_at / platform_subscription_id = NULL -
-- these Gyms never had a trial (they predate the Trial concept entirely)
-- and no Platform Subscription exists yet (M10.5+, not yet built) - NULL
-- is the accurate fact, not a placeholder.

insert into gym_activation_state (gym_id, owner_admin_id, activation_state)
select g.id, g.owner_id, 'activated'
from gyms g
where not exists (select 1 from gym_activation_state s where s.gym_id = g.id);

insert into gym_commercial_state (gym_id, commercial_state)
select g.id, 'paying'
from gyms g
where not exists (select 1 from gym_commercial_state s where s.gym_id = g.id);
