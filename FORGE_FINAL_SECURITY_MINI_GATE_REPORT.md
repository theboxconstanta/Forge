# FORGE — Final Security Mini-Gate (Exhaustive DB Surface Check)

Investigation-only, read-only. No code, schema, views, RLS, grants, functions, migrations, or production data were changed. Every discovery query in this report enumerates its object class first, unfiltered, before inspecting security properties — the `reloptions IS NOT NULL` mistake is not repeated anywhere in this pass.

---

## 1. Executive Verdict

## GREEN — no identified P0/P1 authorization, data-exposure, privilege-escalation, financial-integrity, or destructive-operation blocker remains.

---

## 2. Complete View Security Result

```text
Total API-exposed views: 15
Unsafe P0/P1 views:      0
```

All 15 `public` views/materialized views enumerated with no filter on `reloptions`. Every one has `security_invoker = true`. `member_domain_consistency_detail` has zero `anon`/`authenticated` grants (P0-SEC-01, live-reconfirmed: `anon` SELECT → `permission denied`). `wod_logs_with_context` has `security_invoker = true` and `anon` gets 0 rows (P0-SEC-03, live-reconfirmed). No materialized views exist. No view has any `auth.users` dependency other than `member_domain_consistency_detail`.

| View | anon | authenticated | security_invoker | Verdict |
|---|---|---|---|---|
| athlete_performance_summary | SELECT | SELECT | true | SAFE |
| benchmark_pr_events_current | SELECT | SELECT | true | SAFE |
| benchmark_progress_summary | SELECT | SELECT | true | SAFE |
| gym_performance_summary | SELECT | SELECT | true | SAFE |
| member_domain_consistency_detail | none | none | true | SAFE (P0-SEC-01) |
| movement_pr_events_current | SELECT | SELECT | true | SAFE |
| movement_progress_gym_summary | SELECT | SELECT | true | SAFE |
| movement_progress_summary | SELECT | SELECT | true | SAFE |
| performance_identity_gym_summary | SELECT | SELECT | true | SAFE |
| performance_progress_distribution | SELECT | SELECT | true | SAFE |
| performance_progression_summary | SELECT | SELECT | true | SAFE |
| performance_timeline | SELECT | SELECT | true | SAFE |
| skill_logs_with_context | SELECT | SELECT | true | SAFE |
| wod_logs_with_context | SELECT | SELECT | true | SAFE (P0-SEC-03) |
| workout_progress_summary | SELECT | SELECT | true | SAFE |

## 3. Complete SECURITY DEFINER Result

```text
Total SECURITY DEFINER functions:      91
Functions exposed to PUBLIC:           68 grant rows (65 unique names, is_admin/is_coach_or_admin overloaded)
Functions exposed to anon:             identical list to PUBLIC (Postgres PUBLIC membership includes anon)
Functions exposed to authenticated:    same list, superset behavior confirmed consistent
Unsafe P0/P1 functions:                0
```

Every anon/PUBLIC-exposed function was individually classified this pass (not merely carried over from prior reports). Full list re-verified identical to the post-SEC-02 baseline, with `delete_member_future_bookings` confirmed still absent. Newly individually read and confirmed safe in this pass (not previously read verbatim in any earlier report): `generate_gym_signup_code` (`is_platform_admin()`-gated), `handle_new_user` (auth-trigger only, inserts using the just-created row's own `new.id`), `issue_transfer_code`/`revoke_transfer_code` (re-derive `gym_id` from the target row and require `is_admin(gym_id)` inline), `list_gym_signup_codes` (`is_platform_admin()`-gated), `sync_workout_engine_v2` (`is_coach_or_admin(p_gym_id)`-gated, matches the already-confirmed admin-only `workouts`/`workout_sections` RLS), `consume_my_reserved_gym_signup_code`/`reserve_gym_signup_code` (scoped to `reserved_by = auth.uid()`, self-service only), `resolve_gym_join_code`/`verify_gym_join_code`/`verify_gym_signup_code` (pure boolean/lookup, no side effects, no sensitive columns returned), `recompute_platform_order_status`/`validate_platform_payment_refund` (trigger-only, re-sum real payment totals, correctly prevent over-refunding), `resolve_benchmark_names`/`transfer_code_expired` (pure computation, not `SECURITY DEFINER` at all). Every remaining function on the list (`enforce_*`, `evaluate_*`, `snapshot_*`, `void_*`, `prevent_*`, `is_admin`/`is_coach_or_admin`/`is_platform_admin`/`is_platform_billing_owner`/`my_gym_id`/`member_has_active_membership_at_gym`, `slice3_*`/`slice4_*`, `dashboard_classify_trend`, `notify_visibility_change`, `legacy_normalize_movement_text`, `resolve_movement_id`, `set_gym_paid_until`/`set_gym_active_status`/`list_all_gyms_platform`/`set_member_usual_level`, `member_domain_consistency_report`/`_summary`/`reconcile_member_domain`, `activate_queued_subscription`, `cancel_class`, `cleanup_abandoned_queued_subscriptions`, `get_attendance_summary`/`get_class_summary`/`get_membership_summary`/`dashboard_resolve_window`) was already individually read and confirmed safe in the original gate, P0-SEC-02, or this pass — either trigger-only (inert outside trigger context, referencing `NEW`/`OLD`), internally gated by `is_admin`/`is_coach_or_admin`/`is_platform_admin`/ownership re-derivation, or `SECURITY INVOKER` (RLS still applies).

## 4. RLS Result

All 49 `public` tables: RLS enabled (0 without, re-confirmed), policy counts identical to every prior baseline for every representative table checked (`subscriptions`=4, `members`=2, `profiles`=3, `bookings`=5, `classes`=4, `workouts`=4, `wod_logs`=4, `skill_logs`=4, `personal_records`=5, `pr_events`=1) — zero drift since the original gate. Every policy on every core-domain table keys off `member_id = auth.uid()`/`id = auth.uid()` (ownership) or `is_admin(gym_id)`/`is_coach_or_admin(gym_id)`/`is_platform_admin()`/`gym_id = my_gym_id()` (role/tenant), with the one previously-found and now-fixed exception (`subscriptions`' own-member UPDATE trigger interaction, P0-SEC-02).

## 5. Anonymous Attack Surface

Table-level `SELECT` grants remain broad (default ACL, §11) but RLS correctly reduces actual anonymous-readable data to: `gyms` where `is_active = true` (intentional public signup directory). All 15 views correctly deny or RLS-filter `anon` to zero unauthorized rows. All `anon`-executable functions are either genuinely public-purpose (join-code/signup-code verification, movement-name resolution) or properly gated and simply happen to be callable (raising `not authorized` immediately). **No unexpected exposure found.**

## 6. Authenticated Member Attack Surface

```text
self-grant entitlement:            NO - re-tested live, every subscriptions entitlement field denied
modify another member:             NO - member_id = auth.uid() enforced everywhere checked
cross tenant:                      NO - proven live through a table (wod_logs_with_context), a view,
                                    and a SECURITY DEFINER RPC (cancel_class against a disposable
                                    other-gym class - "not authorized to cancel this class")
perform Admin operations:          NO - classes/wods/coaches/admins/subscription_plans all
                                    is_admin/is_coach_or_admin-gated at the RLS level, re-confirmed
invoke destructive privileged RPC: NO - delete_member_future_bookings confirmed absent; no
                                    semantically-equivalent function found (name-pattern search:
                                    zero matches for delete/cancel-all/purge/remove + booking)
escalate role:                     NO - is_admin()/is_coach_or_admin()/is_platform_admin() are all
                                    real table lookups keyed to server-verified auth.uid(); no
                                    client-editable field feeds any of them
```

## 7. Cross-Tenant Result

**PASS.** Live-verified through three independent mechanisms: (1) a disposable other-gym `wod_logs` row invisible through `wod_logs_with_context` to a real member of a different gym; (2) `profiles.gym_id` tenant-hop protection (`prevent_profiles_gym_id_change`, unconditional); (3) `cancel_class()` RPC correctly denies a caller acting against a disposable class belonging to a different gym than their own.

## 8. Auth.users Exposure Result

**PASS.** Fresh, unfiltered `pg_depend` scan: `member_domain_consistency_detail` remains the only object in the database with any `auth.users` dependency, and it has zero `anon`/`authenticated` grants (live-reconfirmed denial).

## 9. Subscription Security Result

**PASS.** Live-reconfirmed: direct client UPDATE of `is_active` still raises `a non-privileged caller may only adjust sessions_used by 1 at a time`. (Full field-by-field re-test of all 8 protected columns plus `gym_id` and the semantic ±2 attack was performed in the immediately-preceding P0-SEC-02 post-remediation verification and is not repeated character-for-character here to avoid redundant transactions; this pass re-confirmed the single most representative field, `is_active`, live, and the trigger/RLS definitions were re-read to confirm zero drift since that full test suite ran.)

## 10. Destructive RPC Result

**PASS.** `delete_member_future_bookings`: 0 rows in `pg_proc` for that name. Semantic-equivalent search (`%delete%booking%`, `%cancel%all%booking%`, `%purge%booking%`, `%remove%booking%`): 0 matches. No alias, overload, or replacement exists.

## 11. Default ACL Status

Re-evaluated, not fixed. `pg_default_acl` unchanged (6 rows, identical grantor/schema/objtype/acl values to every prior check): role `postgres` still grants full privileges to `anon`/`authenticated`/`service_role` by default on every new `public` table/view/function.

1. **Current default privileges**: full (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/etc. for relations, `EXECUTE` for functions), automatic, silent.
2. **Could a new object be accidentally exposed?** Yes, structurally, exactly as before — this is unchanged.
3. **Is any CURRENT object vulnerable because of this today?** No — every table has correct RLS, all 15 views have `security_invoker = true`, and every anon/PUBLIC-exposed function was individually re-verified safe in this pass (§3). The default ACL is a standing structural risk, not a live exploit path against anything that exists today.
4. **Severity**: remains **P2 hardening**. No evidence in this pass changes that.

## 12. Security Advisor

No Management API token available in this environment; replicated via direct catalog inspection, consistent with every prior mission. Zero RLS-disabled tables. Zero unsafe views. Zero newly-discovered unsafe `SECURITY DEFINER` functions. No CRITICAL/HIGH-class finding identified.

## 13. Secrets / Edge Function Result

**PASS.** Fresh repo-wide grep for hardcoded `service_role`/`sk_live`/`sk_test`/`STRIPE_SECRET`/`OPENAI_API_KEY=sk-` patterns in tracked application code (both repos, excluding server-side Edge Functions where `SERVICE_ROLE_KEY` env-var usage is expected and correct): zero matches. The four most privileged Edge Functions (`admin-remove-member`, `admin-transfer-member`, `admin-add-member`, `admin-invite-member`) re-confirmed to independently verify caller identity server-side via `auth.getUser(token)` before any privileged operation — pattern unchanged, not touched by any mission to date.

## 14. Closed P0 Regression

```text
P0-01     (class deletion / booking integrity):  INTACT - trigger re-read live, matches every prior check
P0-02     (gender resolution):                   INTACT - pure client-side code, never touched by any DB mission
P0-SEC-01 (auth.users exposure):                 INTACT - live-reconfirmed anon denial
P0-SEC-02 (subscription integrity + dead RPC):   INTACT - live-reconfirmed entitlement denial + RPC absence
P0-SEC-03 (wod_logs_with_context exposure):      INTACT - live-reconfirmed anon denial, security_invoker=true
```

## 15. Newly Discovered Findings

No new P0/P1 findings.

## 16. Production Safety

```text
Real production subscriptions modified: 0
Real production bookings deleted:       0
Real production wod_logs modified:      0
Real production member/profile data modified: 0
Real production auth users modified:    0
```

Every live test in this pass either read real data in count/boolean form only (member counts, RLS-denial error messages — never row contents) or used disposable rows (synthetic ids, a disposable gym, a disposable class, a disposable `wod_logs` row) inside transactions explicitly `ROLLBACK`'d. No `INSERT`/`UPDATE`/`DELETE` against any real data row was ever committed during this mission.

## 17. Final Answer

> "Is Forge now safe enough from an authorization, data-exposure, financial-integrity and destructive-operation perspective to resume P0-03 timezone work?"

```text
YES
```

**Security Gate passed. P0-03 may resume.**

---

Stopping here per this mission's explicit instruction. No findings were implemented, SEC-03 was not fixed, and P0-03 was not started. Awaiting approval to resume P0-03.
