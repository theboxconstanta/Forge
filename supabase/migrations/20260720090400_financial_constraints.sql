-- Financial Domain Phase 0, migration 4/7: constraints beyond what the
-- CREATE TABLE statements already declared inline.

-- Finding 2 (Structural Validation): "the stated Subscription 1:1 Order
-- cardinality is not structurally enforced" - closes that gap.
alter table orders
  add constraint orders_subscription_id_unique unique (subscription_id);

-- Finding 3 (Structural Validation, accepted in ADR-002): webhook delivery
-- from any future payment provider is documented at-least-once elsewhere in
-- this domain (Stripe); without this, a duplicate delivery creates two
-- Payment rows for one real charge, double-counting revenue. Zero cost
-- today - no provider integration exists yet, so no rows populate these
-- columns. Postgres does not treat repeated NULLs as duplicates under a
-- plain UNIQUE constraint, so rows without a provider reference are
-- unaffected.
alter table payments
  add constraint payments_provider_reference_unique unique (provider, provider_reference);

-- Rollback:
-- alter table orders drop constraint orders_subscription_id_unique;
-- alter table payments drop constraint payments_provider_reference_unique;
