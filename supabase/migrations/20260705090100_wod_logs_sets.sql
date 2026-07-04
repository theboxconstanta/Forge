-- Log de tip "sets" (reps+greutate per interval/runda/set) pentru WOD-ul
-- principal, analog skill_logs.sets, folosit de formatele family:'sets' din
-- catalog (EMOM, Tabata, Intervals, Death By, Strength Sets, Build to Heavy,
-- Complex, Superset) si de partea "sets" a Buy-In/Cash-Out (family:'mixed').
-- Coexista cu result/time_result existente (folosite de family:'scored').
alter table wod_logs add column if not exists sets jsonb;

-- Metadate mici, needitabile prin parsare de text (ex. nume partener la
-- Partner WOD, scoreMode folosit la salvare) - util la afisare/editare fara
-- sa re-parsam header-ul text din notes.
alter table wod_logs add column if not exists log_meta jsonb;
