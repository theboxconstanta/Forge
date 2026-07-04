-- Nume optional pentru sectiunea de Skill (la fel ca wods.name pentru WOD-ul principal),
-- afisat pe ecranul principal dupa bara verticala cand membrul si-a logat skill-ul zilei.
alter table wods add column if not exists skill_name text;

-- Log simplu pentru Skill Work, separat de wod_logs (fara variante/rezultat scoring -
-- skill-ul e acelasi pentru toata lumea, doar o nota optionala si un marcaj de "facut").
-- Un singur log per membru per WOD (upsert la re-salvare = editare).
create table if not exists skill_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users(id) on delete cascade,
  wod_id uuid references wods(id) on delete cascade,
  notes text,
  logged_at timestamptz not null default now(),
  unique (member_id, wod_id)
);

alter table skill_logs enable row level security;

drop policy if exists "skill_logs_select_all" on skill_logs;
drop policy if exists "skill_logs_insert_own" on skill_logs;
drop policy if exists "skill_logs_update_own" on skill_logs;
drop policy if exists "skill_logs_delete_own" on skill_logs;
create policy "skill_logs_select_all" on skill_logs for select to authenticated using (true);
create policy "skill_logs_insert_own" on skill_logs for insert to authenticated with check (member_id = auth.uid());
create policy "skill_logs_update_own" on skill_logs for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "skill_logs_delete_own" on skill_logs for delete to authenticated using (member_id = auth.uid());

alter table skill_logs replica identity full;
alter publication supabase_realtime add table skill_logs;
