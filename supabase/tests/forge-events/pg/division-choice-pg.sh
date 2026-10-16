#!/usr/bin/env bash
# FORGE EVENTS - "Show divisions to members" (member_division_choice), on real
# PostgreSQL. Runs INSIDE the disposable container created by setup.sh (Phase 1
# + hardening applied). This script seeds pre-migration rows first, then applies
# /work/division.sql itself, exercises every path a real client has (column-
# granted table writes under RLS + the RPCs), and finally applies
# /work/division.rollback.sql and proves the original functions come back.
set -u
PSQL="psql -U postgres -d postgres -X -q -At"
G1=11111111-1111-1111-1111-111111111111
u() { printf 'aaaaaaaa-0000-0000-0000-%012d' "$1"; }
ADMIN=$(u 1); COACH=$(u 2); MEMBER=$(u 3); EXPIRED=$(u 4); M6=$(u 6); M7=$(u 7); OTHER_GYM=$(u 11)
PASS=0; FAIL=0; FAILED=()
section() { echo; echo "[$1]"; }
pass() { PASS=$((PASS+1)); echo "  PASS $1"; }
fail() { FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  FAIL $1 :: $2"; }
root() { $PSQL -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
as() {
  local claims=""
  if [ "$1" != "-" ]; then claims="set request.jwt.claim.sub = '$1'; set request.jwt.claims = '{\"sub\":\"$1\",\"role\":\"$2\"}';"; fi
  $PSQL -v ON_ERROR_STOP=1 -c "set role $2; $claims" -c "$3" 2>&1
}
ok()  { case "$2" in *ERROR*) fail "$1" "$2";; *"$3"*) pass "$1";; *) fail "$1" "got: $2";; esac; }
err() { case "$2" in *ERROR*"$3"*) pass "$1";; *) fail "$1" "expected error '$3', got: $2";; esac; }
eq()  { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$3', got '$2'"; fi; }

JOIN_MD5_LIVE=6e0cf306b032517da4a11db43db68553
GUARD_MD5_LIVE=88ae8789a7f87d82835b2e91ec6a9581
fnmd5() { root "select md5(prosrc) from pg_proc where oid = 'public.$1'::regprocedure"; }
fnacl() { root "select coalesce(proacl::text, '') || '|' || proowner::regrole from pg_proc where oid = 'public.$1'::regprocedure"; }
div()   { root "select division || ':' || status from event_registrations where event_id = '$1' and member_id = '$2'"; }

# A published event created the way the Admin does (staff insert + event_publish).
# $1 = divisions literal, $2 = extra column list, $3 = extra values.
new_event() {
  local id
  id=$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at, divisions$2)
    values ('$G1', 'Social', 'Party', now() + interval '10 days', now() + interval '10 days 3 hours', '$1'$3) returning id")
  as "$ADMIN" authenticated "select event_publish('$id')" >/dev/null
  echo "$id"
}

# ======================================================================
section "Before the migration: live function text and pre-existing data"
eq "event_join body = production (md5)" "$(fnmd5 'event_join(uuid,text)')" "$JOIN_MD5_LIVE"
eq "events_edit_guard body = production (md5)" "$(fnmd5 'events_edit_guard()')" "$GUARD_MD5_LIVE"
JOIN_ACL=$(fnacl 'event_join(uuid,text)'); GUARD_ACL=$(fnacl 'events_edit_guard()')
LEGACY=$(new_event '{rx,intermediate,beginner}' '' '')
as "$MEMBER" authenticated "select event_join('$LEGACY', 'beginner')" >/dev/null
as "$M6" authenticated "select event_join('$LEGACY', 'intermediate')" >/dev/null
as "$M6" authenticated "select event_leave('$LEGACY')" >/dev/null
SCORED=$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at, has_workout, workout_format, workout_format_config, scoring_enabled)
  values ('$G1', 'Challenge', 'Scored', now() - interval '1 hour', now() + interval '2 days', true, 'AMRAP', '{\"durationSec\":600}'::jsonb, true) returning id")
as "$ADMIN" authenticated "select event_publish('$SCORED')" >/dev/null
as "$MEMBER" authenticated "select event_join('$SCORED', 'rx')" >/dev/null
as "$MEMBER" authenticated "select (event_submit_attempt('$SCORED', gen_random_uuid(), '{\"result\":\"53\"}'::jsonb)).id" >/dev/null
DATA_FP() { root "select md5(coalesce((select string_agg((to_jsonb(e) - 'member_division_choice')::text, '|' order by id) from events e), '')
                     || coalesce((select string_agg(to_jsonb(r)::text, '|' order by event_id, member_id) from event_registrations r), '')
                     || coalesce((select string_agg(to_jsonb(a)::text, '|' order by id) from event_attempts a), ''))"; }
BEFORE_FP=$(DATA_FP)
eq "precondition: 2 events, 3 registration rows, 1 attempt" "$(root "select (select count(*) from events)||','||(select count(*) from event_registrations)||','||(select count(*) from event_attempts)")" "2,3,1"

OUT=$($PSQL -v ON_ERROR_STOP=1 -1 -f /work/division.sql 2>&1)
case "$OUT" in *ERROR*) fail "migration applies in one transaction" "$OUT";; *) pass "migration applies in one transaction";; esac

# ======================================================================
section "Migration effect on existing objects and data"
eq "existing events/registrations/attempts unchanged (all other columns)" "$(DATA_FP)" "$BEFORE_FP"
eq "every existing event defaults to member_division_choice = true" "$(root "select bool_and(member_division_choice) from events")" "t"
eq "column is NOT NULL with default true" "$(root "select is_nullable || '|' || column_default from information_schema.columns where table_name = 'events' and column_name = 'member_division_choice'")" "NO|true"
eq "event_join: still exactly one function (no overload)" "$(root "select count(*) from pg_proc where proname = 'event_join'")" "1"
eq "event_join: owner + privileges unchanged" "$(fnacl 'event_join(uuid,text)')" "$JOIN_ACL"
eq "events_edit_guard: owner + privileges unchanged" "$(fnacl 'events_edit_guard()')" "$GUARD_ACL"
eq "events_edit_guard trigger still attached" "$(root "select count(*) from pg_trigger where tgname = 'events_edit_guard_trg'")" "1"
eq "event_join changed (new body)" "$([ "$(fnmd5 'event_join(uuid,text)')" != "$JOIN_MD5_LIVE" ] && echo yes)" "yes"
eq "anon has no privilege on the new column" "$(root "select has_column_privilege('anon', 'public.events', 'member_division_choice', 'select') or has_column_privilege('anon', 'public.events', 'member_division_choice', 'update')")" "f"

# ======================================================================
section "Default (divisions shown): behaviour identical to before"
SHOWN=$(new_event '{rx,intermediate,beginner}' '' '')
ok "member chooses 'intermediate'" "$(as "$MEMBER" authenticated "select event_join('$SHOWN', 'intermediate')")" '"intermediate"'
eq "stored division = member's choice" "$(div "$SHOWN" "$MEMBER")" "intermediate:registered"
ok "join without a division uses the first division" "$(as "$M6" authenticated "select event_join('$SHOWN')")" '"rx"'
err "a division the event does not offer is refused" "$(as "$M7" authenticated "select event_join('$SHOWN', 'onramp')")" "invalid_division"
ok "registered member may still switch division" "$(as "$MEMBER" authenticated "select event_join('$SHOWN', 'beginner')")" '"changed": true'
eq "existing legacy registration kept (beginner)" "$(div "$LEGACY" "$MEMBER")" "beginner:registered"

# ======================================================================
section "Who may change the setting (column grant + RLS)"
HIDE=$(new_event '{rx,intermediate,beginner,onramp}' '' '')
ok "admin can hide divisions on an unscored published event" "$(as "$ADMIN" authenticated "update events set member_division_choice = false where id = '$HIDE' returning member_division_choice")" "f"
ok "coach can toggle it back on" "$(as "$COACH" authenticated "update events set member_division_choice = true where id = '$HIDE' returning member_division_choice")" "t"
as "$ADMIN" authenticated "update events set member_division_choice = false where id = '$HIDE'" >/dev/null
eq "member cannot change it (RLS: 0 rows)" "$(as "$MEMBER" authenticated "with x as (update events set member_division_choice = true where id = '$HIDE' returning 1) select count(*) from x")" "0"
eq "setting unchanged after the member's attempt" "$(root "select member_division_choice from events where id = '$HIDE'")" "f"
err "anon cannot change it" "$(as - anon "update events set member_division_choice = true where id = '$HIDE'")" "permission denied"
ok "staff insert can create an event with divisions hidden" "$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, member_division_choice) values ('$G1', 'Social', 'Hidden draft', now() + interval '3 days', false) returning member_division_choice")" "f"

# ======================================================================
section "Hidden divisions require an unscored event"
err "insert: hidden + scoring refused" "$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at, has_workout, workout_format, workout_format_config, scoring_enabled, member_division_choice)
  values ('$G1', 'Challenge', 'X', now() + interval '1 day', now() + interval '2 days', true, 'AMRAP', '{}'::jsonb, true, false)")" "events_division_choice_requires_unscored"
err "scored event: hiding divisions refused" "$(as "$ADMIN" authenticated "update events set member_division_choice = false where id = '$SCORED'")" "events_division_choice_requires_unscored"
err "hidden event: switching scoring on refused" "$(as "$ADMIN" authenticated "update events set has_workout = true, workout_format = 'AMRAP', workout_format_config = '{}'::jsonb, scoring_enabled = true where id = '$HIDE'")" "events_division_choice_requires_unscored"
eq "scored event keeps its registration + attempt division" "$(root "select (select division from event_registrations where event_id = '$SCORED' and member_id = '$MEMBER') || '/' || (select division from event_attempts where event_id = '$SCORED')")" "rx/rx"

# ======================================================================
section "Divisions hidden: server assigns the division"
ok "join without a division" "$(as "$MEMBER" authenticated "select event_join('$HIDE')")" '"status": "registered"'
eq "stored division = event's first division (internal)" "$(div "$HIDE" "$MEMBER")" "rx:registered"
ok "a client-sent division is ignored" "$(as "$M6" authenticated "select event_join('$HIDE', 'onramp')")" '"rx"'
eq "stored division is still the internal one" "$(div "$HIDE" "$M6")" "rx:registered"
ok "joining again while registered changes nothing" "$(as "$M6" authenticated "select event_join('$HIDE', 'beginner')")" '"changed": false'
eq "an invalid client value does not error when hidden" "$(as "$M7" authenticated "select event_join('$HIDE', 'nonsense')->>'division'")" "rx"

section "Divisions hidden later: existing divisions are preserved"
LATER=$(new_event '{rx,intermediate,beginner}' '' '')
as "$MEMBER" authenticated "select event_join('$LATER', 'beginner')" >/dev/null
as "$M6" authenticated "select event_join('$LATER', 'intermediate')" >/dev/null
as "$ADMIN" authenticated "update events set member_division_choice = false where id = '$LATER'" >/dev/null
eq "registrations untouched by hiding" "$(div "$LATER" "$MEMBER") $(div "$LATER" "$M6")" "beginner:registered intermediate:registered"
ok "registered member re-joins: no change" "$(as "$MEMBER" authenticated "select event_join('$LATER')")" '"changed": false'
eq "still beginner" "$(div "$LATER" "$MEMBER")" "beginner:registered"
as "$M6" authenticated "select event_leave('$LATER')" >/dev/null
eq "leave keeps the stored division" "$(div "$LATER" "$M6")" "intermediate:withdrawn"
ok "re-join after leaving" "$(as "$M6" authenticated "select event_join('$LATER', 'rx')")" '"intermediate"'
eq "re-join restores the member's own previous division" "$(div "$LATER" "$M6")" "intermediate:registered"
err "removing a division still in use is still refused" "$(as "$ADMIN" authenticated "update events set divisions = '{rx}' where id = '$LATER'")" "division_in_use"
ok "showing divisions again is allowed with registrations present" "$(as "$ADMIN" authenticated "update events set member_division_choice = true where id = '$LATER' returning member_division_choice")" "t"
eq "registrations unchanged after showing again" "$(div "$LATER" "$MEMBER") $(div "$LATER" "$M6")" "beginner:registered intermediate:registered"

# ======================================================================
section "Divisions hidden: every existing registration check still applies"
CAP=$(new_event '{rx,beginner}' ', capacity, member_division_choice' ', 1, false')
ok "capacity 1: first member joins" "$(as "$MEMBER" authenticated "select event_join('$CAP')")" '"registered"'
err "capacity 1: second member refused" "$(as "$M6" authenticated "select event_join('$CAP')")" "event_full"
DL=$(new_event '{rx}' ', registration_deadline, member_division_choice' ", now() + interval '1 day', false")
root "update events set registration_deadline = now() - interval '1 minute' where id = '$DL'" >/dev/null
err "deadline passed refused" "$(as "$MEMBER" authenticated "select event_join('$DL')")" "registration_closed"
CLOSED=$(new_event '{rx}' ', registration_enabled, member_division_choice' ', false, false')
err "registration disabled refused" "$(as "$MEMBER" authenticated "select event_join('$CLOSED')")" "registration_closed"
err "member of another gym refused" "$(as "$OTHER_GYM" authenticated "select event_join('$HIDE')")" "event_not_found"
DRAFT=$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, member_division_choice) values ('$G1', 'Social', 'Draft', now() + interval '3 days', false) returning id")
err "draft event refused" "$(as "$MEMBER" authenticated "select event_join('$DRAFT')")" "event_not_found"
root "update app_settings set value = 'false' where gym_id = '$G1' and key = 'events_enabled'" >/dev/null
err "gym flag off refused" "$(as "$M7" authenticated "select event_join('$HIDE')")" "event_not_found"
root "update app_settings set value = 'true' where gym_id = '$G1' and key = 'events_enabled'" >/dev/null
ok "expired-membership member may join (no subscription requirement, as before)" "$(as "$EXPIRED" authenticated "select event_join('$HIDE')")" '"registered"'
err "unauthenticated refused" "$(as - anon "select event_join('$HIDE')")" "permission denied"
eq "no registration was created in another gym" "$(root "select count(*) from event_registrations where gym_id <> '$G1'")" "0"

# ======================================================================
section "Archived events stay read-only (new column included)"
ARCH=$(new_event '{rx}' ', member_division_choice' ', false')
as "$ADMIN" authenticated "select event_cancel('$ARCH')" >/dev/null
as "$ADMIN" authenticated "select event_archive('$ARCH')" >/dev/null
err "archived: changing the setting refused" "$(as "$ADMIN" authenticated "update events set member_division_choice = true where id = '$ARCH'")" "event_archived_read_only"

# ======================================================================
section "Rollback"
REG_FP=$(root "select md5(string_agg(to_jsonb(r)::text, '|' order by event_id, member_id)) from event_registrations r")
ATT_FP=$(root "select md5(string_agg(to_jsonb(a)::text, '|' order by id)) from event_attempts a")
OUT=$($PSQL -v ON_ERROR_STOP=1 -f /work/division.rollback.sql 2>&1)
case "$OUT" in *ERROR*) fail "rollback applies" "$OUT";; *) pass "rollback applies";; esac
eq "event_join restored to the production text (md5)" "$(fnmd5 'event_join(uuid,text)')" "$JOIN_MD5_LIVE"
eq "events_edit_guard restored to the production text (md5)" "$(fnmd5 'events_edit_guard()')" "$GUARD_MD5_LIVE"
eq "event_join privileges unchanged after rollback" "$(fnacl 'event_join(uuid,text)')" "$JOIN_ACL"
eq "column removed" "$(root "select count(*) from information_schema.columns where table_name = 'events' and column_name = 'member_division_choice'")" "0"
eq "constraint removed" "$(root "select count(*) from pg_constraint where conname = 'events_division_choice_requires_unscored'")" "0"
eq "registrations untouched by rollback" "$(root "select md5(string_agg(to_jsonb(r)::text, '|' order by event_id, member_id)) from event_registrations r")" "$REG_FP"
eq "attempts untouched by rollback" "$(root "select md5(string_agg(to_jsonb(a)::text, '|' order by id)) from event_attempts a")" "$ATT_FP"
ok "after rollback a member can choose a division again" "$(as "$M7" authenticated "select event_join('$LATER', 'beginner')")" '"beginner"'
OUT=$($PSQL -v ON_ERROR_STOP=1 -1 -f /work/division.sql 2>&1)
case "$OUT" in *ERROR*) fail "migration re-applies cleanly after rollback" "$OUT";; *) pass "migration re-applies cleanly after rollback";; esac

echo
echo "division-choice: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] || { printf '  - %s\n' "${FAILED[@]}"; exit 1; }
