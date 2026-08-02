-- M10.1 Owner Authentication - lock down default-privilege auto-grants.
--
-- Found during production verification, not assumed safe: this project has
-- a schema-level ALTER DEFAULT PRIVILEGES rule (role postgres, object type
-- "r"/relations, schema public) that auto-grants privileges to every newly
-- created table - the same class of hazard already documented for newly
-- created FUNCTIONS (the m9_final_commit_* / M9.1 grant-lockdown history),
-- now confirmed, live, to also apply to TABLES. gym_activation_state and
-- gym_commercial_state (created in 20260801100000) inherited this: anon
-- held INSERT/UPDATE/DELETE/TRUNCATE, and authenticated held UPDATE/DELETE/
-- TRUNCATE beyond the SELECT this migration's own table intends it to have.
-- RLS (enabled on both tables, with no permissive policy for either
-- capability) already denied any actual exploitation of this - but per
-- PENDING_OWNER_IMPLEMENTATION_CONTRACT.md's own "Invariant 4: impossible
-- outside Bootstrap, enforced structurally, not by convention" and this
-- project's established practice of never relying on RLS alone
-- (FINANCIAL_DOMAIN_ARCHITECTURE.md Section 8.4), the underlying grant is
-- locked down explicitly here rather than left to rely on RLS as the only
-- layer.
--
-- Scope, explicit: this migration corrects the two tables M10.1 owns. The
-- default-privileges rule itself is project-wide and almost certainly
-- affects other, unrelated tables created the same way - fixing that root
-- cause is out of scope for M10.1 and is named as a remaining risk in
-- M10.1's own implementation report, not silently fixed here.

revoke insert, update, delete, truncate on table gym_activation_state from anon, authenticated;
revoke select, references, trigger on table gym_activation_state from anon;

revoke insert, update, delete, truncate on table gym_commercial_state from anon, authenticated;
revoke select, references, trigger on table gym_commercial_state from anon;

-- authenticated keeps exactly select (RLS-scoped by gym_activation_state_
-- select_admin / gym_commercial_state_select_admin) - nothing else.
