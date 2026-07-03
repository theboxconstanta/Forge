-- Functie restransa (nu acces larg la subscriptions) care lasa un coach sa ajusteze
-- sessions_used ca efect secundar al adaugarii/scoaterii unui membru dintr-o clasa
-- (App.jsx adjustMemberSessions) - fara sa-i dea UPDATE pe restul coloanelor din
-- subscriptions (pret, plan, date, is_active/queued raman doar-admin).
-- SECURITY DEFINER ocoleste RLS-ul normal pe subscriptions, de-aia verificarea de
-- autorizare e facuta explicit in interior, nu lasata pe seama politicilor de tabel.

CREATE OR REPLACE FUNCTION adjust_session_count(p_member_email text, p_delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_used integer;
  v_total integer;
BEGIN
  IF NOT is_coach_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT id, sessions_used, sessions_total INTO v_id, v_used, v_total
  FROM subscriptions
  WHERE lower(member_email) = lower(p_member_email)
    AND is_active = true
    AND sessions_total IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE subscriptions
  SET sessions_used = GREATEST(0, LEAST(v_total, COALESCE(v_used, 0) + p_delta))
  WHERE id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION adjust_session_count(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_session_count(text, integer) TO authenticated;
