-- Blocare automata la nivel de sala pe baza de data de plata (fara Stripe
-- deocamdata) - fundatia care ramane valabila si dupa ce se adauga plata
-- reala mai tarziu: singurul lucru care se schimba atunci e CINE seteaza
-- paid_until (webhook Stripe in loc de admin manual), nu si mecanismul de
-- blocare in sine.
--
-- Nullable, FARA default la adaugare - salile existente (CrossFit C15,
-- CrossFit C15 Brasov, CrossFit Tester) raman cu paid_until = null, adica
-- "fara expirare urmarita", ca sa nu se blocheze nimeni retroactiv doar
-- pentru ca a aparut coloana. Abia dupa migratie fixam un DEFAULT pentru
-- INSERT-urile viitoare (sali noi, inregistrate public, primesc automat 30
-- de zile de proba de la inregistrare).
alter table gyms add column paid_until date;
alter table gyms alter column paid_until set default (current_date + 30);

drop function list_all_gyms_platform();
create function list_all_gyms_platform()
returns table(id uuid, name text, is_active boolean, created_at timestamptz, owner_email text, member_count bigint, paid_until date)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.is_active, g.created_at, u.email,
    (select count(*) from profiles p where p.gym_id = g.id),
    g.paid_until
  from gyms g
  left join auth.users u on u.id = g.owner_id
  where is_platform_admin()
  order by g.created_at desc;
$$;

-- Setarea unei date de plata e tratata ca semnal explicit "a platit" -
-- reactiveaza imediat sala daca noua data e in viitor, fara sa astepte
-- job-ul zilnic de mai jos. Nu dezactiveaza automat daca data e in trecut -
-- asta ramane treaba exclusiva a cron-ului, ca sa nu surprinda adminul cu
-- un efect secundar neasteptat la o simpla corectie de data.
create or replace function set_gym_paid_until(p_gym_id uuid, p_paid_until date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update gyms set paid_until = p_paid_until,
    is_active = case when p_paid_until >= current_date then true else is_active end
  where id = p_gym_id;
end;
$$;

grant execute on function set_gym_paid_until(uuid, date) to authenticated;

-- Job zilnic - blocheaza orice sala cu data de plata depasita. Nu
-- reactiveaza niciodata singur (doar set_gym_paid_until sau toggle-ul
-- manual din Platforma fac asta) - evita conflicte cu o dezactivare
-- manuala deliberata (ex. abuz) pe o sala care intamplator mai are
-- paid_until in viitor.
select cron.schedule(
  'gym-billing-block-daily',
  '0 8 * * *',
  $$ update gyms set is_active = false where paid_until is not null and paid_until < current_date and is_active = true; $$
);
