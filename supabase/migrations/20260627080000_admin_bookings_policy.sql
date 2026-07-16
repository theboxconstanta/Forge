DROP POLICY IF EXISTS "Admin can delete any booking" ON bookings;

CREATE POLICY "Admin can delete any booking"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'luciandorinrosca@gmail.com'
  );
