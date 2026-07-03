-- Limita de sedinte a unui abonament (ex: 4/8/12/24 sedinte) era verificata
-- DOAR client-side, in toggleRezervare (App.jsx: "sedinteLimitate &&
-- sedinteRamase <= 0"), la fel cum era capacitatea claselor inainte de
-- 20260701c_enforce_class_capacity.sql. Fara o garantie in baza de date, o
-- stare locala invechita sau doua rezervari aproape simultane de pe doua
-- device-uri pot ambele trece de verificarea din UI si insera o rezervare
-- desi sedintele sunt deja epuizate.
--
-- Adminul e exceptat intentionat (la fel ca in toggleRezervare: verificarile
-- de abonament ruleaza doar "if (!esteRezervat && !isAdmin)") - un admin
-- poate adauga manual un membru la o clasa chiar daca acesta si-a epuizat
-- sedintele (ex: sedinta bonus/curtoazie), la fel cum poate deja bypassa
-- verificarea de abonament activ/expirat.
--
-- SECURITY DEFINER pentru robustete si consistenta cu enforce_class_capacity
-- - functia trebuie sa vada fiabil abonamentul activ al membrului rezervat,
-- indiferent cine face insert-ul (membrul insusi sau promovarea automata din
-- waitlist, rulata din sesiunea altui membru).

CREATE OR REPLACE FUNCTION enforce_subscription_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_sessions_total int;
  v_sessions_used int;
BEGIN
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_email FROM profiles WHERE id = NEW.member_id;
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- FOR UPDATE serializeaza doua rezervari aproape simultane ale aceluiasi
  -- membru (ex: doua device-uri) pe ultima sedinta ramasa, la fel cum
  -- enforce_class_capacity() locheaza randul din classes.
  SELECT sessions_total, sessions_used INTO v_sessions_total, v_sessions_used
  FROM subscriptions
  WHERE lower(member_email) = lower(v_email)
    AND is_active = true AND queued = false
    AND start_date <= current_date AND end_date >= current_date
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_sessions_total IS NOT NULL AND COALESCE(v_sessions_used, 0) >= v_sessions_total THEN
    RAISE EXCEPTION 'member % has exhausted their sessions (% / %)', NEW.member_id, v_sessions_used, v_sessions_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_enforce_sessions_trg ON bookings;
CREATE TRIGGER bookings_enforce_sessions_trg
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION enforce_subscription_sessions();
