-- Redenumire sala (Admin > Setari, orice admin al ei) trebuie sa se vada
-- instant in header/la ceilalti membri cu sesiunea deschisa, fara reload -
-- App.jsx asculta deja UPDATE pe `gyms` prin channel-ul realtime-app, dar
-- tabelul nu era inca in publicatia supabase_realtime (spre deosebire de
-- classes/bookings etc.), deci evenimentul nu ajungea niciodata la client.
alter publication supabase_realtime add table gyms;
