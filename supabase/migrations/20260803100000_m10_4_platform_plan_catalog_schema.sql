-- M10.4 Platform Plan Catalog & Pricing Page - schema.
--
-- platform_plans / platform_plan_versions (OWNER_DOMAIN_IMPLEMENTATION_
-- ARCHITECTURE.md Section 5.2): Forge's own sellable catalog, platform-wide
-- (no gym_id - the one deliberate exception to gym-scoping in this domain,
-- named as such rather than left to be discovered during review, per
-- M10_IMPLEMENTATION_PLAN.md's own "Tenant isolation risks, checked" note).
--
-- Versioning policy frozen in docs/architecture/PLATFORM_BILLING_MODEL.md:
-- a Plan Version is insert-only once created - price_amount/currency/
-- billing_cadence/trial_days never change in place. The one designed
-- exception is retired_at (NULL -> now(), never back), the sole mutable
-- field on this table. A price change is always a new row, never an edit;
-- the old row is retired, never deleted, and remains a valid, resolvable
-- reference for whatever historical record points to it (a mechanism this
-- milestone's schema supports but does not yet use - Platform Subscription/
-- Order do not exist until M10.5).
--
-- No `description` column: the plan's own Frontend impact requires plan
-- descriptions to be localized (ro + en) via translations.js, exactly like
-- every other piece of UI copy in this codebase - a raw text column here
-- could hold only one language and would become a second, disconnected
-- source of truth for the same copy. Marketing description text lives
-- exclusively in translations.js.

create table platform_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table platform_plan_versions (
  id uuid primary key default gen_random_uuid(),
  platform_plan_id uuid not null references platform_plans(id),
  price_amount integer not null check (price_amount >= 0),
  currency text not null check (char_length(currency) = 3),
  billing_cadence text not null,
  trial_days integer not null check (trial_days >= 0),
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

create index platform_plan_versions_plan_id_idx on platform_plan_versions (platform_plan_id);

-- Speeds the pricing page's own query (active Versions only) - mirrors the
-- partial-index pattern already used for admin_invitations/gym_invitations'
-- "current outstanding row" lookups.
create index platform_plan_versions_active_idx on platform_plan_versions (platform_plan_id)
  where retired_at is null;

alter table platform_plans enable row level security;
alter table platform_plan_versions enable row level security;

-- Public catalog - readable by anyone, including unauthenticated (the
-- pricing page's own requirement, OWNER_ACTIVATION_ARCHITECTURE.md Section
-- 6: "visible without requiring an email first"). No INSERT/UPDATE/DELETE
-- policy for anon or authenticated at any level - Plan/Version rows are
-- written exclusively by reviewed migration (M10_IMPLEMENTATION_PLAN.md's
-- own scope note: a CRUD admin UI is deliberately not built for something
-- that changes a handful of times a year), never by any client role.
create policy platform_plans_select_public on platform_plans
  for select to anon, authenticated
  using (true);

create policy platform_plan_versions_select_public on platform_plan_versions
  for select to anon, authenticated
  using (true);

grant select on table platform_plans to anon, authenticated;
grant select on table platform_plan_versions to anon, authenticated;
grant all on table platform_plans to service_role;
grant all on table platform_plan_versions to service_role;

-- Close the default-privileges auto-grant hazard proactively this time -
-- found and fixed as a live, after-the-fact correction in both M10.1 and
-- M10.3; applied inline here instead. Still independently re-verified live
-- via information_schema.role_table_grants after this migration runs, not
-- assumed safe just because it is written inline this time.
revoke insert, update, delete, truncate on table platform_plans from anon, authenticated;
revoke insert, update, delete, truncate on table platform_plan_versions from anon, authenticated;

comment on table platform_plans is
  'M10.4 Platform Plan Catalog (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.2). Forge''s own sellable catalog, platform-wide, not gym-scoped. Written exclusively via reviewed migration - no client write path exists.';
comment on table platform_plan_versions is
  'M10.4 Platform Plan Version. Insert-only once created except retired_at (docs/architecture/PLATFORM_BILLING_MODEL.md). A price change is always a new row, never an edit.';
