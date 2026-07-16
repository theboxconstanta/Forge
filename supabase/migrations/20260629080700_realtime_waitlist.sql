alter table class_waitlist replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'class_waitlist'
  ) then
    alter publication supabase_realtime add table class_waitlist;
  end if;
end $$;
