alter table subscriptions add column if not exists queued boolean not null default false;
