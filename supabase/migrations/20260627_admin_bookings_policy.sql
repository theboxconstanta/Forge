-- Permite adminului sa stearga rezervarile oricarui membru
-- Necesar pentru functia stergeAbonament (cancel subscription = sterg rezervarile viitoare)
CREATE POLICY IF NOT EXISTS "Admin can delete any booking"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'luciandorinrosca@gmail.com'
  );
