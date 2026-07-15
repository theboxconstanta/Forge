-- Actualizarea aplicatiei trebuie sa fie aproape instanta, nu sa astepte
-- un poll periodic (vezi migratia anterioara de azi - membri reali ramasi
-- ore/zile pe bundle-uri vechi). In loc sa marim frecventa de verificare
-- (tot ar insemna minute intregi de intarziere in cel mai rau caz),
-- folosim canalul realtime pe care aplicatia il tine oricum deschis cat
-- timp e activa (acelasi mecanism ca la redenumirea salii) - la fiecare
-- deploy, randul e actualizat (manual, de pe masina de dezvoltare, cu
-- npx supabase, dupa fiecare push - nu exista inca un pas de CI automat
-- pt asta), iar toti clientii conectati primesc evenimentul in cateva
-- sute de milisecunde si forteaza o verificare de service worker imediat.
create table app_version (
  key text primary key,
  version text not null,
  updated_at timestamptz not null default now()
);
alter table app_version enable row level security;

-- Citire publica (inclusiv neautentificat - ecranul de login trebuie sa
-- poata si el sa se actualizeze) - fara nicio politica de scriere pt
-- anon/authenticated, randul se scrie doar din afara RLS (service role /
-- npx supabase db query, care ruleaza cu rol postgres).
create policy app_version_select_public on app_version
  for select to anon, authenticated
  using (true);

insert into app_version (key, version) values ('current', 'bootstrap');

alter publication supabase_realtime add table app_version;
