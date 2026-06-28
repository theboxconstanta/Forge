-- Activeaza realtime pe tabela subscriptions
-- Fara REPLICA IDENTITY FULL, Supabase nu poate evalua RLS pe DELETE events
ALTER TABLE subscriptions REPLICA IDENTITY FULL;

-- Adauga tabela in publicatia realtime (daca nu e deja)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions;
  END IF;
END $$;
