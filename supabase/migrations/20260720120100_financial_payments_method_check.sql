-- Phase 4, migration 1/4: canonicalize payments.method.
-- The column already existed (Phase 0) but was never constrained and has
-- never been populated by any code path - this closes that gap per the
-- approved Phase 4 design review.
--
-- 'comp' stays in the allowed vocabulary despite being explicitly excluded
-- from the public/UI-facing model (approved decision) - register_payment's
-- existing internal rule (`if p_method = 'comp' and p_amount <> 0 then
-- raise exception`) already relies on being able to pass method='comp';
-- excluding it here would break that existing internal mechanism, which
-- the approved decision says to leave unchanged.
--
-- method stays nullable, not NOT NULL: activate_queued_subscription's
-- transcription of a pre-cutover legacy-notes payment may genuinely have
-- no known method (the old system never recorded one) - forcing a value
-- would mean fabricating one.
--
-- No 'other' - per explicit decision, an unrecognized future channel
-- requires an architecture review to add, not a silent escape hatch.

alter table payments add constraint payments_method_check
  check (method is null or method in ('cash', 'card', 'bank_transfer', 'comp'));

-- Rollback: alter table payments drop constraint payments_method_check;
