-- Cardio PRs (Row, Bike Erg, Assault Bike, Air Bike, Ski Erg, Run) could
-- already log a time in the UI, but it was silently discarded — only the
-- distance/calorie value was persisted. Adds a time_result column (same
-- text format as wod_logs.time_result, e.g. "3:52") so it's saved and shown
-- next to the distance/calorie value in the PR-uri screen (src/App.jsx).

ALTER TABLE personal_records ADD COLUMN IF NOT EXISTS time_result text;
