create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_email text not null unique,
  subscription jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists push_subscriptions_email_idx on push_subscriptions(member_email);

alter table push_subscriptions enable row level security;

create policy "Members manage own push subscription"
  on push_subscriptions for all
  using (member_email = auth.jwt() ->> 'email')
  with check (member_email = auth.jwt() ->> 'email');
