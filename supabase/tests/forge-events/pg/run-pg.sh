#!/usr/bin/env bash
# FORGE EVENTS Phase 1B - real PostgreSQL validation.
# Runs INSIDE a disposable local supabase/postgres container (see setup.sh).
# Every check is a separate connection authenticated like PostgREST does it
# (SET ROLE + request.jwt.claim(s)). Concurrency scenarios release N already
# connected sessions at once through an advisory-lock barrier.
set -u
PSQL="psql -U postgres -d postgres -X -q -At"
G1=11111111-1111-1111-1111-111111111111
G2=22222222-2222-2222-2222-222222222222
u() { printf 'aaaaaaaa-0000-0000-0000-%012d' "$1"; }
ADMIN=$(u 1); COACH=$(u 2); MEMBER=$(u 3); EXPIRED=$(u 4); NOSUB=$(u 5); M6=$(u 6); M7=$(u 7)
ADMIN_G2=$(u 10); MEMBER_G2=$(u 11); NO_GYM=$(u 12)
PASS=0; FAIL=0; FAILED=()

section() { echo; echo "[$1]"; }
pass() { PASS=$((PASS+1)); echo "  PASS $1"; }
fail() { FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  FAIL $1 :: $2"; }
# root SQL (table owner, like the migration runner)
root() { $PSQL -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
# as <uid|-> <role> <sql>
as() {
  local claims=""
  if [ "$1" != "-" ]; then
    claims="set request.jwt.claim.sub = '$1'; set request.jwt.claims = '{\"sub\":\"$1\",\"role\":\"$2\"}';"
  fi
  $PSQL -v ON_ERROR_STOP=1 -c "set role $2; $claims" -c "$3" 2>&1
}
ok()  { case "$2" in *ERROR*) fail "$1" "$2";; *"$3"*) pass "$1";; *) fail "$1" "got: $2";; esac; }
err() { case "$2" in *ERROR*"$3"*) pass "$1";; *) fail "$1" "expected error '$3', got: $2";; esac; }
eq()  { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$3', got '$2'"; fi; }

new_event() { # new_event <extra columns sql> <extra values sql>  -> id (draft, by admin)
  as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at $1) values ('$G1', 'competition', 'T', now() - interval '1 hour', now() + interval '2 days' $2) returning id"
}
new_future_event() { # starts tomorrow (non-scoring events allow leave until start)
  as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at $1) values ('$G1', 'competition', 'T', now() + interval '1 day', now() + interval '2 days' $2) returning id"
}
publish() { as "$ADMIN" authenticated "select event_publish('$1')" >/dev/null; }

# barrier <label> <sqlfile-per-worker dir> : runs every *.sql in dir concurrently.
# Each worker file's first line is "-- uid role". Output -> dir/*.out
barrier() {
  local dir=$1 n key=$RANDOM
  n=$(ls "$dir"/*.sql | wc -l)
  ( $PSQL -c "select pg_advisory_lock($key);" -c "do \$\$ declare i int := 0; begin
      while (select count(*) from pg_locks where locktype = 'advisory' and objid = $key and not granted) < $n and i < 3000 loop
        perform pg_sleep(0.01); i := i + 1; end loop; end \$\$;" -c "select pg_advisory_unlock($key);" >/dev/null 2>&1 ) &
  local master=$!
  until [ "$($PSQL -c "select count(*) from pg_locks where locktype = 'advisory' and objid = $key and granted")" = "1" ]; do sleep 0.02; done
  for f in "$dir"/*.sql; do
    read -r _ uid role < "$f"
    ( $PSQL -v ON_ERROR_STOP=1 \
        -c "set role $role; set request.jwt.claim.sub = '$uid'; set request.jwt.claims = '{\"sub\":\"$uid\",\"role\":\"$role\"}';" \
        -c "do \$\$ begin perform pg_advisory_lock_shared($key); perform pg_advisory_unlock_shared($key); end \$\$;" \
        -f "$f" > "${f%.sql}.out" 2>&1 ) &
  done
  wait
}
mkworker() { # mkworker <dir> <idx> <uid> <role> <sql>
  printf -- '-- %s %s\n%s\n' "$3" "$4" "$5" > "$1/$(printf '%03d' "$2").sql"
}
count_out() { grep -l -- "$2" "$1"/*.out 2>/dev/null | wc -l; }

FP_SQL="select md5(string_agg(h, '|' order by h)) from (
  select 'c' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) h from classes t
  union all select 'b' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from bookings t
  union all select 's' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from subscriptions t
  union all select 'm' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from memberships t
  union all select 'p' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from profiles t
  union all select 'a' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from app_settings t) x"
FP_BEFORE=$(root "$FP_SQL")
W=/tmp/forge-w; rm -rf $W; mkdir -p $W

# ======================================================================
section "Catalog security audit (real Supabase roles + default privileges)"
eq "every SECURITY DEFINER Events function pins search_path with pg_temp last" \
  "$(root "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
           and (proname like 'event%' or proname like 'forge_events%')
           and not coalesce(proconfig, '{}') @> array['search_path=public, pg_temp']")" "0"
eq "no Events function executable by anon or PUBLIC" \
  "$(root "select count(*) from pg_proc p where pronamespace = 'public'::regnamespace
           and (proname like 'event%' or proname like 'forge_events%' or proname = 'my_pending_event_announcements')
           and (has_function_privilege('anon', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))")" "0"
eq "internal helpers / trigger functions not executable by authenticated" \
  "$(root "select count(*) from unnest(array['forge_events_member_event(uuid,boolean)','forge_events_staff_event(uuid)',
           'forge_events_own_open_attempt(uuid)','forge_events_clean_score(jsonb)','events_edit_guard()',
           'event_attempts_record_history()','event_attempt_history_immutable()','forge_events_touch_updated_at()']) f
           where has_function_privilege('authenticated', f::regprocedure, 'execute')")" "0"
# The 11 member/staff RPCs + forge_events_enabled (+ the Phase 3.2 CHECK helper when hardening is applied).
HARDENED=$(root "select to_regprocedure('public.forge_events_max_effort_unit_valid(text)') is not null")
eq "exactly the expected Events functions are executable by authenticated" \
  "$(root "select string_agg(proname, ',' order by proname) from pg_proc p where pronamespace = 'public'::regnamespace
           and (proname like 'event%' or proname like 'forge_events%' or proname = 'my_pending_event_announcements')
           and has_function_privilege('authenticated', p.oid, 'execute')")" \
  "event_ack_announcement,event_archive,event_cancel,event_delete_attempt,event_join,event_leave,event_publish,event_registration_counts,event_submit_attempt,event_update_attempt,forge_events_enabled,$([ "$HARDENED" = t ] && echo 'forge_events_max_effort_unit_valid,')my_pending_event_announcements"
eq "anon has no privilege on any Events table" \
  "$(root "select count(*) from unnest(array['events','event_registrations','event_announcement_acks','event_attempts','event_attempt_history']) t,
           unnest(array['select','insert','update','delete','truncate','references','trigger']) p
           where has_table_privilege('anon', 'public.' || t, p)")" "0"
eq "authenticated: no INSERT/UPDATE/DELETE/TRUNCATE on registrations, acks, attempts, history" \
  "$(root "select count(*) from unnest(array['event_registrations','event_announcement_acks','event_attempts','event_attempt_history']) t,
           unnest(array['insert','update','delete','truncate','references','trigger']) p
           where has_table_privilege('authenticated', 'public.' || t, p)")" "0"
eq "authenticated cannot write lifecycle columns of events" \
  "$(root "select count(*) from unnest(array['status','published_at','cancelled_at','archived_at','announcement_revision','created_by','created_at','id','updated_at']) c,
           unnest(array['INSERT','UPDATE']) p where has_column_privilege('authenticated', 'public.events', c, p)")" "0"
eq "authenticated cannot change events.gym_id" "$(root "select has_column_privilege('authenticated', 'public.events', 'gym_id', 'UPDATE')")" "f"
eq "RLS enabled on all 5 Events tables" \
  "$(root "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
           and relname in ('events','event_registrations','event_announcement_acks','event_attempts','event_attempt_history')")" "5"
eq "authenticated cannot CREATE in schema public (no object shadowing)" "$(root "select has_schema_privilege('authenticated', 'public', 'create')")" "f"
eq "realtime publication: events, event_registrations, event_attempts added (acks/history not)" \
  "$(root "select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'event%'")" \
  "event_attempts,event_registrations,events"
eq "event-covers bucket: public, 5 MB, jpeg/webp" \
  "$(root "select public || ',' || file_size_limit || ',' || array_to_string(allowed_mime_types, '/') from storage.buckets where id = 'event-covers'")" \
  "true,5242880,image/jpeg/image/webp"

# ======================================================================
section "pg_temp shadowing attempt against SECURITY DEFINER RPCs"
EV_T=$(new_event ", registration_enabled, capacity" ", true, 2"); publish "$EV_T"
OUT=$(as "$MEMBER" authenticated "create temp table events (like public.events);
  insert into pg_temp.events select * from public.events where id = '$EV_T';
  update pg_temp.events set capacity = 1000, registration_enabled = true;
  create temp table event_registrations (like public.event_registrations);
  select event_join('$EV_T')")
ok "member's temp tables are ignored by event_join (resolves public.*)" "$OUT" '"status": "registered"'
eq "join landed in the real public.event_registrations" \
  "$(root "select count(*) from event_registrations where event_id = '$EV_T' and member_id = '$MEMBER'")" "1"

# ======================================================================
section "RLS, RPC permissions, gym isolation (separate real connections)"
EV=$(new_event ", capacity" ", 50"); publish "$EV"
err "anon cannot read events" "$(as - anon "select count(*) from events")" "permission denied"
err "anon cannot call event_join" "$(as - anon "select event_join('$EV')")" "permission denied"
err "authenticated cannot call internal helper" "$(as "$MEMBER" authenticated "select forge_events_staff_event('$EV')")" "permission denied"
err "member cannot insert a registration directly" \
  "$(as "$MEMBER" authenticated "insert into event_registrations (event_id, gym_id, member_id, division, status) values ('$EV', '$G1', '$MEMBER', 'rx', 'registered')")" "permission denied"
err "member cannot insert an attempt directly" \
  "$(as "$MEMBER" authenticated "insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, format_snapshot) values ('$EV', '$G1', '$MEMBER', gen_random_uuid(), 'rx', '1', 'AMRAP')")" "permission denied"
err "member cannot create events" \
  "$(as "$MEMBER" authenticated "insert into events (gym_id, event_type, title, starts_at) values ('$G1', 'x', 'x', now())")" "row-level security"
err "staff cannot set status directly" "$(as "$ADMIN" authenticated "update events set status = 'archived' where id = '$EV'")" "permission denied"
err "staff cannot publish by inserting a published row" \
  "$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, status) values ('$G1', 'x', 'x', now(), 'published')")" "permission denied"
err "G1 admin cannot create an event in G2" \
  "$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at) values ('$G2', 'x', 'x', now() + interval '1 day')")" "row-level security"
eq "G2 member sees no G1 events" "$(as "$MEMBER_G2" authenticated "select count(*) from events where gym_id = '$G1'")" "0"
eq "G2 admin sees no G1 events" "$(as "$ADMIN_G2" authenticated "select count(*) from events where gym_id = '$G1'")" "0"
err "G2 member cannot join G1 event (not found, no leak)" "$(as "$MEMBER_G2" authenticated "select event_join('$EV')")" "event_not_found"
err "G2 admin cannot publish/cancel G1 event" "$(as "$ADMIN_G2" authenticated "select event_cancel('$EV')")" "event_not_found"
eq "G2 admin update of G1 event touches 0 rows" "$(as "$ADMIN_G2" authenticated "with u as (update events set title = 'hacked' where id = '$EV' returning 1) select count(*) from u")" "0"
err "member with no gym cannot join" "$(as "$NO_GYM" authenticated "select event_join('$EV')")" "event_not_found"
ok "expired-subscription member can join" "$(as "$EXPIRED" authenticated "select event_join('$EV')")" '"registered"'
ok "never-subscribed member can join" "$(as "$NOSUB" authenticated "select event_join('$EV')")" '"registered"'
eq "member sees G1 registrations only" "$(as "$MEMBER_G2" authenticated "select count(*) from event_registrations")" "0"
eq "G2 member's counts RPC returns nothing for G1 event" "$(as "$MEMBER_G2" authenticated "select count(*) from event_registration_counts(array['$EV']::uuid[])")" "0"
DRAFT=$(new_event "" "")
eq "member cannot see drafts" "$(as "$MEMBER" authenticated "select count(*) from events where id = '$DRAFT'")" "0"
eq "coach sees drafts" "$(as "$COACH" authenticated "select count(*) from events where id = '$DRAFT'")" "1"
root "update app_settings set value = 'false' where gym_id = '$G1' and key = 'events_enabled'" >/dev/null
eq "flag off: member sees no events" "$(as "$MEMBER" authenticated "select count(*) from events")" "0"
err "flag off: member cannot join" "$(as "$M6" authenticated "select event_join('$EV')")" "event_not_found"
eq "flag off: coach still sees events" "$(as "$COACH" authenticated "select count(*) > 0 from events")" "t"
eq "flag: member update touches 0 rows" \
  "$(as "$MEMBER" authenticated "with x as (update app_settings set value = 'true' where gym_id = '$G1' and key = 'events_enabled' returning 1) select count(*) from x")" "0"
eq "flag: still off after member attempt" "$(root "select value from app_settings where gym_id = '$G1' and key = 'events_enabled'")" "false"
eq "flag: coach update changes nothing" \
  "$(as "$COACH" authenticated "with x as (update app_settings set value = 'true' where gym_id = '$G1' and key = 'events_enabled' returning 1) select count(*) from x")" "0"
eq "flag: G2 admin cannot switch on G1" \
  "$(as "$ADMIN_G2" authenticated "with x as (update app_settings set value = 'true' where gym_id = '$G1' and key = 'events_enabled' returning 1) select count(*) from x")" "0"
eq "flag: G1 admin can switch it on" \
  "$(as "$ADMIN" authenticated "with x as (update app_settings set value = 'true' where gym_id = '$G1' and key = 'events_enabled' returning 1) select count(*) from x")" "1"

# Storage policies on the local storage.objects model
COVER_OK="$G1/$EV/cover.jpg"
ok "coach uploads cover into own gym folder" \
  "$(as "$COACH" authenticated "insert into storage.objects (bucket_id, name) values ('event-covers', '$COVER_OK'); select 'inserted'")" "inserted"
err "coach cannot upload into G2 folder" \
  "$(as "$COACH" authenticated "insert into storage.objects (bucket_id, name) values ('event-covers', '$G2/x/cover.jpg')")" "row-level security"
err "member cannot upload a cover" \
  "$(as "$MEMBER" authenticated "insert into storage.objects (bucket_id, name) values ('event-covers', '$G1/x/m.jpg')")" "row-level security"
eq "member cannot list covers" "$(as "$MEMBER" authenticated "select count(*) from storage.objects where bucket_id = 'event-covers'")" "0"
eq "coach can see own gym covers (Storage API remove/upsert need SELECT)" \
  "$(as "$COACH" authenticated "select count(*) from storage.objects where bucket_id = 'event-covers'")" "1"
eq "G2 admin cannot see G1 covers" "$(as "$ADMIN_G2" authenticated "select count(*) from storage.objects where bucket_id = 'event-covers'")" "0"
eq "coach removes cover the way Storage API does (DELETE ... RETURNING)" \
  "$(as "$COACH" authenticated "set storage.allow_delete_query = 'true'; with d as (delete from storage.objects where bucket_id = 'event-covers' and name = '$COVER_OK' returning name) select count(*) from d")" "1"
ok "existing buckets untouched" "$(root "select string_agg(id || ':' || public, ',' order by id) from storage.buckets")" "avatars:true,event-covers:true,wod-photos:false"

# ======================================================================
section "C1  50 simultaneous joins, capacity 10"
EVC=$(new_event ", capacity" ", 10"); publish "$EVC"
D=$W/c1; mkdir -p $D
for i in $(seq 100 149); do mkworker $D $i "$(u $i)" authenticated "select event_join('$EVC');"; done
barrier $D
eq "exactly 10 joins succeeded" "$(count_out $D '"registered"')" "10"
eq "exactly 40 got event_full" "$(count_out $D 'event_full')" "40"
eq "no other errors" "$(grep -l ERROR $D/*.out | xargs -r grep -L event_full | wc -l)" "0"
eq "table holds exactly 10 registered" "$(root "select count(*) from event_registrations where event_id = '$EVC' and status = 'registered'")" "10"
eq "registered members = the ones told 'registered'" \
  "$(root "select string_agg(member_id::text, ',' order by member_id) from event_registrations where event_id = '$EVC'")" \
  "$(for f in $(grep -l '"registered"' $D/*.out); do head -1 "${f%.out}.sql" | awk '{print $2}'; done | sort | paste -sd,)"

# ======================================================================
section "C2  concurrent join + leave"
EVL=$(new_future_event ", capacity" ", 5"); publish "$EVL"
err "control: leaving a started non-scoring event is refused" \
  "$(as "$EXPIRED" authenticated "select event_leave('$EV')")" "event_started"
for i in 150 151 152 153 154; do as "$(u $i)" authenticated "select event_join('$EVL')" >/dev/null; done
D=$W/c2; mkdir -p $D
for i in 150 151 152 153 154; do mkworker $D $i "$(u $i)" authenticated "select event_leave('$EVL');"; done
for i in $(seq 160 179); do mkworker $D $i "$(u $i)" authenticated "select event_join('$EVL');"; done
barrier $D
LEFT=$(count_out $D '"withdrawn"'); JOINED=$(count_out $D '"registered"'); FULL=$(count_out $D 'event_full')
eq "all 5 leaves succeeded" "$LEFT" "5"
eq "joins + event_full = 20 (no other outcome)" "$((JOINED + FULL))" "20"
FINAL=$(root "select count(*) from event_registrations where event_id = '$EVL' and status = 'registered'")
eq "capacity never exceeded and table matches responses" "$FINAL" "$JOINED"
eq "capacity respected (<= 5)" "$([ "$FINAL" -le 5 ] && echo yes || echo no)" "yes"
D=$W/c2b; mkdir -p $D
for i in $(seq 1 20); do
  if [ $((i % 2)) -eq 0 ]; then mkworker $D $i "$(u 180)" authenticated "select event_leave('$EVL');"
  else mkworker $D $i "$(u 180)" authenticated "select event_join('$EVL');"; fi
done
root "update events set capacity = 50 where id = '$EVL'" >/dev/null
barrier $D
eq "same member join/leave storm: one row, no errors" \
  "$(root "select count(*) from event_registrations where event_id = '$EVL' and member_id = '$(u 180)'"),$(grep -l ERROR $D/*.out | wc -l)" "1,0"

# ======================================================================
section "C3  simultaneous attempt submissions"
EVS=$(new_event ", has_workout, workout_format, scoring_enabled, capacity" ", true, 'AMRAP', true, 100"); publish "$EVS"
for i in $(seq 100 109); do as "$(u $i)" authenticated "select event_join('$EVS')" >/dev/null; done
D=$W/c3; mkdir -p $D; k=0
for i in $(seq 100 109); do for j in 1 2 3 4 5; do k=$((k+1))
  mkworker $D $k "$(u $i)" authenticated "select (event_submit_attempt('$EVS', gen_random_uuid(), '{\"result\":\"$((i+j))\"}')).id;"
done; done
barrier $D
eq "50 concurrent submits -> 50 successes" "$(grep -L ERROR $D/*.out | wc -l)" "50"
eq "50 rows, all with format snapshot AMRAP" "$(root "select count(*) || ',' || count(*) filter (where format_snapshot = 'AMRAP') from event_attempts where event_id = '$EVS'")" "50,50"

section "C4  duplicate client_attempt_id retries (30 concurrent)"
CID=$(root "select gen_random_uuid()")
D=$W/c4; mkdir -p $D
for i in $(seq 1 30); do mkworker $D $i "$MEMBER" authenticated "select (event_submit_attempt('$EVS', '$CID', '{\"result\":\"77\"}')).id;"; done
as "$MEMBER" authenticated "select event_join('$EVS')" >/dev/null
barrier $D
eq "no errors" "$(grep -l ERROR $D/*.out | wc -l)" "0"
eq "all 30 responses carry the same attempt id" "$(cat $D/*.out | grep -v '^$' | sort -u | wc -l)" "1"
eq "exactly one row stored" "$(root "select count(*) from event_attempts where event_id = '$EVS' and member_id = '$MEMBER'")" "1"

section "C5  20-attempt cap under concurrency (soft-deleted count)"
for j in $(seq 1 14); do as "$M6" authenticated "select event_join('$EVS')" >/dev/null 2>&1
  as "$M6" authenticated "select event_submit_attempt('$EVS', gen_random_uuid(), '{\"result\":\"$j\"}')" >/dev/null; done
KEEP=$(as "$M6" authenticated "select (event_submit_attempt('$EVS', gen_random_uuid(), '{\"result\":\"15\"}')).id")
for a in $(root "select id from event_attempts where event_id = '$EVS' and member_id = '$M6' order by created_at limit 5"); do
  as "$M6" authenticated "select event_delete_attempt('$a')" >/dev/null; done
KEEP_CID=$(root "select client_attempt_id from event_attempts where id = '$KEEP'")
D=$W/c5; mkdir -p $D
for i in $(seq 1 20); do mkworker $D $i "$M6" authenticated "select (event_submit_attempt('$EVS', gen_random_uuid(), '{\"result\":\"9$i\"}')).id;"; done
for i in $(seq 21 30); do mkworker $D $i "$M6" authenticated "select (event_submit_attempt('$EVS', '$KEEP_CID', '{\"result\":\"0\"}')).id;"; done
barrier $D
eq "15 existing (5 soft-deleted) + 20 concurrent new -> exactly 5 accepted" \
  "$(for i in $(seq 1 20); do grep -L ERROR "$D/$(printf '%03d' $i).out"; done | wc -l)" "5"
eq "15 rejected with attempt_limit_reached" "$(count_out $D attempt_limit_reached)" "15"
eq "10 concurrent retries of an existing id all returned it (never consumed)" \
  "$(for i in $(seq 21 30); do grep -l "$KEEP" "$D/$(printf '%03d' $i).out"; done | wc -l)" "10"
eq "member total = 20 rows (5 soft-deleted kept)" \
  "$(root "select count(*) || ',' || count(*) filter (where deleted_at is not null) from event_attempts where event_id = '$EVS' and member_id = '$M6'")" "20,5"
eq "delete history recorded for the 5 deletes" \
  "$(root "select count(*) from event_attempt_history where member_id = '$M6' and op = 'delete'")" "5"

section "C6  staff scoring change racing first attempts"
EVR=$(new_event ", has_workout, workout_format, scoring_enabled" ", true, 'AMRAP', true"); publish "$EVR"
for i in $(seq 100 119); do as "$(u $i)" authenticated "select event_join('$EVR')" >/dev/null; done
D=$W/c6; mkdir -p $D
for i in $(seq 100 119); do mkworker $D $i "$(u $i)" authenticated "select (event_submit_attempt('$EVR', gen_random_uuid(), '{\"result\":\"5\"}')).id;"; done
mkworker $D 999 "$ADMIN" authenticated "update events set workout_format = 'For Time' where id = '$EVR';"
barrier $D
eq "no attempt frozen under a format different from the event's" \
  "$(root "select count(*) from event_attempts a join events e on e.id = a.event_id where a.event_id = '$EVR' and a.format_snapshot <> e.workout_format")" "0"
eq "staff edit either applied before every attempt or was refused scoring_locked" \
  "$(if grep -q scoring_locked $D/999.out; then echo consistent; elif [ "$(root "select workout_format from events where id = '$EVR'")" = "For Time" ]; then echo consistent; else echo inconsistent; fi)" "consistent"

section "C7  capacity reduction racing joins"
EVK=$(new_event ", capacity" ", 30"); publish "$EVK"
D=$W/c7; mkdir -p $D
for i in $(seq 100 129); do mkworker $D $i "$(u $i)" authenticated "select event_join('$EVK');"; done
mkworker $D 999 "$ADMIN" authenticated "update events set capacity = 8 where id = '$EVK';"
barrier $D
eq "registered never exceeds the final capacity" \
  "$(root "select (select count(*) from event_registrations where event_id = '$EVK' and status = 'registered') <= capacity from events where id = '$EVK'")" "t"

section "C8  concurrent publication + announcement acknowledgments"
EVP=$(new_event "" "")
D=$W/c8; mkdir -p $D
for i in 1 2 3 4; do mkworker $D $i "$ADMIN" authenticated "select event_publish('$EVP');"; done
for i in 5 6 7 8; do mkworker $D $i "$COACH" authenticated "select event_publish('$EVP');"; done
barrier $D
eq "8 racing publishes -> exactly 1 succeeded" "$(count_out $D '"published"')" "1"
eq "7 refused invalid_transition" "$(count_out $D invalid_transition)" "7"
eq "announcement_revision = 1" "$(root "select announcement_revision from events where id = '$EVP'")" "1"
D=$W/c8b; mkdir -p $D
for i in $(seq 100 139); do mkworker $D $i "$(u $i)" authenticated "select event_ack_announcement('$EVP', 1, 'dismissed');"; done
mkworker $D 900 "$ADMIN" authenticated "select event_cancel('$EVP'); select event_publish('$EVP');"
barrier $D
eq "40 concurrent acks: no errors" "$(ls $D/1*.out | xargs grep -l ERROR | wc -l)" "0"
eq "republish raced acks -> revision 2" "$(root "select announcement_revision from events where id = '$EVP'")" "2"
eq "every ack stored at revision 1 (none above the event)" "$(root "select count(*) || ',' || max(revision) from event_announcement_acks where event_id = '$EVP'")" "40,1"
eq "the republished event is pending again for an acked member" \
  "$(as "$(u 100)" authenticated "select count(*) from my_pending_event_announcements() where id = '$EVP'")" "1"
D=$W/c8c; mkdir -p $D
for i in $(seq 1 10); do mkworker $D $i "$(u 101)" authenticated "select event_ack_announcement('$EVP', $(( (i % 2) + 1 )), 'dismissed');"; done
barrier $D
eq "same member acking rev 1 and 2 concurrently -> ends at 2" "$(root "select revision from event_announcement_acks where event_id = '$EVP' and member_id = '$(u 101)'")" "2"
eq "and no longer pending" "$(as "$(u 101)" authenticated "select count(*) from my_pending_event_announcements() where id = '$EVP'")" "0"

# ======================================================================
section "Integrity after concurrency"
eq "no gym mismatch between children and their event" \
  "$(root "select (select count(*) from event_registrations r join events e on e.id = r.event_id where r.gym_id <> e.gym_id)
         + (select count(*) from event_attempts a join events e on e.id = a.event_id where a.gym_id <> e.gym_id)
         + (select count(*) from event_announcement_acks k join events e on e.id = k.event_id where k.gym_id <> e.gym_id)")" "0"
eq "no attempt by an unregistered member" \
  "$(root "select count(*) from event_attempts a where not exists (select 1 from event_registrations r where r.event_id = a.event_id and r.member_id = a.member_id)")" "0"
eq "no member above 20 attempts" "$(root "select count(*) from (select 1 from event_attempts group by event_id, member_id having count(*) > 20) x")" "0"
eq "classes / bookings / subscriptions / memberships / profiles / app_settings unchanged" "$(root "$FP_SQL")" "$FP_BEFORE"

echo
echo "RESULT: $PASS passed, $FAIL failed"
for f in "${FAILED[@]}"; do echo "  - $f"; done
[ "$FAIL" -eq 0 ]
