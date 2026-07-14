-- Faza 2 din conversia la multi-tenant (vezi planul in
-- C:\Users\Luci\.claude\plans\warm-churning-hopper.md): rescrie toate
-- politicile RLS sa fie scopate pe sala, folosind gym_id adaugat in Faza 1.
--
-- Sigur de livrat acum, cat exista o singura sala reala (CrossFit C15):
-- fiecare rand si fiecare utilizator au deja gym_id = aceeasi valoare, deci
-- rescrierea e comportamental un no-op pentru sala reala - daca ceva e gresit
-- in directia "prea restrictiv", se sparge vizibil imediat; daca e gresit in
-- directia "prea deschis", e cel mult echivalent cu comportamentul actual.

-- ============================================================
-- 1. Helper-e noi (is_admin/is_coach_or_admin raman si cu 0 argumente,
--    Postgres suporta overload dupa semnatura - nimic care le apela pe cele
--    vechi nu se strica, doar politicile de mai jos folosesc noile variante).
-- ============================================================

-- SECURITY DEFINER pe toate trei - obligatoriu, nu doar defensiv. profiles
-- e citita chiar de politica ei RLS (profiles_select_all: gym_id =
-- my_gym_id()) - fara SECURITY DEFINER, interogarea interna din my_gym_id()
-- ar fi ea insasi supusa aceleiasi politici, care apeleaza din nou
-- my_gym_id(), la infinit (gasit live: "stack depth limit exceeded").
-- SECURITY DEFINER + search_path fixat ocolesc RLS strict pentru aceste
-- verificari inguste de identitate ("care e sala mea / sunt admin la sala
-- X"), nu pentru citiri de date in general.
create or replace function my_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select gym_id from profiles where id = auth.uid();
$$;

create or replace function is_admin(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins where id = auth.uid() and gym_id = gid);
$$;

create or replace function is_coach_or_admin(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin(gid) or exists (select 1 from coaches where id = auth.uid() and gym_id = gid);
$$;

-- ============================================================
-- 2. Trigger care blocheaza schimbarea gym_id pe UPDATE, pe toate tabelele
--    care il au. Fara asta, o rescriere corecta a politicilor RLS tot ar
--    lasa o portita: o politica "self" (ex. member_id = auth.uid()) nu
--    interzice implicit sa schimbi gym_id-ul propriului rand la UPDATE (ex.
--    un membru care isi editeaza propriul wod_log ar putea trimite direct
--    catre API un payload cu gym_id-ul altei sali, ramanand in continuare
--    "propriul rand" dupa member_id, dar mutat vizual in alta sala). Un rand
--    nu ar trebui sa se mute NICIODATA intre sali dupa ce a fost creat -
--    trigger-ul impune asta necondit ionat, indiferent ce ar permite o
--    politica RLS sa treaca la nivel de USING/WITH CHECK.
-- ============================================================

create or replace function prevent_gym_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.gym_id is distinct from old.gym_id then
    raise exception 'gym_id cannot be changed after a row is created';
  end if;
  return new;
end;
$$;

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
    execute format(
      'create trigger prevent_gym_id_change_trg before update on %I for each row execute function prevent_gym_id_change()',
      t
    );
  end loop;
end $$;

-- ============================================================
-- 3. Functii SECURITY DEFINER care ocolesc RLS complet si cauta abonamente
--    dupa member_email (nu dupa member_id) - fara filtrare pe gym_id, un
--    email care coincide intamplator intre doua sali diferite ar putea face
--    ca actiunea unui admin/coach de la sala A sa modifice / sa citeasca
--    abonamentul unui membru de la sala B. Ambele capata acum filtrare
--    explicita pe gym_id, fara sa schimbe semnatura functiei (deci fara nicio
--    modificare necesara in App.jsx).
-- ============================================================

create or replace function enforce_subscription_sessions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
  v_sessions_total int;
  v_sessions_used int;
begin
  if is_admin(new.gym_id) then
    return new;
  end if;

  select email into v_email from profiles where id = new.member_id;
  if v_email is null then
    return new;
  end if;

  select sessions_total, sessions_used into v_sessions_total, v_sessions_used
  from subscriptions
  where lower(member_email) = lower(v_email)
    and gym_id = new.gym_id
    and is_active = true and queued = false
    and start_date <= current_date and end_date >= current_date
  order by created_at desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  if v_sessions_total is not null and coalesce(v_sessions_used, 0) >= v_sessions_total then
    raise exception 'member % has exhausted their sessions (% / %)', new.member_id, v_sessions_used, v_sessions_total;
  end if;

  return new;
end;
$function$;

create or replace function adjust_session_count(p_member_email text, p_delta integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_used integer;
  v_total integer;
  v_gym_id uuid := my_gym_id();
begin
  if not is_coach_or_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  select id, sessions_used, sessions_total into v_id, v_used, v_total
  from subscriptions
  where lower(member_email) = lower(p_member_email)
    and gym_id = v_gym_id
    and is_active = true
    and sessions_total is not null
  order by created_at desc
  limit 1;

  if v_id is null then
    return;
  end if;

  update subscriptions
  set sessions_used = greatest(0, least(v_total, coalesce(v_used, 0) + p_delta))
  where id = v_id;
end;
$function$;

-- ============================================================
-- 4. Rescriere politici RLS, tabel cu tabel. ALTER POLICY pastreaza numele
--    si comanda (SELECT/INSERT/UPDATE/DELETE/ALL) existente, schimba doar
--    USING/WITH CHECK - nicio fereastra in care o politica lipseste.
-- ============================================================

-- admins: randul propriu ramane vizibil neschimbat (deja unic prin
-- id = auth.uid(), trigger-ul de mai sus blocheaza oricum mutarea intre
-- sali). Politica de bootstrap pt owneri de sala noua vine in Faza 3,
-- odata cu fluxul de inregistrare care o foloseste.
-- (nicio schimbare necesara pe admins_select_own)

-- app_settings
alter policy app_settings_admin_delete on app_settings using (is_admin(gym_id));
alter policy app_settings_admin_insert on app_settings with check (is_admin(gym_id));
alter policy app_settings_select_all on app_settings using (gym_id = my_gym_id());
alter policy app_settings_admin_update on app_settings using (is_admin(gym_id)) with check (is_admin(gym_id));

-- bookings
alter policy bookings_delete_own_or_admin on bookings using ((member_id = auth.uid()) or is_coach_or_admin(gym_id));
alter policy "Waitlist auto-book" on bookings with check (
  (auth.role() = 'authenticated') and (gym_id = my_gym_id()) and
  (exists (select 1 from class_waitlist where (class_waitlist.class_id)::text = bookings.class_id and (class_waitlist.member_id)::text = (bookings.member_id)::text))
);
alter policy bookings_insert_own_or_admin on bookings with check (
  ((member_id = auth.uid()) and (gym_id = my_gym_id())) or is_coach_or_admin(gym_id)
);
alter policy bookings_select_all on bookings using (gym_id = my_gym_id());
alter policy bookings_admin_update on bookings using (is_coach_or_admin(gym_id)) with check (is_coach_or_admin(gym_id));

-- class_reminders (email-based, cu EXISTS pe bookings recente - scopate
-- acum si prin gym_id, ca sa nu se poata folosi o rezervare recenta de la
-- alta sala ca sa justifice un reminder la sala curenta)
alter policy class_reminders_delete_own_or_admin on class_reminders using (
  is_coach_or_admin(gym_id) or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
);
alter policy class_reminders_insert_own_or_admin_or_recent_booking on class_reminders with check (
  is_coach_or_admin(gym_id)
  or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
  or (exists (
    select 1 from bookings b join profiles p on p.id = b.member_id
    where lower(p.email) = lower(class_reminders.member_email)
      and b.gym_id = class_reminders.gym_id
      and b.created_at > (now() - '00:00:30'::interval)
  ))
);
alter policy class_reminders_select_own_or_admin_or_recent_booking on class_reminders using (
  is_coach_or_admin(gym_id)
  or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
  or (exists (
    select 1 from bookings b join profiles p on p.id = b.member_id
    where lower(p.email) = lower(class_reminders.member_email)
      and b.gym_id = class_reminders.gym_id
      and b.created_at > (now() - '00:00:30'::interval)
  ))
);
alter policy class_reminders_update_own_or_admin_or_recent_booking on class_reminders using (
  is_coach_or_admin(gym_id)
  or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
  or (exists (
    select 1 from bookings b join profiles p on p.id = b.member_id
    where lower(p.email) = lower(class_reminders.member_email)
      and b.gym_id = class_reminders.gym_id
      and b.created_at > (now() - '00:00:30'::interval)
  ))
) with check (
  is_coach_or_admin(gym_id)
  or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
  or (exists (
    select 1 from bookings b join profiles p on p.id = b.member_id
    where lower(p.email) = lower(class_reminders.member_email)
      and b.gym_id = class_reminders.gym_id
      and b.created_at > (now() - '00:00:30'::interval)
  ))
);

-- class_waitlist (azi deschis oricui autentificat - pastram acelasi nivel
-- de deschidere INTRA-sala, doar adaugam izolarea INTRE sali)
alter policy "Remove waitlist entry after booking" on class_waitlist using (
  (auth.role() = 'authenticated') and (gym_id = my_gym_id())
);
alter policy "Members can join waitlist" on class_waitlist with check (
  ((auth.uid())::text = (member_id)::text) and (gym_id = my_gym_id())
);
alter policy "Authenticated can view waitlist entries" on class_waitlist using (
  (auth.role() = 'authenticated') and (gym_id = my_gym_id())
);

-- classes
alter policy classes_admin_delete on classes using (is_coach_or_admin(gym_id));
alter policy classes_admin_insert on classes with check (is_coach_or_admin(gym_id));
alter policy classes_select_all on classes using (gym_id = my_gym_id());

-- coaches (coaches_admin_select_all e cazul special notat in plan: fara
-- scopare, un admin al salii A ar putea lista antrenorii din TOATE salile)
alter policy coaches_admin_delete on coaches using (is_admin(gym_id));
alter policy coaches_admin_insert on coaches with check (is_admin(gym_id));
alter policy coaches_admin_select_all on coaches using (is_admin(gym_id));
-- (nicio schimbare necesara pe coaches_select_own)

-- custom_hero_wods
alter policy custom_hero_wods_delete_own on custom_hero_wods using (member_id = auth.uid());
alter policy custom_hero_wods_insert_own on custom_hero_wods with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy custom_hero_wods_select_own on custom_hero_wods using (member_id = auth.uid());
alter policy custom_hero_wods_update_own on custom_hero_wods using (member_id = auth.uid()) with check (member_id = auth.uid());

-- feed_comments
alter policy feed_comments_delete on feed_comments using ((member_id = auth.uid()) or is_admin(gym_id));
alter policy feed_comments_insert on feed_comments with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy feed_comments_select on feed_comments using (gym_id = my_gym_id());

-- feed_posts
alter policy feed_posts_delete on feed_posts using ((member_id = auth.uid()) or is_admin(gym_id));
alter policy feed_posts_insert on feed_posts with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy feed_posts_select on feed_posts using (gym_id = my_gym_id());

-- feed_reactions
alter policy feed_reactions_delete on feed_reactions using (member_id = auth.uid());
alter policy feed_reactions_insert on feed_reactions with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy feed_reactions_select on feed_reactions using (gym_id = my_gym_id());

-- personal_records
alter policy personal_records_delete_own on personal_records using (member_id = auth.uid());
alter policy personal_records_insert_own on personal_records with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy personal_records_select_own on personal_records using (member_id = auth.uid());
alter policy personal_records_update_own on personal_records using (member_id = auth.uid()) with check (member_id = auth.uid());

-- profiles (gym_id se seteaza o singura data la inregistrare - Faza 3 - si
-- ramane fix, trigger-ul de mai sus interzice schimbarea lui la update)
alter policy profiles_insert_own on profiles with check (id = auth.uid());
alter policy profiles_select_all on profiles using (gym_id = my_gym_id());
alter policy profiles_update_own on profiles using (id = auth.uid()) with check (id = auth.uid());

-- push_subscriptions (o singura politica ALL)
alter policy "Members manage own push subscription" on push_subscriptions
  using ((member_email = (auth.jwt() ->> 'email'::text)) and (gym_id = my_gym_id()))
  with check ((member_email = (auth.jwt() ->> 'email'::text)) and (gym_id = my_gym_id()));

-- skill_logs
alter policy skill_logs_delete_own on skill_logs using (member_id = auth.uid());
alter policy skill_logs_insert_own on skill_logs with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy skill_logs_select_all on skill_logs using (gym_id = my_gym_id());
alter policy skill_logs_update_own on skill_logs using (member_id = auth.uid()) with check (member_id = auth.uid());

-- subscription_plans
alter policy subscription_plans_admin_insert on subscription_plans with check (is_admin(gym_id));
alter policy subscription_plans_select_all on subscription_plans using (gym_id = my_gym_id());
alter policy subscription_plans_admin_update on subscription_plans using (is_admin(gym_id)) with check (is_admin(gym_id));

-- subscriptions (email-based, cu EXISTS pe bookings recente si pe
-- class_waitlist - scopate acum si prin gym_id)
alter policy subscriptions_admin_delete on subscriptions using (is_admin(gym_id));
alter policy subscriptions_admin_insert on subscriptions with check (is_admin(gym_id));
alter policy subscriptions_select_own_or_admin on subscriptions using (
  is_admin(gym_id)
  or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
  or (exists (
    select 1 from bookings b join profiles p on p.id = b.member_id
    where lower(p.email) = lower(subscriptions.member_email)
      and b.gym_id = subscriptions.gym_id
      and b.created_at > (now() - '00:00:30'::interval)
  ))
  or (exists (
    select 1 from class_waitlist cw
    where lower(cw.member_email) = lower(subscriptions.member_email)
      and cw.gym_id = subscriptions.gym_id
  ))
);
alter policy subscriptions_update_own_or_waitlist_or_admin on subscriptions
  using (
    is_admin(gym_id)
    or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
    or (exists (
      select 1 from bookings b join profiles p on p.id = b.member_id
      where lower(p.email) = lower(subscriptions.member_email)
        and b.gym_id = subscriptions.gym_id
        and b.created_at > (now() - '00:00:30'::interval)
    ))
  )
  with check (
    is_admin(gym_id)
    or ((lower(member_email) = lower((auth.jwt() ->> 'email'::text))) and gym_id = my_gym_id())
    or (exists (
      select 1 from bookings b join profiles p on p.id = b.member_id
      where lower(p.email) = lower(subscriptions.member_email)
        and b.gym_id = subscriptions.gym_id
        and b.created_at > (now() - '00:00:30'::interval)
    ))
  );

-- wod_logs
alter policy wod_logs_delete_own on wod_logs using (member_id = auth.uid());
alter policy wod_logs_insert_own on wod_logs with check ((member_id = auth.uid()) and (gym_id = my_gym_id()));
alter policy wod_logs_select_all on wod_logs using (gym_id = my_gym_id());
alter policy wod_logs_update_own on wod_logs using (member_id = auth.uid()) with check (member_id = auth.uid());

-- wods
alter policy wods_admin_delete on wods using (is_coach_or_admin(gym_id));
alter policy wods_admin_insert on wods with check (is_coach_or_admin(gym_id));
alter policy wods_select_all on wods using (gym_id = my_gym_id());
alter policy wods_admin_update on wods using (is_coach_or_admin(gym_id)) with check (is_coach_or_admin(gym_id));
