-- TEMPORARY diagnostic function, live grant verification only - dropped by
-- the immediately following migration once confirmed. Never called by
-- application code.
create or replace function __p0_check_grants()
returns table (role_name text, can_execute boolean)
language sql
security definer
set search_path = public
as $$
  select 'anon', has_function_privilege('anon', 'm9_resend_invitation(uuid,uuid,uuid,text)', 'execute')
  union all
  select 'authenticated', has_function_privilege('authenticated', 'm9_resend_invitation(uuid,uuid,uuid,text)', 'execute')
  union all
  select 'service_role', has_function_privilege('service_role', 'm9_resend_invitation(uuid,uuid,uuid,text)', 'execute');
$$;
grant execute on function __p0_check_grants() to service_role;
revoke execute on function __p0_check_grants() from public, anon, authenticated;
