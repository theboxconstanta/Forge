create table if not exists class_waitlist (
  id           uuid default gen_random_uuid() primary key,
  class_id     uuid references classes(id) on delete cascade,
  member_id    uuid references profiles(id) on delete cascade,
  member_email text not null,
  joined_at    timestamptz default now(),
  unique (class_id, member_id)
);

create index if not exists class_waitlist_class on class_waitlist(class_id, joined_at);
