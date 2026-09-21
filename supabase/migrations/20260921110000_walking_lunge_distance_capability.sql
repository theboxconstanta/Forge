-- WALKING LUNGE DISTANCE SUPPORT - the movement capability model already
-- supports distance generically (METRIC_KEYS, prescriptionContract.js) -
-- Row/Ski/Bike/Run/Shuttle Run already prove the whole authoring/logging/
-- scoring path is metric-driven, never movement-name-hardcoded. "Walking
-- Lunge" catalog row was seeded with ["reps"] only, which is the sole
-- reason Composer never offered a Distance option for it ("100 m Walking
-- Lunges") - a pure data gap, not a code limitation (forensic + owner
-- approval, this session). Mirrors 20260916090000_shuttle_run_reps_
-- capability.sql exactly, in the opposite direction (adding distance to a
-- reps-only row instead of reps to a distance-only row).
--
-- Narrow, idempotent, exact-name-scoped: touches ONLY the "Walking Lunge"
-- row, never "Dumbbell Walking Lunge" or "Overhead Walking Lunge" (both
-- deliberately separate catalog rows - prescriptionContract.js explicitly
-- never merges the ~29 equipment-variant duplicates). default_
-- prescription_metric stays "reps" - every existing "20 Walking Lunges"
-- prescription keeps authoring/rendering/scoring exactly as before;
-- "distance" is added as an additional, explicitly-selectable capability
-- only. No change to aliases, CARDIO_MISCARI, Composer code, scoring
-- code, or any historical prescription_snapshot/performed_prescription
-- (those resolve from their own frozen snapshot, never the live catalog).
update movements
set allowed_prescription_metrics = array(
  select distinct unnest(allowed_prescription_metrics || array['distance']::text[])
)
where name = 'Walking Lunge'
  and not ('distance' = any(allowed_prescription_metrics));
