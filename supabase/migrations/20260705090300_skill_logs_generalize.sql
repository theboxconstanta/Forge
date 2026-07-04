-- skill_logs.sets era documentat ca fiind doar pentru Weightlifting - de acum
-- se foloseste pentru orice format skill din familia 'sets' (EMOM, Tabata,
-- Strength Sets etc), la fel ca la WOD principal. Nicio schimbare de schema
-- necesara pe `sets` (e deja jsonb generic); adaugam doar log_meta pentru
-- consistenta cu wod_logs.log_meta.
alter table skill_logs add column if not exists log_meta jsonb;
