-- Workout Engine V2, Faza 8 - Logarea antrenamentelor incepe sa REFERENTIEZE
-- Workout Sections, fara sa schimbe deloc sursa de adevar existenta.
-- `wod_id` (wod_logs) / `wod_id`+`slot` (skill_logs) raman NEATINSE - Jurnalul,
-- Clasamentul si editarea unui log existent continua sa citeasca exact ca
-- inainte, prin join-ul catre `wods`. Coloana noua e STRICT aditiva: nullable,
-- populata doar la loguri NOI (vezi App.jsx saveWodLog/saveSkillLog), niciun
-- backfill pe loguri istorice (n-ar avea sens - loguri vechi n-au fost logate
-- "impotriva" unei sectiuni anume, ar fi o legatura inventata retroactiv).
--
-- De ce e sigur sa referentiem workout_sections.id direct: Faza 5B a facut
-- exact ID-urile astea stabile (upsert pe (workout_id, slot_key), nu
-- delete+insert) - o editare normala a WOD-ului din admin NU schimba id-ul
-- sectiunii primare/skill/skill2 existente. `on delete set null` (nu cascade)
-- - daca o sectiune chiar dispare (WOD sters complet, sau slot_key-ul nu mai
-- apare la o re-salvare), logurile deja existente raman intacte, doar leaga-
-- tura catre acea sectiune se sterge - "nicio data istorica pierduta".

alter table wod_logs add column if not exists workout_section_id uuid references workout_sections(id) on delete set null;
alter table skill_logs add column if not exists workout_section_id uuid references workout_sections(id) on delete set null;

create index if not exists wod_logs_workout_section_id_idx on wod_logs (workout_section_id) where workout_section_id is not null;
create index if not exists skill_logs_workout_section_id_idx on skill_logs (workout_section_id) where workout_section_id is not null;
