-- Fix urgent: fluxul de inregistrare "Pornesc o sala noua" (owner) pica
-- mereu cu eroare 500 generica la signUp() (Sentry: AuthRetryableFetchError).
--
-- Cauza reala: handle_new_user() (trigger sincron, parte din signUp())
-- incearca sa insereze profiles.gym_id = <id-ul salii noi>, generat client-
-- side INAINTE ca randul din `gyms` sa existe (sala se creeaza abia DUPA ce
-- contul e creat, pentru ca gyms_bootstrap_insert cere owner_id = auth.uid(),
-- iar auth.uid() nu exista inainte de signUp). profiles.gym_id are FK spre
-- gyms(id) - insert-ul din trigger incalca acea constrangere, iar GoTrue
-- raporteaza generic "AuthRetryableFetchError: {}", fara detaliu.
--
-- Fix: profiles.gym_id devine nullable - fluxul de owner semneaza fara
-- gym_id in metadata (handle_new_user() il lasa null), apoi, dupa ce contul
-- exista si e autentificat, se creeaza sala + randul de admin, si ABIA APOI
-- se actualizeaza profiles.gym_id o singura data (de la null la valoarea
-- reala). Fluxul de membru (se alatura unei sali EXISTENTE) nu are aceasta
-- problema - gym_id-ul trimis exista deja, nicio schimbare necesara acolo.

alter table profiles alter column gym_id drop not null;

-- prevent_gym_id_change() permitea inainte NICIO schimbare - acum permite
-- explicit tranzitia null -> valoare (setarea initiala, o singura data, la
-- claim-ul salii de catre owner), dar tot interzice orice schimbare
-- ulterioara a unei valori deja setate.
create or replace function prevent_gym_id_change()
returns trigger
language plpgsql
as $function$
begin
  if old.gym_id is not null and new.gym_id is distinct from old.gym_id then
    raise exception 'gym_id cannot be changed after it has been set';
  end if;
  return new;
end;
$function$;
