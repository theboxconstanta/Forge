-- Bug real gasit de user: un coach care scoate pe cineva dintr-o clasa nu
-- primea rambursarea sedintei (nici pe ecranul principal al membrului).
--
-- Cauza: subscriptions_restrict_member_update() (din 20260701_enable_rls_core_tables.sql,
-- scrisa inainte sa existe rolul de coach) permite unei terte parti sa modifice
-- sessions_used DOAR daca schimbarea e exact +1 (gandit pt promovarea automata
-- din waitlist) - orice altceva (inclusiv -1, rambursarea la scoaterea dintr-o
-- clasa) arunca eroare pt oricine nu e admin sau proprietarul abonamentului.
--
-- adjust_session_count() (functia SECURITY DEFINER folosita de coach pt
-- adaugare/scoatere din clasa, vezi 20260703161500_adjust_session_count_fn.sql)
-- verifica deja intern is_coach_or_admin() inainte sa faca vreo modificare -
-- trigger-ul de mai jos extinde doar lista de "actori de incredere" care pot
-- schimba orice delta pe sessions_used, ca sa includa si coach, nu doar admin.
-- Un coach tot nu poate actualiza subscriptions direct (RLS pe UPDATE ramane
-- doar is_admin() sau proprietarul insusi) - singura cale prin care ajunge aici
-- e prin adjust_session_count(), care e deja restransa la coloana sessions_used.

CREATE OR REPLACE FUNCTION subscriptions_restrict_member_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF is_coach_or_admin() OR lower(OLD.member_email) = lower(auth.jwt() ->> 'email') THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.sessions_used = OLD.sessions_used + 1) THEN
    RAISE EXCEPTION 'sessions_used may only be incremented by 1 via the waitlist auto-book path';
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.member_email IS DISTINCT FROM OLD.member_email
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.sessions_total IS DISTINCT FROM OLD.sessions_total
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.queued IS DISTINCT FROM OLD.queued
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'the waitlist auto-book path may only change sessions_used';
  END IF;
  RETURN NEW;
END;
$$;

-- Gasit in trecere: Supabase acorda EXECUTE implicit catre anon/authenticated/
-- service_role la orice functie noua (ALTER DEFAULT PRIVILEGES la nivel de
-- proiect) - REVOKE ALL FROM PUBLIC din migratia care a creat adjust_session_count
-- nu a scos si acest grant explicit catre anon. Nu era exploatabil (functia
-- verifica intern is_coach_or_admin(), auth.uid() e null pt anon), dar scos
-- din igiena - anon n-are ce cauta aici.
REVOKE EXECUTE ON FUNCTION adjust_session_count(text, integer) FROM anon;
