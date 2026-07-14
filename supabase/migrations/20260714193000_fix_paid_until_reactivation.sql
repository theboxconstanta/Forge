-- Bug gasit la auto-revizuire (07-14), inainte de prima utilizare reala:
-- set_gym_paid_until() reactiva orbeste (is_active = true) orice sala cu
-- noua data in viitor, INDIFERENT de motivul pentru care era inactiva -
-- inclusiv o dezactivare manuala deliberata (ex. abuz) pe o sala care inca
-- avea timp neexpirat pe paid_until. Re-salvarea aceleiasi date din
-- obisnuinta ar fi anulat silentios acea dezactivare.
--
-- Fix: reactiveaza automat DOAR daca sala era inactiva probabil din cauza
-- neplatii (paid_until vechi null sau deja depasit) - o dezactivare
-- manuala pe o sala cu timp inca neexpirat ramane neatinsa, la latitudinea
-- exclusiva a toggle-ului manual din Platforma.
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
  update gyms set
    paid_until = p_paid_until,
    is_active = case
      when is_active = false and (paid_until is null or paid_until < current_date) and p_paid_until >= current_date
        then true
      else is_active
    end
  where id = p_gym_id;
end;
$$;
