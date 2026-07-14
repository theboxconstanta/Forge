-- Bug critic gasit live (07-14): gym_signup_codes are RLS activat dar ZERO
-- politici de SELECT pentru rolul `authenticated`. Politica gyms_bootstrap_insert
-- (din 20260714173000_platform_admin_billing_gate.sql) verifica in WITH CHECK
-- un EXISTS pe gym_signup_codes (reserved_by = auth.uid() and used_at is null) -
-- dar acel EXISTS ruleaza cu privilegiile userului care face INSERT-ul (nu e
-- SECURITY DEFINER, spre deosebire de RPC-urile reserve_/consume_/verify_),
-- deci RLS pe gym_signup_codes il blocheaza mereu, indiferent daca rezervarea
-- chiar exista - fiecare inregistrare de owner esua cu "new row violates
-- row-level security policy for table gyms", niciodata reprodus pana acum
-- pentru ca testele anterioare picau mai devreme (nume duplicat, cache PWA
-- etc.) inainte sa ajunga la acest pas.
--
-- Fix: o politica minimala de SELECT, scopata strict la propria rezervare -
-- nu expune alte coduri, alte rezervari, sau coduri nefolosite ale altcuiva.
create policy gym_signup_codes_select_own_reservation on gym_signup_codes
  for select to authenticated
  using (reserved_by = auth.uid());
