-- MOVEMENT LIBRARY - Bar Hang / Static Bar Hang. Owner-reported gap: both
-- movements were missing from the catalog entirely (verified against the
-- live 465-row catalog immediately before writing this migration - zero
-- name/alias collisions for either). Owner decision: both added as
-- separate entries, NOT an alias of one another.
--
-- Both are isometric grip/scapular holds, same capability shape as the
-- existing Handstand Hold / L-sit Hold / Ring Support Hold rows:
-- allowed_prescription_metrics = {} / default_prescription_metric = NULL.
-- Seconds-based performance is NOT represented through the prescription
-- engine (its CHECK domain is reps/load/distance/calories only, and stays
-- untouched by this migration) - it is handled entirely by the existing
-- frontend isHold mechanism (App.jsx PR logging), exactly as it already is
-- for Handstand Hold and L-sit Hold.
--
-- category/movement_pattern modeled on the closest real sibling queried
-- live immediately before writing this file: Handstand Hold
-- (category='gymnastics', equipment=null, movement_pattern='core').
--
-- Idempotent (INSERT ... WHERE NOT EXISTS), additive only - no existing
-- row touched, no id changed, no historical workout affected.

insert into movements (gym_id, name, aliases, equipment, category, movement_pattern, allowed_prescription_metrics, default_prescription_metric, created_by)
select null, v.name, v.aliases, v.equipment, v.category, v.movement_pattern, v.allowed_prescription_metrics, v.default_prescription_metric, null
from (values
  ('Bar Hang',        ARRAY[]::text[], null::text, 'gymnastics', 'core', ARRAY[]::text[], null::text),
  ('Static Bar Hang',  ARRAY[]::text[], null::text, 'gymnastics', 'core', ARRAY[]::text[], null::text)
) as v(name, aliases, equipment, category, movement_pattern, allowed_prescription_metrics, default_prescription_metric)
where not exists (select 1 from movements m where lower(m.name) = lower(v.name));
