-- Config structurat pentru Hero WOD-uri custom, acelasi vocabular ca
-- wods.format_config. Coloana `format` (text, "TIP mm:ss") ramane sursa de
-- adevar pentru afisarea rapida in liste si pentru Hero WOD-urile vechi;
-- format_config/format_type sunt null pentru ele pana la o editare noua.
alter table custom_hero_wods add column if not exists format_config jsonb;
alter table custom_hero_wods add column if not exists format_type text;

-- Migrare non-distructiva a datelor vechi: extrage tipul din prima parte a
-- lui `format` (acelasi principiu ca parseHeroFormat() din App.jsx), fara sa
-- atinga coloana `format` originala.
update custom_hero_wods set format_type = (
  select f from (values ('AMRAP'),('For Time'),('EMOM'),('Tabata'),('Chipper'),
    ('Ladder'),('Partner WOD'),('Strength'),('RFT'),('Death By'),('Intervals'),
    ('Buy-In/Cash-Out'),('Strength Sets'),('Build to Heavy/1RM'),('Complex'),
    ('Superset'),('Not For Time'),('Max Effort')) as t(f)
  where format like f || '%' order by length(f) desc limit 1
) where format_type is null;
