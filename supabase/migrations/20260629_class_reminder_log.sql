create table if not exists class_reminder_log (
  class_id  uuid references classes(id) on delete cascade,
  member_email text not null,
  sent_at timestamptz default now(),
  primary key (class_id, member_email)
);
