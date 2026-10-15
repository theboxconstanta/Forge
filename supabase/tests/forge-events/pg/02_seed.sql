-- Run as postgres. Test identities only (disposable container).
-- Marker: the end-to-end suite refuses to reset Events data unless this table
-- exists, i.e. unless it is talking to THIS disposable database.
create table public.forge_test_disposable_marker (created_at timestamptz not null default now());
insert into public.forge_test_disposable_marker default values;
-- u1 admin G1, u2 coach G1, u3..u7 members G1 (u4 expired, u5 never subscribed),
-- u10 admin G2, u11 member G2, u12 no gym, u100..u199 crowd members G1.
insert into gyms values ('11111111-1111-1111-1111-111111111111', 'C15'), ('22222222-2222-2222-2222-222222222222', 'Other');
insert into auth.users (id)
  select ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
  from (select unnest(array[1,2,3,4,5,6,7,10,11,12]) n union all select generate_series(100, 199)) s;
insert into admins values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
                          ('aaaaaaaa-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222');
insert into coaches values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into profiles (id, gym_id, email)
  select id,
         case when id in ('aaaaaaaa-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000011')
                then '22222222-2222-2222-2222-222222222222'::uuid
              when id = 'aaaaaaaa-0000-0000-0000-000000000012' then null
              else '11111111-1111-1111-1111-111111111111'::uuid end,
         id::text || '@test'
  from auth.users;
insert into memberships (member_id, gym_id, status)
  select id, gym_id, 'active' from profiles
  where gym_id is not null and id not in ('aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000005');
insert into memberships (member_id, gym_id, status)
  values ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'expired');
insert into subscriptions (gym_id, member_email, is_active, start_date, end_date, sessions_total, sessions_used) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003@test', true, current_date - 10, current_date + 20, 12, 3),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000004@test', false, current_date - 60, current_date - 30, 12, 12);
insert into classes (gym_id, name, date, max_spots) values ('11111111-1111-1111-1111-111111111111', 'WOD', current_date, 12);
insert into bookings (gym_id, member_id, class_id)
  select gym_id, 'aaaaaaaa-0000-0000-0000-000000000003', id::text from classes;
insert into app_settings (gym_id, key, value) values
  ('11111111-1111-1111-1111-111111111111', 'events_enabled', 'true'),
  ('22222222-2222-2222-2222-222222222222', 'events_enabled', 'true');
