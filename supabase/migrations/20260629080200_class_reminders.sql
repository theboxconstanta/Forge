drop table if exists class_reminder_log;

create table if not exists class_reminders (
  id           uuid default gen_random_uuid() primary key,
  class_id     uuid references classes(id) on delete cascade,
  member_email text not null,
  remind_at    timestamptz not null,
  sent         boolean default false,
  unique (class_id, member_email)
);

create index if not exists class_reminders_due on class_reminders(remind_at) where sent = false;
