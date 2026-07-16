-- Workout Engine V2, Faza 1 (vezi discutia de arhitectura din aceeasi
-- sesiune - Workout devine un container usor, toata programarea reala se
-- muta in Workout Sections). STRICT structural - fara migrare de date, fara
-- schimbare de UI/editor/Member View/parser AI/logging, fara stergere de
-- tabele existente. `wods`/`wod_logs` raman complet neatinse si continua sa
-- fie singura sursa de adevar folosita de aplicatie - tabelele noi de aici
-- exista, dar NIMIC nu le citeste inca.

-- ============================================================
-- 1. workouts - container usor (fara format/config/movements/scoreType,
--    toate astea se muta in workout_sections mai jos)
-- ============================================================

create table workouts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id) on delete cascade,
  date date not null,
  title text,
  notes text,
  tags text[] not null default '{}',
  is_published boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, date)
);

create index workouts_gym_date_idx on workouts (gym_id, date);

alter table workouts enable row level security;

-- SELECT: intreaga sala vede WOD-urile publicate; ciorna (is_published =
-- false) e vizibila doar pt coach/admin - camp nou, fara echivalent in
-- `wods` azi (acolo orice rand creat e implicit "live"), dar odata ce exista
-- campul, comportamentul lui natural de vizibilitate merita implementat
-- direct, nu lasat pe jumatate. Nu schimba nimic pt aplicatia EXISTENTA -
-- niciun ecran de azi nu citeste din acest tabel.
create policy workouts_select on workouts
  for select to authenticated
  using (gym_id = my_gym_id() and (is_published or is_coach_or_admin(gym_id)));

create policy workouts_insert on workouts
  for insert to authenticated
  with check (is_coach_or_admin(gym_id));

create policy workouts_update on workouts
  for update to authenticated
  using (is_coach_or_admin(gym_id))
  with check (is_coach_or_admin(gym_id));

create policy workouts_delete on workouts
  for delete to authenticated
  using (is_coach_or_admin(gym_id));

create trigger prevent_gym_id_change_trg before update on workouts
  for each row execute function prevent_gym_id_change();

-- ============================================================
-- 2. workout_sections - unitatea programabila independenta
-- ============================================================

create table workout_sections (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id) on delete cascade,
  -- gym_id denormalizat direct pe rand (nu doar via workout_id) - acelasi
  -- tipar ca wod_logs.gym_id fata de wod_logs.wod_id azi: politicile RLS
  -- din tot proiectul verifica mereu o coloana gym_id DIRECT pe rand, nu
  -- printr-un join, pt simplitate si consistenta cu is_admin()/
  -- is_coach_or_admin() (care primesc un gid direct, nu fac ele insele
  -- join-ul). Trigger-ul de mai jos garanteaza ca nu poate diverge fata de
  -- gym_id-ul real al lui workout_id.
  gym_id uuid not null references gyms(id) on delete cascade,
  section_type_id uuid not null references workout_section_types(id) on delete restrict,
  order_index integer not null default 0,
  title text,
  description text,
  -- Formatul e text liber (nume din catalogul WORKOUT_FORMATS, ex. "AMRAP",
  -- "Strength Sets") - la fel ca `wods.type` azi, fara CHECK/FK, fiindca
  -- WORKOUT_FORMATS e azi doar un catalog JS (src/workoutFormats.js), fara
  -- tabel DB corespondent.
  format text,
  -- Numele "format_config" (nu doar "config") copiaza exact convenția deja
  -- folosita pe wods.format_config - aceeasi forma de date (jsonb specific
  -- formatului), doar mutata la nivel de sectiune.
  format_config jsonb not null default '{}'::jsonb,
  -- Miscari + variante de scalare - JSON STRUCTURAT deocamdata (decizie
  -- explicita: Movement Catalog normalizat e amanat ca migratie separata,
  -- dupa ce Workout Engine V2 e stabil - vezi discutia de arhitectura).
  -- Forma jsonb e identica cu DetectedMovement/scalingVersions din
  -- schema AI deja construita (supabase/functions/analyze-workout/
  -- openaiSchema.ts, transform.ts) - "canonicalName" ramane text simplu,
  -- nu FK, exact ca sa nu fie nevoie de o a doua migratie cand Movement
  -- Catalog chiar se construieste (doar se adauga movement_id rezolvat din
  -- canonicalName, nu se rescrie forma).
  movements jsonb not null default '[]'::jsonb,
  scaling_versions jsonb not null default '[]'::jsonb,
  logging_mode text not null default 'none'
    check (logging_mode in ('none', 'optional', 'required')),
  -- La fel ca "format", scoreType ramane text liber (Time/Rounds + Reps/
  -- Weight/etc, acelasi vocabular ca SCORE_TYPE_VALUES din schema AI) -
  -- fara CHECK, ca sa nu fie nevoie de migratie la fiecare valoare noua.
  score_type text,
  duration_minutes integer,
  -- Metadate distincte, decizie explicita din discutia de arhitectura:
  -- benchmark_metadata = "acest WOD e Fran/Murph/etc" (nume, e hero, etc);
  -- metadata = insight-uri de coaching (dificultate, sisteme energetice,
  -- muschi, indicii) - acelasi shape ca classification+guidance din schema
  -- AI. NU contine incredere/provenienta AI (confidence, model, timestamp
  -- parsare) - aceea ramane STRICT in timpul editarii, niciodata persistata
  -- (decizie explicita: odata ce coach-ul salveaza, WOD-ul devine "al lui",
  -- nu mai poarta semne ca a trecut prin AI).
  benchmark_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_sections_workout_order_idx on workout_sections (workout_id, order_index);
create index workout_sections_gym_id_idx on workout_sections (gym_id);
create index workout_sections_section_type_id_idx on workout_sections (section_type_id);

-- Integritate: gym_id de pe rand trebuie sa coincida mereu cu gym_id-ul
-- adevarat al lui workout_id - fara asta, un rand ar putea pretinde un
-- gym_id fals (ocolind granita multi-tenant) in timp ce workout_id chiar
-- arata spre alta sala. SECURITY DEFINER + search_path fixat - aceeasi
-- masura de precautie ca toate functiile helper RLS din proiect (vezi
-- 20260714130000_multitenant_rls_rewrite.sql), desi aici nu exista risc de
-- recursie (workouts nu foloseste workout_sections in propriile politici).
create or replace function enforce_workout_section_gym_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gym_id is distinct from (select gym_id from workouts where id = new.workout_id) then
    raise exception 'workout_sections.gym_id must match the parent workout''s gym_id';
  end if;
  return new;
end;
$$;

create trigger enforce_workout_section_gym_id_trg
  before insert or update on workout_sections
  for each row execute function enforce_workout_section_gym_id();

create trigger prevent_gym_id_change_trg before update on workout_sections
  for each row execute function prevent_gym_id_change();

alter table workout_sections enable row level security;

-- SELECT: la fel ca workouts_select, dar verificat prin parintele workout -
-- o sectiune nu poate fi vizibila independent de starea de publicare a
-- WOD-ului ei. is_coach_or_admin vede intotdeauna totul (inclusiv ciorne).
create policy workout_sections_select on workout_sections
  for select to authenticated
  using (
    gym_id = my_gym_id()
    and (
      is_coach_or_admin(gym_id)
      or exists (select 1 from workouts w where w.id = workout_sections.workout_id and w.is_published)
    )
  );

create policy workout_sections_insert on workout_sections
  for insert to authenticated
  with check (is_coach_or_admin(gym_id));

create policy workout_sections_update on workout_sections
  for update to authenticated
  using (is_coach_or_admin(gym_id))
  with check (is_coach_or_admin(gym_id));

create policy workout_sections_delete on workout_sections
  for delete to authenticated
  using (is_coach_or_admin(gym_id));
