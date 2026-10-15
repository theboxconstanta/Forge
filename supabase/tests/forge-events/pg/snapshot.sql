-- Catalog fingerprint of public + storage (functions with body + ACL, tables
-- with ACL + RLS flag, policies, realtime publication, buckets, triggers).
-- setup.sh records it before the migration; rollback-pg.sh compares.
select md5(string_agg(x, '|' order by x)) from (
  select 'f:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '') x
    from pg_proc p where p.pronamespace in ('public'::regnamespace, 'storage'::regnamespace) and p.prokind = 'f'
  union all select 't:' || n.nspname || '.' || c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'storage') and c.relkind in ('r', 'v', 'S', 'i')
  union all select 'p:' || schemaname || '.' || tablename || '.' || policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies
  union all select 'pub:' || schemaname || '.' || tablename from pg_publication_tables where pubname = 'supabase_realtime'
  union all select 'b:' || id || ':' || public from storage.buckets
  union all select 'trg:' || tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal) s;
