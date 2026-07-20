-- Financial Domain Phase 0, migration 3/7: indexes.
-- orders.subscription_id and payments.(provider, provider_reference) get
-- their indexes for free from the UNIQUE constraints added in migration
-- 4/7 - not duplicated here.

create index orders_gym_id_idx on orders (gym_id);
create index orders_client_id_idx on orders (client_id);
create index orders_status_idx on orders (status);

create index payments_order_id_idx on payments (order_id);
create index payments_gym_id_idx on payments (gym_id);
create index payments_original_payment_id_idx on payments (original_payment_id)
  where original_payment_id is not null;

-- Rollback:
-- drop index if exists orders_gym_id_idx;
-- drop index if exists orders_client_id_idx;
-- drop index if exists orders_status_idx;
-- drop index if exists payments_order_id_idx;
-- drop index if exists payments_gym_id_idx;
-- drop index if exists payments_original_payment_id_idx;
