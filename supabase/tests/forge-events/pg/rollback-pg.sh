#!/usr/bin/env bash
# FORGE EVENTS Phase 1B - rollback behaviour on real PostgreSQL.
# Runs INSIDE the disposable container AFTER run-pg.sh (Events data exists).
# Destroys Events data ONLY inside this disposable database.
set -u
PSQL="psql -U postgres -d postgres -X -q -At"
PASS=0; FAIL=0; FAILED=()
pass() { PASS=$((PASS+1)); echo "  PASS $1"; }
fail() { FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  FAIL $1 :: $2"; }
root() { $PSQL -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
eq()  { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$3', got '$2'"; fi; }
err() { case "$2" in *ERROR*"$3"*) pass "$1";; *) fail "$1" "expected error '$3', got: $2";; esac; }
G1=11111111-1111-1111-1111-111111111111

DATA="select md5(string_agg(h, '|' order by h)) from (
  select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) h from classes t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from bookings t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from subscriptions t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from memberships t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from profiles t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from app_settings t) x"
BASE_SNAP=$(cat /work/base_snapshot.txt)
DATA_BEFORE=$(root "$DATA")

echo "[Rollback on real PostgreSQL]"
ROWS=$(root "select count(*) from events")
OUT=$($PSQL -v ON_ERROR_STOP=1 -f /work/rollback.sql 2>&1)
err "refuses while Events rows exist ($ROWS events)" "$OUT" "rollback aborted"
eq "nothing dropped after refusal" "$(root "select count(*) from pg_class where relname = 'events' and relnamespace = 'public'::regnamespace")" "1"

root "insert into storage.objects (bucket_id, name) values ('event-covers', '$G1/e/cover.jpg')" >/dev/null
OUT=$($PSQL -v ON_ERROR_STOP=1 -c "select set_config('forge.events_rollback_confirm', 'destroy-event-data', false)" -f /work/rollback.sql 2>&1)
err "refuses while event-covers still holds objects (even when confirmed)" "$OUT" "still contains objects"
root "set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'event-covers'" >/dev/null

# Phase 3.2 hardening (when applied) is rolled back FIRST, then Phase 1.
if [ -f /work/hardening.rollback.sql ] && [ "$(root "select to_regprocedure('public.event_attempts_validate_max_effort()') is not null")" = "t" ]; then
  OUT=$($PSQL -v ON_ERROR_STOP=1 -f /work/hardening.rollback.sql 2>&1)
  case "$OUT" in *ERROR*) fail "hardening rollback runs" "$OUT";; *) pass "hardening rollback runs";; esac
  eq "hardening objects gone" "$(root "select (select count(*) from pg_proc where proname in ('forge_events_max_effort_unit_valid', 'event_attempts_validate_max_effort')) + (select count(*) from pg_constraint where conname = 'events_max_effort_score_unit')")" "0"
fi
OUT=$($PSQL -v ON_ERROR_STOP=1 -c "select set_config('forge.events_rollback_confirm', 'destroy-event-data', false)" -f /work/rollback.sql 2>&1)
case "$OUT" in *ERROR*) fail "confirmed rollback runs" "$OUT";; *) pass "confirmed rollback runs";; esac
eq "no Events tables left" "$(root "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'event%'")" "0"
eq "no Events functions left" "$(root "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'event%' or proname like 'forge_events%' or proname = 'my_pending_event_announcements')")" "0"
eq "no event_covers policies left" "$(root "select count(*) from pg_policies where policyname like 'event_covers%'")" "0"
eq "publication back to the pre-migration tables" "$(root "select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'")" "app_settings,bookings,classes"
eq "catalog identical to the pre-migration snapshot" "$($PSQL -f /work/pg/snapshot.sql 2>&1)" "$BASE_SNAP"
eq "pre-existing data untouched by the rollback" "$(root "$DATA")" "$DATA_BEFORE"

OUT=$($PSQL -v ON_ERROR_STOP=1 -1 -f /work/migration.sql 2>&1)
case "$OUT" in *ERROR*) fail "migration re-applies cleanly after rollback" "$OUT";; *) pass "migration re-applies cleanly after rollback";; esac
if [ -f /work/hardening.sql ]; then
  OUT=$($PSQL -v ON_ERROR_STOP=1 -1 -f /work/hardening.sql 2>&1)
  case "$OUT" in *ERROR*) fail "hardening re-applies cleanly after rollback" "$OUT";; *) pass "hardening re-applies cleanly after rollback";; esac
fi
eq "re-applied: 5 tables, 4 storage policies, 3 publication tables" \
  "$(root "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'event%') || ',' ||
                  (select count(*) from pg_policies where policyname like 'event_covers%') || ',' ||
                  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'event%')")" "5,4,3"

echo
echo "RESULT: $PASS passed, $FAIL failed"
for f in "${FAILED[@]}"; do echo "  - $f"; done
[ "$FAIL" -eq 0 ]
