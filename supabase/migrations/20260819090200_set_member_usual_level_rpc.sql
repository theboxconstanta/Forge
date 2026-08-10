-- Coach Quick Create Phase 1 - coach-editable "Usual Level" (see
-- 20260819090100_profiles_usual_level.sql for the column + the member
-- self-service write path, which needs no RLS change since
-- profiles_update_own already covers it).
--
-- A coach/admin editing ANOTHER member's usual_level has no existing RLS
-- path at all: profiles' only UPDATE policy is own-row-only. A narrow
-- SECURITY DEFINER RPC, scoped to exactly this one column, is deliberately
-- chosen over a blanket admin-write policy on `profiles` - the latter
-- would be new, broad attack surface (every profiles column becomes
-- coach/admin-writable) for a need that's genuinely one field.

create or replace function set_member_usual_level(p_member_id uuid, p_usual_level text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_gym_id uuid;
begin
  if p_usual_level is not null and p_usual_level not in ('rx', 'intermediate', 'beginner', 'onramp') then
    raise exception 'invalid usual_level: %', p_usual_level;
  end if;

  select gym_id into v_member_gym_id from profiles where id = p_member_id;
  if v_member_gym_id is null then
    raise exception 'member not found or has no gym';
  end if;

  if not is_coach_or_admin(v_member_gym_id) then
    raise exception 'only a coach/admin can set another member''s usual level';
  end if;

  update profiles set usual_level = p_usual_level where id = p_member_id;
end;
$$;

grant execute on function set_member_usual_level(uuid, text) to authenticated;
