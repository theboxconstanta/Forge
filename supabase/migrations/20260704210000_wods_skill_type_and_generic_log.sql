-- Tip de Skill Work ales explicit de admin (mirror pentru wods.type). Determina
-- daca membrul logheaza seturi de greutate (cu detectare de PR) sau doar un
-- rezultat generic (EMOM/Tabata/Cardio/Other), care merge direct in Jurnal.
alter table wods add column if not exists skill_type text not null default 'Weightlifting';

-- Rezultat liber pentru Skill Work non-Weightlifting, analog cu wod_logs.result,
-- independent de sets (folosit doar la Weightlifting).
alter table skill_logs add column if not exists result text;
