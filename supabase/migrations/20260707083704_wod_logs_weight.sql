-- Greutatea efectiv folosita de membru la logarea unui WOD scored (AMRAP/For
-- Time/RFT/Ladder etc.) - text liber, comparat cu wods.<varianta>_weight ca
-- sa detectam "Not RXd" (vezi isNotRxd in workoutFormats.js).
alter table wod_logs add column if not exists weight_logged text;
