-- Forge Admin Web M12 (Subscriptions module): the subscriptions table has
-- an index only on gym_id (and its PK). Every access pattern the new
-- Subscriptions list needs - search by member_email, filter by plan_id,
-- filter by status (is_active/queued), sort by start_date/end_date/
-- created_at - hits an otherwise-unindexed column.
--
-- Invisible today (160 rows total across all gyms), but this module is
-- explicitly specified to scale to tens of thousands of subscriptions
-- across many gyms. All indexes are (gym_id, column) composites, matching
-- how every query already scopes by gym_id first via RLS/my_gym_id().
--
-- Purely additive: no RLS, trigger, or column change. Safe to apply live.

create index if not exists subscriptions_gym_member_email_idx on subscriptions (gym_id, member_email);
create index if not exists subscriptions_gym_plan_id_idx on subscriptions (gym_id, plan_id);
create index if not exists subscriptions_gym_status_idx on subscriptions (gym_id, is_active, queued);
create index if not exists subscriptions_gym_start_date_idx on subscriptions (gym_id, start_date);
create index if not exists subscriptions_gym_end_date_idx on subscriptions (gym_id, end_date);
create index if not exists subscriptions_gym_created_at_idx on subscriptions (gym_id, created_at);
