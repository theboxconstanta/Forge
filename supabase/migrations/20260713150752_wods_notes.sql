-- Notita libera a coach-ului pentru WOD-ul zilei (ex. "Wear a vest if you
-- can") - un singur camp, valabil pentru toate variantele (nu per
-- RX/Intermediate/Beginner/OnRamp, spre deosebire de miscari/greutate), afisat
-- distinct fata de lista de miscari pe ecranul principal.
alter table wods add column if not exists notes text;
