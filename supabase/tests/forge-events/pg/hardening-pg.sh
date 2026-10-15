#!/usr/bin/env bash
# FORGE EVENTS Phase 3.2 - Max Effort scoreUnit hardening, on real PostgreSQL.
# Runs INSIDE the disposable container. Requires setup.sh with the hardening
# migration COPIED but NOT applied (APPLY_HARDENING=0): this script seeds a
# pre-hardening "legacy" row first, then applies /work/hardening.sql itself.
# Every attack goes through the paths a real client has: PostgREST-style
# table writes (column grants + RLS) and the RPCs, plus service_role and the
# owner role to prove the trigger cannot be skipped by any writer.
set -u
PSQL="psql -U postgres -d postgres -X -q -At"
G1=11111111-1111-1111-1111-111111111111
u() { printf 'aaaaaaaa-0000-0000-0000-%012d' "$1"; }
ADMIN=$(u 1); MEMBER=$(u 3); M6=$(u 6)
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

# A scored, published Max Effort event created the way the Admin client does
# (column-granted insert as staff, then event_publish). $1 = config json.
new_scored() {
  local id
  id=$(as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at, has_workout, workout_format, workout_format_config, scoring_enabled)
    values ('$G1', 'Challenge', 'Max', now() - interval '1 hour', now() + interval '2 days', true, '$2', '$1'::jsonb, true) returning id")
  as "$ADMIN" authenticated "select event_publish('$id')" >/dev/null
  echo "$id"
}
submit() { as "$1" authenticated "select (event_submit_attempt('$2', gen_random_uuid(), '$3'::jsonb)).id"; }

# ======================================================================
section "Legacy data present BEFORE the hardening migration"
eq "precondition: hardening not applied yet" "$(root "select to_regprocedure('public.event_attempts_validate_max_effort()') is null")" "t"
LEGACY=$(root "insert into events (gym_id, event_type, title, starts_at, ends_at, status, published_at, announcement_revision, has_workout, workout_format, workout_format_config, scoring_enabled)
  values ('$G1', 'Challenge', 'Legacy Max', now() - interval '1 hour', now() + interval '2 days', 'published', now(), 1, true, 'Max Effort', '{}'::jsonb, true) returning id")
root "insert into event_registrations (event_id, gym_id, member_id, division, status) values ('$LEGACY', '$G1', '$MEMBER', 'rx', 'registered')" >/dev/null
LEGACY_ATT=$(root "insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, format_snapshot, format_config_snapshot)
  values ('$LEGACY', '$G1', '$MEMBER', gen_random_uuid(), 'rx', 'lots', 'Max Effort', '{}'::jsonb) returning id")
LEGACY_FP=$(root "select md5((select row(e.*)::text from events e where id = '$LEGACY') || (select row(a.*)::text from event_attempts a where id = '$LEGACY_ATT'))")
OUT=$($PSQL -v ON_ERROR_STOP=1 -1 -f /work/hardening.sql 2>&1)
case "$OUT" in *ERROR*) fail "hardening applies on a database that already holds invalid rows" "$OUT";; *) pass "hardening applies on a database that already holds invalid rows";; esac
eq "existing event + attempt rows are byte-identical (nothing rewritten)" \
  "$(root "select md5((select row(e.*)::text from events e where id = '$LEGACY') || (select row(a.*)::text from event_attempts a where id = '$LEGACY_ATT'))")" "$LEGACY_FP"
eq "the constraint is NOT VALID (existing rows not re-checked)" "$(root "select convalidated from pg_constraint where conname = 'events_max_effort_score_unit'")" "f"

# ======================================================================
section "Event configuration (staff writes through the API)"
ins() { as "$ADMIN" authenticated "insert into events (gym_id, event_type, title, starts_at, ends_at, has_workout, workout_format, workout_format_config, scoring_enabled) values ('$G1', 'Challenge', 'X', now() + interval '1 day', now() + interval '2 days', true, '$1', '$2'::jsonb, $3) returning id"; }
err "scored Max Effort without scoreUnit refused" "$(ins 'Max Effort' '{}' true)" "events_max_effort_score_unit"
err "bare 'distance' refused" "$(ins 'Max Effort' '{"scoreUnit":"distance"}' true)" "events_max_effort_score_unit"
err "unknown value refused" "$(ins 'Max Effort' '{"scoreUnit":"miles"}' true)" "events_max_effort_score_unit"
err "JSON null scoreUnit refused" "$(ins 'Max Effort' '{"scoreUnit":null}' true)" "events_max_effort_score_unit"
err "non-string scoreUnit refused" "$(ins 'Max Effort' '{"scoreUnit":5}' true)" "events_max_effort_score_unit"
err "scoreUnit on another format refused" "$(ins 'AMRAP' '{"scoreUnit":"load"}' true)" "events_max_effort_score_unit"
for unitv in load reps calories distance_m distance_km; do
  ok "valid scoreUnit '$unitv' accepted" "$(ins 'Max Effort' "{\"scoreUnit\":\"$unitv\",\"movement\":\"Row\"}" true)" "-"
done
DRAFT=$(ins 'Max Effort' '{}' false)
ok "unscored Max Effort draft without scoreUnit is allowed (preparation)" "$DRAFT" "-"
err "switching scoring ON without a scoreUnit refused" "$(as "$ADMIN" authenticated "update events set scoring_enabled = true, ends_at = now() + interval '3 days' where id = '$DRAFT'")" "events_max_effort_score_unit"
ok "switching scoring ON with a scoreUnit allowed" "$(as "$ADMIN" authenticated "update events set scoring_enabled = true, workout_format_config = '{\"scoreUnit\":\"reps\"}' where id = '$DRAFT' returning id")" "-"
err "changing a valid config to an invalid one refused" "$(as "$ADMIN" authenticated "update events set workout_format_config = '{\"scoreUnit\":\"nope\"}' where id = '$DRAFT'")" "events_max_effort_score_unit"
ok "other v1 formats unaffected (AMRAP scored, no scoreUnit)" "$(ins 'AMRAP' '{"durationSec":720}' true)" "-"

# ======================================================================
section "Max Effort scores through the RPCs (member)"
LOAD=$(new_scored '{"scoreUnit":"load"}' 'Max Effort')
REPS=$(new_scored '{"scoreUnit":"reps"}' 'Max Effort')
KM=$(new_scored '{"scoreUnit":"distance_km"}' 'Max Effort')
for e in "$LOAD" "$REPS" "$KM"; do as "$MEMBER" authenticated "select event_join('$e')" >/dev/null; done
COUNT() { root "select count(*) from event_attempts where event_id = '$1' and member_id = '$MEMBER'"; }
err "non-numeric load refused" "$(submit "$MEMBER" "$LOAD" '{"result":"heavy","weight_unit":"kg"}')" "invalid_score_for_format"
err "negative load refused" "$(submit "$MEMBER" "$LOAD" '{"result":"-100","weight_unit":"kg"}')" "invalid_score_for_format"
err "zero load refused" "$(submit "$MEMBER" "$LOAD" '{"result":"0","weight_unit":"kg"}')" "invalid_score_for_format"
err "absurd load refused" "$(submit "$MEMBER" "$LOAD" '{"result":"99999999","weight_unit":"kg"}')" "invalid_score_for_format"
err "load without kg/lb refused" "$(submit "$MEMBER" "$LOAD" '{"result":"100"}')" "invalid_score_for_format"
err "load with a time refused" "$(submit "$MEMBER" "$LOAD" '{"result":"100","weight_unit":"kg","time_result":"3:00"}')" "invalid_score_for_format"
err "load with a completion state refused" "$(submit "$MEMBER" "$LOAD" '{"result":"100","weight_unit":"kg","completion_state":"capped"}')" "invalid_score_for_format"
err "load with sets refused" "$(submit "$MEMBER" "$LOAD" '{"result":"100","weight_unit":"kg","sets":{"a":[]}}')" "invalid_score_for_format"
err "load with weight_logged refused" "$(submit "$MEMBER" "$LOAD" '{"result":"100","weight_unit":"kg","weight_logged":"100"}')" "invalid_score_for_format"
err "time-only score on Max Effort refused" "$(submit "$MEMBER" "$LOAD" '{"time_result":"3:00"}')" "invalid_score_for_format"
err "decimal reps refused" "$(submit "$MEMBER" "$REPS" '{"result":"10.5"}')" "invalid_score_for_format"
err "reps with a kg/lb unit refused" "$(submit "$MEMBER" "$REPS" '{"result":"10","weight_unit":"kg"}')" "invalid_score_for_format"
err "distance with a kg/lb unit refused" "$(submit "$MEMBER" "$KM" '{"result":"5.2","weight_unit":"lb"}')" "invalid_score_for_format"
eq "refused submissions consumed no attempts" "$(COUNT "$LOAD"),$(COUNT "$REPS"),$(COUNT "$KM")" "0,0,0"
ok "valid load (kg) accepted" "$(submit "$MEMBER" "$LOAD" '{"result":"102.5","weight_unit":"kg"}')" "-"
ok "valid load (lb) accepted" "$(submit "$MEMBER" "$LOAD" '{"result":"225","weight_unit":"lb"}')" "-"
ok "valid reps accepted" "$(submit "$MEMBER" "$REPS" '{"result":"87"}')" "-"
ok "valid distance (km) accepted" "$(submit "$MEMBER" "$KM" '{"result":"5.25"}')" "-"
A1=$(root "select id from event_attempts where event_id = '$LOAD' and member_id = '$MEMBER' and result = '102.5'")
H0=$(root "select count(*) from event_attempt_history where attempt_id = '$A1'")
err "event_update_attempt to an invalid score refused" "$(as "$MEMBER" authenticated "select event_update_attempt('$A1', '{\"result\":\"abc\",\"weight_unit\":\"kg\"}'::jsonb)")" "invalid_score_for_format"
eq "refused update left the attempt + history untouched" "$(root "select result || ',' || weight_unit from event_attempts where id = '$A1'"),$(root "select count(*) from event_attempt_history where attempt_id = '$A1'")" "102.5,kg,$H0"
ok "valid update accepted" "$(as "$MEMBER" authenticated "select (event_update_attempt('$A1', '{\"result\":\"105\",\"weight_unit\":\"kg\"}'::jsonb)).result")" "105"
ok "soft delete of a valid attempt still works" "$(as "$MEMBER" authenticated "select event_delete_attempt('$A1')")" '"deleted": true'

# ======================================================================
section "No writer can skip the trigger"
err "service_role direct insert of an invalid Max Effort attempt refused" \
  "$(as - service_role "insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, weight_unit, format_snapshot, format_config_snapshot) values ('$LOAD', '$G1', '$M6', gen_random_uuid(), 'rx', 'abc', 'kg', 'Max Effort', '{\"scoreUnit\":\"load\"}')")" "invalid_score_for_format"
err "table owner direct insert of an invalid Max Effort attempt refused" \
  "$(root "insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, format_snapshot, format_config_snapshot) values ('$REPS', '$G1', '$M6', gen_random_uuid(), 'rx', '1.5', 'Max Effort', '{\"scoreUnit\":\"reps\"}')")" "invalid_score_for_format"
err "a forged snapshot without scoreUnit is refused" \
  "$(as - service_role "insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, format_snapshot, format_config_snapshot) values ('$REPS', '$G1', '$M6', gen_random_uuid(), 'rx', '10', 'Max Effort', '{}')")" "score_type_missing"
err "members still cannot insert attempts directly at all" \
  "$(as "$MEMBER" authenticated "insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, format_snapshot) values ('$REPS', '$G1', '$MEMBER', gen_random_uuid(), 'rx', '10', 'Max Effort')")" "permission denied"
err "event_ack/forge helpers: anon cannot call the new CHECK helper" "$(as - anon "select forge_events_max_effort_unit_valid('load')")" "permission denied"
err "authenticated cannot call the trigger function" "$(as "$MEMBER" authenticated "select event_attempts_validate_max_effort()")" "permission denied"

# ======================================================================
section "Legacy rows after hardening"
err "new scores on the legacy event are refused (score_type_missing)" "$(submit "$MEMBER" "$LEGACY" '{"result":"100"}')" "score_type_missing"
ok "the legacy attempt can still be soft-deleted (no score change)" "$(as "$MEMBER" authenticated "select event_delete_attempt('$LEGACY_ATT')")" '"deleted": true'
eq "legacy attempt keeps its original result" "$(root "select result from event_attempts where id = '$LEGACY_ATT'")" "lots"
err "editing the legacy event requires fixing its config first (CHECK on UPDATE)" \
  "$(as "$ADMIN" authenticated "update events set title = 'Legacy Max (renamed)' where id = '$LEGACY'")" "events_max_effort_score_unit"

# ======================================================================
section "Every other v1 format keeps its Phase 1 behaviour"
AMRAP=$(new_scored '{"durationSec":720}' 'AMRAP')
as "$MEMBER" authenticated "select event_join('$AMRAP')" >/dev/null
ok "AMRAP rounds + reps accepted unchanged" "$(submit "$MEMBER" "$AMRAP" '{"result":"7 runde + 12"}')" "-"
ok "AMRAP with a weight_unit still accepted (unchanged Phase 1 rule)" "$(submit "$MEMBER" "$AMRAP" '{"result":"8 runde complete","weight_unit":"kg"}')" "-"
FT=$(new_scored '{"timeCapSec":600}' 'For Time')
as "$MEMBER" authenticated "select event_join('$FT')" >/dev/null
ok "For Time finish + capped accepted unchanged" "$(submit "$MEMBER" "$FT" '{"time_result":"9:58","completion_state":"completed"}') $(submit "$MEMBER" "$FT" '{"result":"143 reps","completion_state":"capped"}')" "-"

echo
echo "RESULT: $PASS passed, $FAIL failed"
for f in "${FAILED[@]}"; do echo "  - $f"; done
[ "$FAIL" -eq 0 ]
