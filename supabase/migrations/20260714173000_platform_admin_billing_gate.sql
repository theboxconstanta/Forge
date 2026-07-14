-- Nivel nou, deasupra sala/admin de sala: "platform admin" (doar Lucian, ca
-- proprietar al SaaS-ului) - genereaza coduri de inregistrare pt sali noi
-- (date manual clientilor care platesc) si poate activa/dezactiva orice
-- sala (blocare acces la neplata recurenta - manual acum, nu e integrare
-- reala de plati, care ramane etapa ulterioara separata).

create table platform_admins (
  id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
create policy platform_admins_select_own on platform_admins
  for select to authenticated using (id = auth.uid());

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where id = auth.uid());
$$;

-- Coduri de inregistrare sala noua - fara nicio politica publica (RLS
-- activat, zero politici = inchis complet pt orice rol, accesibil doar prin
-- functiile SECURITY DEFINER de mai jos). reserved_by e cheia intregii
-- garantii de securitate: politica gyms_bootstrap_insert (mai jos) cere ca
-- utilizatorul curent sa aiba deja un cod REZERVAT si nefolosit - fara asta,
-- oricine autentificat (doar cu signUp email+parola, fara sa stie vreun cod)
-- ar putea crea o sala noua ocolind complet UI-ul, apeland direct insert()
-- pe `gyms`.
create table gym_signup_codes (
  code text primary key,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reserved_by uuid references auth.users(id),
  reserved_at timestamptz,
  used_at timestamptz,
  used_by_gym_id uuid references gyms(id)
);
alter table gym_signup_codes enable row level security;

create or replace function generate_gym_signup_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
  into v_code
  from generate_series(1, 8);
  insert into gym_signup_codes (code, created_by) values (v_code, auth.uid());
  return v_code;
end;
$$;

create or replace function list_gym_signup_codes()
returns table(code text, created_at timestamptz, used_at timestamptz, used_by_gym_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.code, c.created_at, c.used_at, g.name
  from gym_signup_codes c
  left join gyms g on g.id = c.used_by_gym_id
  where is_platform_admin()
  order by c.created_at desc;
$$;

-- Verificare UX (mesaj clar in UI inainte de signUp), nu e ea insasi poarta
-- de securitate reala - aia e reserve_gym_signup_code() + politica RLS.
create or replace function verify_gym_signup_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from gym_signup_codes where code = upper(p_code) and used_at is null);
$$;

-- Rezervare cod pt utilizatorul curent (autentificat, imediat dupa signUp) -
-- idempotenta pt acelasi utilizator (poate re-incerca daca pasul urmator,
-- crearea salii, esueaza din alt motiv).
create or replace function reserve_gym_signup_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update gym_signup_codes
  set reserved_by = auth.uid(), reserved_at = now()
  where code = upper(p_code) and used_at is null and (reserved_by is null or reserved_by = auth.uid());
  return found;
end;
$$;

create or replace function consume_my_reserved_gym_signup_code(p_gym_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update gym_signup_codes
  set used_at = now(), used_by_gym_id = p_gym_id
  where reserved_by = auth.uid() and used_at is null;
  return found;
end;
$$;

-- Panou platform admin: toate salile, cu email owner si numar de membri.
create or replace function list_all_gyms_platform()
returns table(id uuid, name text, is_active boolean, created_at timestamptz, owner_email text, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.is_active, g.created_at, u.email,
    (select count(*) from profiles p where p.gym_id = g.id)
  from gyms g
  left join auth.users u on u.id = g.owner_id
  where is_platform_admin()
  order by g.created_at desc;
$$;

create or replace function set_gym_active_status(p_gym_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update gyms set is_active = p_active where id = p_gym_id;
end;
$$;

grant execute on function generate_gym_signup_code() to authenticated;
grant execute on function list_gym_signup_codes() to authenticated;
grant execute on function verify_gym_signup_code(text) to anon, authenticated;
grant execute on function reserve_gym_signup_code(text) to authenticated;
grant execute on function consume_my_reserved_gym_signup_code(uuid) to authenticated;
grant execute on function list_all_gyms_platform() to authenticated;
grant execute on function set_gym_active_status(uuid, boolean) to authenticated;

-- Poarta reala de securitate pt crearea unei sali noi: trebuie sa existe un
-- cod REZERVAT (nu doar "valid undeva in tabel") de utilizatorul curent.
drop policy gyms_bootstrap_insert on gyms;
create policy gyms_bootstrap_insert on gyms
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from gym_signup_codes where reserved_by = auth.uid() and used_at is null)
  );

-- Lucian e primul (si singurul, azi) platform admin.
insert into platform_admins (id) values ('97a4e88a-1b51-41f7-ab54-2a5061912daa');
