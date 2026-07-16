-- Workout Engine V2, Faza 0 (vezi discutia de arhitectura din aceeasi sesiune
-- - Workout devine un container usor, toata programarea reala se muta in
-- Workout Sections, care nu exista inca). Faza 0 introduce DOAR cele doua
-- tabele lookup de care Sections va avea nevoie (tip de sectiune, nivel de
-- scalare) - fara Workout, fara Sections, fara nicio schimbare de UI/editor,
-- fara migrare de date. Nimic din aplicatie citeste inca din aceste doua
-- tabele - sunt create si populate, dar complet neconectate la orice flux
-- existent. Zero risc comportamental, usor de revenit (drop table) daca e
-- nevoie.
--
-- De ce lookup table si nu enum/text liber (decizie explicita din discutia
-- de arhitectura): un enum Postgres cere o migratie pt fiecare tip nou; text
-- liber n-are validare/traduceri/iconite/ordine. Un tabel lookup cu gym_id
-- NULLABLE da exact ce trebuia: platforma seteaza un set implicit (gym_id
-- null), fiecare sala isi poate adauga propriile tipuri (gym_id = sala ei),
-- fara nicio migratie viitoare pt un tip nou.

-- ============================================================
-- 1. workout_section_types
-- ============================================================

create table workout_section_types (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references gyms(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  icon text,
  color text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unicitate SEPARATA pe cele doua "scop-uri" (platforma vs sala), nu una
-- singura - un UNIQUE(gym_id, key) simplu NU ar prinde doua randuri
-- platforma-implicite cu aceeasi cheie (gym_id null), fiindca Postgres
-- trateaza NULL <> NULL in constrangeri UNIQUE (fiecare NULL e distinct de
-- oricare alt NULL). Indexul partial de mai jos acopera exact cazul
-- gym_id IS NULL, separat de UNIQUE-ul obisnuit pt randurile cu gym_id setat.
create unique index workout_section_types_platform_key_uidx
  on workout_section_types (key) where gym_id is null;
create unique index workout_section_types_gym_key_uidx
  on workout_section_types (gym_id, key) where gym_id is not null;

-- O sala isi poate adauga propriile tipuri, dar NU poate re-folosi cheia
-- unui tip implicit de platforma (ar fi confuz - doi randuri diferite cu
-- aceeasi cheie "strength", unul global unul al salii). Verificare la nivel
-- de cod (editorul viitor), nu impusa aici printr-un trigger - o constrangere
-- cross-scope (verifica impotriva TUTUROR randurilor cu gym_id null) nu se
-- poate exprima declarativ printr-un index, ar cere un trigger separat;
-- amanat pana exista un consumator real (Faza 5A/5B), nu o nevoie azi.

alter table workout_section_types enable row level security;

-- SELECT: oricine autentificat vede tipurile implicite de platforma
-- (gym_id null) PLUS tipurile custom ale propriei sale sali - niciodata
-- tipurile custom ale altei sali. Date pur structurale (nume/iconita/
-- culoare), nu date sensibile de membri - deschis la READ pt orice rol din
-- sala (nu doar admin/coach), la fel ca formatele de WOD azi.
create policy workout_section_types_select on workout_section_types
  for select to authenticated
  using (gym_id is null or gym_id = my_gym_id());

-- INSERT/UPDATE/DELETE: acelasi tipar ca wods_admin_* (is_coach_or_admin pe
-- gym_id-ul RANDULUI, nu pe my_gym_id() separat - is_coach_or_admin(gid) deja
-- verifica implicit ca utilizatorul apartine de gid). Randurile de platforma
-- (gym_id null) raman gestionate DOAR de platform admin - o sala nu poate
-- crea/edita/sterge un tip implicit de platforma, doar pe ale ei proprii.
create policy workout_section_types_insert on workout_section_types
  for insert to authenticated
  with check (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );
create policy workout_section_types_update on workout_section_types
  for update to authenticated
  using (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  )
  with check (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );
create policy workout_section_types_delete on workout_section_types
  for delete to authenticated
  using (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );

-- Acelasi trigger folosit deja pe toate tabelele multi-tenant (vezi
-- 20260714130000_multitenant_rls_rewrite.sql) - un rand nu-si schimba
-- niciodata sala dupa creare. Aici gym_id nici macar nu ar trebui sa
-- tranziteze intre null si o valoare - un tip de platforma nu devine
-- niciodata un tip de sala si invers.
create trigger prevent_gym_id_change_trg before update on workout_section_types
  for each row execute function prevent_gym_id_change();

-- Seed - tipurile implicite de platforma (gym_id null), disponibile
-- automat pt orice sala, fara nicio actiune din partea lor. sort_order in
-- pasi de 10, ca sa poata fi inserate tipuri noi intre ele mai tarziu fara
-- renumerotare.
insert into workout_section_types (gym_id, key, label, sort_order) values
  (null, 'warmup',       'Warm-up',      10),
  (null, 'strength',     'Strength',     20),
  (null, 'skill',        'Skill',        30),
  (null, 'weightlifting','Weightlifting',40),
  (null, 'gymnastics',   'Gymnastics',   50),
  (null, 'metcon',       'Metcon',       60),
  (null, 'accessory',    'Accessory',    70),
  (null, 'conditioning', 'Conditioning', 80),
  (null, 'mobility',     'Mobility',     90),
  (null, 'recovery',     'Recovery',     100),
  (null, 'cooldown',     'Cooldown',     110),
  (null, 'coach_notes',  'Coach Notes',  120);

-- ============================================================
-- 2. workout_scaling_levels
-- ============================================================

create table workout_scaling_levels (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references gyms(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workout_scaling_levels_platform_key_uidx
  on workout_scaling_levels (key) where gym_id is null;
create unique index workout_scaling_levels_gym_key_uidx
  on workout_scaling_levels (gym_id, key) where gym_id is not null;

alter table workout_scaling_levels enable row level security;

create policy workout_scaling_levels_select on workout_scaling_levels
  for select to authenticated
  using (gym_id is null or gym_id = my_gym_id());

create policy workout_scaling_levels_insert on workout_scaling_levels
  for insert to authenticated
  with check (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );
create policy workout_scaling_levels_update on workout_scaling_levels
  for update to authenticated
  using (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  )
  with check (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );
create policy workout_scaling_levels_delete on workout_scaling_levels
  for delete to authenticated
  using (
    (gym_id is not null and is_coach_or_admin(gym_id))
    or (gym_id is null and is_platform_admin())
  );

create trigger prevent_gym_id_change_trg before update on workout_scaling_levels
  for each row execute function prevent_gym_id_change();

insert into workout_scaling_levels (gym_id, key, label, sort_order) values
  (null, 'rx',           'RX',           10),
  (null, 'intermediate', 'Intermediate', 20),
  (null, 'beginner',     'Beginner',     30),
  (null, 'on_ramp',      'On Ramp',      40);
