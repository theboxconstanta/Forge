-- Scoring Model Architecture Phase 0 (SCORING_MODEL_ARCHITECTURE_VNEXT.md
-- sectiunea 11) - starea de finalizare a unui rezultat Duration-based
-- (COMPLETED vs CAPPED) nu mai e doar dedusa implicit la citire din
-- prezenta/absenta lui time_result (exact tiparul de bug care a permis
-- LEADERBOARD_FINISH_TIME_INVESTIGATION.md) - e scrisa explicit, o singura
-- data, la acelasi punct de decizie care compune deja result/time_result
-- (composeFortimeOrAmrapFields / deriveDurationCompletionState in
-- workoutFormats.js), niciodata re-dedusa separat.
--
-- Aditiv, nullable, fara backfill: randurile existente raman NULL si
-- ranking.ts/sortLogs cad pe inferenta veche (!!time_result) pt ele -
-- comportament byte-identic cu azi pt orice log deja existent. Doar
-- 'completed'/'capped' sunt scrise de vreun cod curent - 'dnf'/'dns' raman
-- in vocabular doar pt compatibilitate viitoare (nu exista azi un flux UI
-- care sa produca un log complet gol, vezi `areContiut` in App.jsx).
alter table wod_logs add column if not exists completion_state text;

alter table wod_logs drop constraint if exists wod_logs_completion_state_check;
alter table wod_logs add constraint wod_logs_completion_state_check
  check (completion_state is null or completion_state in ('completed', 'capped', 'dnf', 'dns'));
