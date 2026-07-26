-- M1.3 - Member Domain Backfill: additive schema (Step 1 of 2)
--
-- Adds the nullable columns the approved M1.2 Backfill Mapping
-- Specification requires on `members` and `memberships` that did not
-- already exist after M1.1. Purely additive - both tables are still
-- empty at this point, so no existing row can be affected.
--
-- Column -> destination mapping is exactly M1.2 Section 2; no column
-- here is newly decided by this migration.

alter table members add column gender text;
alter table members add column first_name text;
alter table members add column last_name text;
alter table members add column birth_date date;
alter table members add column weight_unit text;
alter table members add column language text;

alter table memberships add column waiver_accepted boolean;
alter table memberships add column waiver_accepted_at timestamptz;
