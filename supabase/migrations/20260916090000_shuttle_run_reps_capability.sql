-- MULTI-PART SCORING / SHUTTLE RUN - the movement capability model already
-- supports multi-metric arrays live in production (Row/Ski/Bike carry
-- ["distance","calories"]); Shuttle Run's own catalog row was seeded with
-- ["distance"] only, which is the sole reason the Composer's already-generic
-- authoring layer (MovementRowPWA, App.jsx) never offers a Reps option for
-- it - a pure data gap, not a code limitation (forensic audit, this session).
--
-- Narrow, idempotent, movement-specific: touches ONLY the "Shuttle Run" row
-- (by exact name), never "Shuttle Sprint" or any other movement. default_
-- prescription_metric stays "distance" (existing prescriptions like "75 m
-- Shuttle Run" must keep rendering/authoring exactly as before) - "reps" is
-- added as an additional, explicitly-selectable capability only.
update movements
set allowed_prescription_metrics = array(
  select distinct unnest(allowed_prescription_metrics || array['reps']::text[])
)
where name = 'Shuttle Run'
  and not ('reps' = any(allowed_prescription_metrics));
