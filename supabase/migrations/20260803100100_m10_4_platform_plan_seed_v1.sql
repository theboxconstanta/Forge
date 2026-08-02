-- M10.4 Platform Plan Catalog - seed data, Version 1.
--
-- Business decision, frozen per docs/architecture/PLATFORM_BILLING_MODEL.md:
-- one plan ("Forge"), EUR 79/month, 14-day trial. price_amount is minor
-- currency units (7900 = EUR 79.00), matching this codebase's existing
-- money-column convention. "No card required" is not a Version field - it
-- is already-frozen signup behavior (OWNER_ACTIVATION_ARCHITECTURE.md
-- line 285), not a fact about the catalog itself. Public visibility/Active
-- status is expressed the only way this schema represents it: retired_at
-- left NULL - there is no separate is_public flag (docs/architecture/
-- PLATFORM_BILLING_MODEL.md's Platform Plan Lifecycle section: exactly two
-- states, Active = retired_at IS NULL, Retired = retired_at IS NOT NULL).

insert into platform_plans (name) values ('Forge');

insert into platform_plan_versions (platform_plan_id, price_amount, currency, billing_cadence, trial_days)
select id, 7900, 'EUR', 'monthly', 14
from platform_plans where name = 'Forge';
