-- Inlocuieste switch-ul combinat warmup_skill_visible cu 3 comutatoare
-- independente - coach-ul poate ascunde doar WARM-UP, doar SKILL, sau doar
-- SKILL 2, fara sa afecteze celelalte. warmup_skill_visible nu era folosit
-- de niciun WOD real (verificat inainte de migratie), deci nu se pierde
-- nicio stare.
alter table wods add column if not exists warmup_visible boolean not null default true;
alter table wods add column if not exists skill_visible boolean not null default true;
alter table wods add column if not exists skill2_visible boolean not null default true;
