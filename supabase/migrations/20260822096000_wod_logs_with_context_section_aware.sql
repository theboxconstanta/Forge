-- Scoring Phase 1B, Layer 2a - wod_logs_with_context is the canonical
-- "effective format/name" resolver (Results Phase 2 Slice 2), consumed by
-- forge-admin-web's results feature. Its effective_format/
-- effective_format_config/effective_wod_name all COALESCE from `wods`
-- FIRST, falling back to the frozen snapshot only when the Workout no
-- longer exists - correct for a primary-section log, WRONG for a log
-- linked to a non-primary independently-scored section (Layer 1/2a),
-- where `wods` is still the PRIMARY section's data, never the logged
-- section's own. Same fix as App.jsx's journal/edit-entry logic
-- (esteSectiuneLegata) and snapshot_wod_log_context() (20260822090000/
-- 20260822093000) - one consistent precedence rule applied everywhere a
-- log's "actual format" is resolved: when workout_section_id is set,
-- the snapshot (already correctly section-scoped) wins; otherwise `wods`
-- wins exactly as before (byte-identical for every existing/primary-
-- section/free-form row).

create or replace view public.wod_logs_with_context as
select
  wl.id,
  wl.member_id,
  wl.wod_id,
  wl.variant_level,
  wl.result,
  wl.time_result,
  wl.notes,
  wl.logged_at,
  wl.sets,
  wl.log_meta,
  wl.format_type,
  wl.weight_logged,
  wl.gym_id,
  wl.workout_section_id,
  wl.wod_name_snapshot,
  wl.format_snapshot,
  wl.format_config_snapshot,
  wl.benchmark_id,
  case when wl.workout_section_id is not null then wl.wod_name_snapshot else coalesce(w.name, wl.wod_name_snapshot) end as effective_wod_name,
  case when wl.workout_section_id is not null then wl.format_snapshot else coalesce(w.type, wl.format_snapshot) end as effective_format,
  case when wl.workout_section_id is not null then wl.format_config_snapshot else coalesce(w.format_config, wl.format_config_snapshot) end as effective_format_config,
  wl.wod_id is null and wl.wod_name_snapshot is not null as workout_deleted
from public.wod_logs wl
left join public.wods w on w.id = wl.wod_id;
