-- Faza 3 (partea a doua) din conversia la multi-tenant: infrastructura DB
-- pentru fluxurile noi de inregistrare (owner de sala noua / membru care se
-- alatura unei sali existente).

-- ============================================================
-- 1. RLS pe `gyms` - tabelul nou din Faza 1 nu avea RLS activat deloc pana
--    acum (gaura reala, gasita abia acum, nu semnalata explicit in planul
--    initial) - fara el, orice rol avea acces implicit nerestrictionat.
-- ============================================================

alter table gyms enable row level security;

-- Cautarea salii (dupa nume sau cod) trebuie sa functioneze INAINTE de
-- autentificare (clientul anonim, pe ecranul de inregistrare) - de-aia
-- explicit pt anon + authenticated, nu doar authenticated ca la restul
-- tabelelor. Doar salile active sunt vizibile.
create policy gyms_select_public on gyms
  for select to anon, authenticated
  using (is_active = true);

-- Bootstrap: un utilizator proaspat inregistrat poate crea O sala pt care
-- e proprietar (owner_id = el insusi) - nu poate crea o sala "pentru
-- altcineva". Nimic nu impune inca cel mult o sala per owner (owner_id nu e
-- unic) - acceptat ca lacuna minora de business-rule, nu de securitate:
-- fiecare sala creata ramane oricum izolata de celelalte prin gym_id.
create policy gyms_bootstrap_insert on gyms
  for insert to authenticated
  with check (owner_id = auth.uid());

-- Un admin isi poate actualiza propria sala (nume, culoare, activare).
create policy gyms_admin_update on gyms
  for update to authenticated
  using (is_admin(id))
  with check (is_admin(id));

-- ============================================================
-- 2. Politica de bootstrap pt `admins` - un owner proaspat isi poate crea
--    propriul rand de admin, DOAR pt sala pe care tocmai a creat-o (owner_id
--    = el). Separata de is_admin(gid) - ar fi circulara, nu e inca admin.
-- ============================================================

create policy admins_bootstrap_own_gym on admins
  for insert to authenticated
  with check (
    id = auth.uid()
    and exists (select 1 from gyms where id = gym_id and owner_id = auth.uid())
  );

-- ============================================================
-- 3. handle_new_user() citeste acum gym_id din metadata trimisa la
--    auth.signUp({ options: { data: { gym_id } } }) - la fel pt ambele
--    fluxuri (owner: id generat client-side, folosit apoi la insert-ul in
--    gyms; membru: id-ul salii gasite prin cautare). Fara metadata (apeluri
--    vechi/necunoscute), insert-ul esueaza acum cu NOT NULL violation - vezi
--    pasul 4, motivul exact.
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  insert into public.profiles (id, email, full_name, gym_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    (new.raw_user_meta_data->>'gym_id')::uuid
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name);
  return new;
end;
$function$;

-- ============================================================
-- 4. Elimina DEFAULT-ul temporar de pe gym_id (pus in Faza 1 ca sa nu se
--    strica insert-urile din App.jsx inainte sa fie actualizate explicit).
--    Faza 3 (partea intai) a adaugat deja gym_id explicit pe toate cele 27
--    de insert/upsert din App.jsx - DEFAULT-ul azi ar mai avea un singur
--    efect: sa ascunda tacit orice loc uitat, alocand gresit unei
--    inregistrari noi in "sala DEFAULT" (CrossFit C15) in loc sa esueze
--    vizibil. Odata ce exista mai mult de o sala reala, o alocare gresita
--    tacita ar fi mult mai grava decat un insert care pica cu eroare clara.
-- ============================================================

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'admins', 'coaches', 'classes', 'wods', 'subscription_plans',
    'bookings', 'wod_logs', 'personal_records', 'skill_logs', 'class_waitlist',
    'class_reminders', 'push_subscriptions', 'subscriptions', 'feed_posts',
    'feed_comments', 'feed_reactions', 'custom_hero_wods', 'app_settings'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I alter column gym_id drop default', t);
  end loop;
end $$;
