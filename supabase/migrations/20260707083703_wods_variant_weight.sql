-- Greutate prescrisa per varianta (RX/Intermediate/Beginner/OnRamp) - text
-- liber (ex. "61/43kg"), setata de admin la fiecare WOD. Folosita ca sa
-- comparam cu greutatea efectiv logata de membru si sa detectam "Not RXd"
-- (vezi wod_logs.weight_logged din migratia urmatoare).
alter table wods add column if not exists rx_weight text;
alter table wods add column if not exists intermediate_weight text;
alter table wods add column if not exists beginner_weight text;
alter table wods add column if not exists onramp_weight text;
