-- Notita coach-ului nu e comuna pentru tot WOD-ul, ci independenta per
-- varianta (RX/Intermediate/Beginner/OnRamp) - un "wear a vest" poate fi
-- relevant doar la RX, nu si la OnRamp. Coloana unica `notes` (adaugata in
-- migratia anterioara) nu a avut niciodata date reale (feature abia adaugat,
-- testat doar pe WOD-uri de test sterse imediat) - inlocuita direct, fara
-- migrare de date.
alter table wods drop column if exists notes;
alter table wods add column if not exists notes_onramp text;
alter table wods add column if not exists notes_beginner text;
alter table wods add column if not exists notes_intermediate text;
alter table wods add column if not exists notes_rx text;
