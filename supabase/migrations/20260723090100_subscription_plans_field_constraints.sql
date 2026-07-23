-- Forge Admin Web M13 (Membership Catalog Management): before building
-- Create/Edit Plan, inspected the Member App's own validation for adding a
-- plan (src/App.jsx savePlan) - it checks only that `name` is non-empty.
-- Price, sessions, and duration_months are never validated, not even
-- client-side beyond a one-off UI clamp on duration_months that isn't
-- backed by anything server-side. Forge Core itself has zero CHECK
-- constraints on subscription_plans beyond the PK and the gym_id FK
-- (confirmed via pg_constraint) - nothing stops a negative price, a
-- zero/negative sessions count, or a zero/negative duration today.
--
-- Rather than have Admin Web duplicate (and only partially re-implement)
-- the Member App's incomplete frontend-only checks, this closes the gap
-- at the actual source of truth. Both frontends' form validation now
-- mirrors a real backend rule instead of being the only rule.
--
-- `sessions is null` remains valid and means "unlimited" - the existing,
-- already-established convention throughout the app (Member App's
-- catalog/admin UI, Admin Web's own display logic) - this migration does
-- not change that meaning, only rejects a *present but non-positive*
-- sessions value, which was never a meaningful state to begin with.

alter table subscription_plans
  add constraint subscription_plans_price_check check (price is null or price >= 0);

alter table subscription_plans
  add constraint subscription_plans_sessions_check check (sessions is null or sessions > 0);

alter table subscription_plans
  add constraint subscription_plans_duration_months_check check (duration_months > 0);
