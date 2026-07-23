-- Forge Admin Web M13.2 (Live Data Consistency, initial rollout): adds
-- `profiles` and `subscription_plans` to the supabase_realtime publication
-- so Admin Web's Members and Plans modules can subscribe to live changes,
-- matching `subscriptions` (already enabled, used by the Member App).
--
-- Purely additive: no RLS, grant, trigger, or business-logic change - this
-- only lets Postgres emit a change-notification event for these tables to
-- subscribed Realtime clients, in addition to the existing REST/RLS path
-- that remains completely unchanged. Every consuming subscription in
-- Admin Web filters server-side by gym_id (see src/lib/realtime.ts), so a
-- client only ever receives change events for its own gym's rows.
--
-- Deliberately excludes `orders` and `payments` (Financial Domain) for
-- this initial rollout, per explicit product decision - those remain
-- realtime-isolated until a separate, explicit approval. The generic
-- sync layer this accompanies is designed so adding them later is a
-- one-line addition to a component's subscription list, not an
-- architecture change.

alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table subscription_plans;
