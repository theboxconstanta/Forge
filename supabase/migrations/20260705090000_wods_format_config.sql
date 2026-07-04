-- Config structurat pentru formatul principal al WOD-ului zilei (parametrii
-- specifici formatului din catalogul src/workoutFormats.js: interval EMOM,
-- runde/lucru/odihna Tabata, nr. seturi Strength Sets, complex de miscari etc).
-- wods.type ramane text (id-ul din catalog); format_config e null pentru
-- formatele simple care nu au parametri suplimentari fata de duration.
alter table wods add column if not exists format_config jsonb;

-- Config structurat analog, dar pentru Skill Work (skill_type poate fi orice
-- id din catalog, nu doar cele 5 de azi: Weightlifting/EMOM/Tabata/Cardio/Other).
alter table wods add column if not exists skill_format_config jsonb;
