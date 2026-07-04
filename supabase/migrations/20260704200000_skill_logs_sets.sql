-- Seturi individuale per miscare la Skill Work (ex: Snatch - Set 1: 40kg,
-- Set 2: 50kg, Set 3: 60kg), separat de nota generala existenta.
-- Structura: { "<text miscare din wods.skill>": ["40", "50", "60"], ... }
alter table skill_logs add column if not exists sets jsonb;
