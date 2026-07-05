-- Switch admin/coach pentru a ascunde/arata pe ecranul Acasa al membrilor
-- sectiunile WARM-UP si SKILL (impreuna, un singur comutator) - unele zile
-- nu au nevoie de ele afisate, chiar daca sunt completate in formular.
-- Implicit true (comportament neschimbat pt WOD-urile existente).
alter table wods add column if not exists warmup_skill_visible boolean not null default true;
