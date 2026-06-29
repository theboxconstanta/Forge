alter table subscription_plans add column if not exists duration_months integer not null default 1;
