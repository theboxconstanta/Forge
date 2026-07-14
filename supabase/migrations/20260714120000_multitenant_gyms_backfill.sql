-- Faza 1 din conversia la multi-tenant (vezi planul in
-- C:\Users\Luci\.claude\plans\warm-churning-hopper.md): tabel `gyms` nou +
-- coloana `gym_id` pe toate tabelele de date, cu backfill pentru CrossFit
-- C15 (singura sala reala azi).
--
-- gym_id primeste DEFAULT '<DEFAULT_GYM_ID>' pe fiecare tabel - desi
-- migratia asta e "aditiva" din perspectiva RLS/query-urilor (nimic nu
-- filtreaza inca dupa gym_id, nicio politica RLS nu-l foloseste), un NOT
-- NULL fara default ar sparge imediat orice INSERT din aplicatie care nu
-- seteaza explicit gym_id - iar App.jsx nu-l seteaza inca (asta e Faza 3,
-- separata). Fara acest DEFAULT, aplicatia s-ar strica la primul WOD logat/
-- prima rezervare de dupa acest deploy. DEFAULT-ul poate fi eliminat mai
-- tarziu, dupa ce Faza 3 seteaza gym_id explicit pe toate insert/upsert.
--
-- Secventa e complet sigura de livrat acum, cat exista o singura sala reala:
-- fiecare rand existent + orice rand nou (prin DEFAULT) capata acelasi
-- gym_id, deci comportamentul aplicatiei ramane identic pana la Faza 2 (RLS)
-- si Faza 3 (plumbing explicit).

create table gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  join_code text not null unique,
  owner_id uuid not null references auth.users(id),
  primary_color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into gyms (id, name, join_code, owner_id) values (
  'c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716',
  'CrossFit C15',
  'C15FDR1',
  '97a4e88a-1b51-41f7-ab54-2a5061912daa'
);

-- subscriptions_restrict_member_update_trg respinge orice UPDATE care nu
-- vine de la admin/coach sau nu incrementeaza sessions_used cu exact 1 (paza
-- de securitate din auditul RLS din 07-03) - UPDATE-ul de backfill de mai jos
-- (doar gym_id) nu se potriveste niciunui caz permis, deci trigger-ul trebuie
-- dezactivat temporar doar pentru durata acestei migratii.
alter table subscriptions disable trigger subscriptions_restrict_member_update_trg;

-- gym_id nullable -> backfill -> DEFAULT -> NOT NULL -> index, identic pe
-- toate cele 19 tabele de date (membri legacy `members` ramane neatins -
-- fara politici RLS, nefolosit de aplicatie, vezi PROJECT_STATE.md).
do $$
declare
  gid uuid := 'c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716';
  t text;
  tables text[] := array[
    'profiles', 'admins', 'coaches', 'classes', 'wods', 'subscription_plans',
    'bookings', 'wod_logs', 'personal_records', 'skill_logs', 'class_waitlist',
    'class_reminders', 'push_subscriptions', 'subscriptions', 'feed_posts',
    'feed_comments', 'feed_reactions', 'custom_hero_wods', 'app_settings'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I add column gym_id uuid references gyms(id)', t);
    execute format('update %I set gym_id = $1 where gym_id is null', t) using gid;
    execute format('alter table %I alter column gym_id set default %L::uuid', t, gid);
    execute format('alter table %I alter column gym_id set not null', t);
    execute format('create index %I on %I (gym_id)', t || '_gym_id_idx', t);
  end loop;
end $$;

alter table subscriptions enable trigger subscriptions_restrict_member_update_trg;

-- Constrangeri unice care trebuie sa devina compuse cu gym_id (restul
-- constrangerilor unice din schema sunt deja scopate tranzitiv prin
-- post_id/class_id/wod_id/member_id, care vor apartine unei singure sali).

-- wods: `date` era unic global (un singur WOD pe zi, in toata aplicatia) ->
-- devine unic per sala (fiecare sala isi are propriul WOD zilnic).
alter table wods drop constraint wods_date_key;
alter table wods add constraint wods_gym_date_key unique (gym_id, date);

-- app_settings: azi `key` e cheie primara (un singur set global de setari,
-- ex. cancel_window_hours) -> devine cheie compusa (gym_id, key), fiecare
-- sala cu propriile setari.
alter table app_settings drop constraint app_settings_pkey;
alter table app_settings add primary key (gym_id, key);
