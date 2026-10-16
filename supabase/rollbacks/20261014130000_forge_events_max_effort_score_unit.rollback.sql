-- ROLLBACK for 20261014130000_forge_events_max_effort_score_unit.sql.
-- NOT a migration. Run only with explicit owner approval, as a single file.
-- Removes ONLY the objects that migration created; no data is touched
-- (the migration rewrote no rows). Must run BEFORE the Phase 1 rollback if
-- both are rolled back.

begin;

drop trigger if exists event_attempts_validate_max_effort_trg on public.event_attempts;
drop function if exists public.event_attempts_validate_max_effort();
alter table public.events drop constraint if exists events_max_effort_score_unit;
drop function if exists public.forge_events_max_effort_unit_valid(text);

commit;
