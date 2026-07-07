-- Coloanele de greutate per varianta adaugate acum cateva minute
-- (20260707083703_wods_variant_weight.sql) erau un singur camp text (ex.
-- "61/43kg") - imposibil de comparat corect cu greutatea logata de un membru
-- individual (un barbat loga "61kg", o femeie "43kg", niciuna nu egaleaza
-- blob-ul combinat). Nicio greutate nu fusese inca salvata pe nicio coloana
-- (verificat live) - inlocuim direct cu cate un camp per gen, fara migratie
-- de date.
alter table wods drop column if exists rx_weight;
alter table wods drop column if exists intermediate_weight;
alter table wods drop column if exists beginner_weight;
alter table wods drop column if exists onramp_weight;

alter table wods add column if not exists rx_weight_male text;
alter table wods add column if not exists rx_weight_female text;
alter table wods add column if not exists intermediate_weight_male text;
alter table wods add column if not exists intermediate_weight_female text;
alter table wods add column if not exists beginner_weight_male text;
alter table wods add column if not exists beginner_weight_female text;
alter table wods add column if not exists onramp_weight_male text;
alter table wods add column if not exists onramp_weight_female text;
