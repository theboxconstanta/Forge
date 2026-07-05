-- Suport pentru SKILL 2: fiecare membru poate avea acum pana la 2 loguri
-- per WOD (slot 1 = SKILL, slot 2 = SKILL 2), nu doar unul. Backfill cu
-- slot=1 pentru toate logurile existente (erau toate pentru primul/singurul
-- bloc de Skill Work de pana acum).
alter table skill_logs add column if not exists slot smallint not null default 1;

alter table skill_logs drop constraint if exists skill_logs_member_id_wod_id_key;
alter table skill_logs add constraint skill_logs_member_id_wod_id_slot_key unique (member_id, wod_id, slot);
