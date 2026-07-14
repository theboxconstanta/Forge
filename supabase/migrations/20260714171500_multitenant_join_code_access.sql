-- Cod de acces per sala pt inregistrarea membrilor - adminul genereaza/vede
-- codul propriei sali (Admin > Setari) si il da mai departe membrilor reali;
-- fara cod corect, nimeni nu se poate inregistra ca membru al acelei sali.
--
-- Gaura reala gasita acum: RLS e control la nivel de RAND, nu de COLOANA -
-- politica gyms_select_public (Faza 3) lasa orice cerere directa catre API
-- sa citeasca `join_code`/`owner_id` pt orice sala activa, indiferent ce
-- coloane cere efectiv UI-ul. Fara restrictie explicita de coloane, codul
-- n-ar fi fost niciodata cu adevarat secret.

-- Blocheaza SELECT implicit pe toate coloanele, apoi il redeschide explicit
-- doar pe cele sigure de expus public (fara join_code - singura coloana
-- care chiar trebuie sa ramana secreta). owner_id ramane in lista permisa
-- (nu e ce vrem sa ascundem) - politica admins_bootstrap_own_gym citeste
-- owner_id in propriul EXISTS, cu privilegiile rolului apelant, deci trebuie
-- sa ramana selectabil pt authenticated ca acea politica sa functioneze.
revoke select on gyms from anon, authenticated;
grant select (id, name, owner_id, primary_color, is_active, created_at) on gyms to anon, authenticated;

-- Citire cod propriu (doar admin, doar sala lui).
create or replace function get_my_gym_join_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select join_code from gyms where id = my_gym_id() and is_admin(my_gym_id());
$$;

-- Regenerare cod (doar admin, doar sala lui) - acelasi format ca la creare
-- (6 caractere, fara 0/O/1/I ambigue vizual).
create or replace function regenerate_my_gym_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid := my_gym_id();
  v_new_code text;
begin
  if v_gym_id is null or not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
  into v_new_code
  from generate_series(1, 6);
  update gyms set join_code = v_new_code where id = v_gym_id;
  return v_new_code;
end;
$$;

grant execute on function get_my_gym_join_code() to authenticated;
grant execute on function regenerate_my_gym_join_code() to authenticated;

-- Verificare cod INAINTE de signUp() - da un mesaj clar de eroare in UI
-- ("cod invalid") in loc sa lasam clientul sa afle abia dupa un 500 opac de
-- la GoTrue (exact problema gasita azi la fluxul de owner - eroarea din
-- trigger nu ajunge niciodata clara la client). Verificarea reala/obligatorie
-- ramane in handle_new_user() (mai sus) - asta e doar UX, nu poate fi
-- ocolita in mod periculos (nu returneaza/expune codul, doar true/false).
create or replace function verify_gym_join_code(p_gym_id uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from gyms where id = p_gym_id and upper(join_code) = upper(p_code) and is_active = true
  );
$$;

grant execute on function verify_gym_join_code(uuid, text) to anon, authenticated;

-- handle_new_user(): fluxul de membru trimite acum codul (gym_join_code),
-- nu gym_id direct - un client care ar ocoli UI-ul si ar apela signUp() cu
-- un gym_id "ghicit" din cautarea publica (care nu mai expune codul, dar
-- expune id-ul si numele) nu mai poate intra fara sa stie si codul real.
-- Cod gresit -> exceptie -> signUp() esueaza curat, nu se creeaza cont
-- "orfan" fara sala. Fluxul de owner ramane neschimbat (fara gym_join_code
-- in metadata -> gym_id ramane null, revendicat separat dupa ce sala exista).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_gym_id uuid;
  v_code text := new.raw_user_meta_data->>'gym_join_code';
begin
  if v_code is not null and v_code <> '' then
    select id into v_gym_id from gyms where upper(join_code) = upper(v_code) and is_active = true;
    if v_gym_id is null then
      raise exception 'invalid gym join code';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, gym_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    v_gym_id
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name);
  return new;
end;
$function$;
