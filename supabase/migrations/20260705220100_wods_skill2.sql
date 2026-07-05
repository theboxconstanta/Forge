-- Al doilea bloc de Skill Work la un WOD, oglinda completa a skill/skill_name/
-- skill_type/skill_format_config existente - independent, cu propriul format
-- si propriile miscari, afisat ca sectiune separata "SKILL 2" pe Acasa.
alter table wods add column if not exists skill2 text[];
alter table wods add column if not exists skill2_name text;
alter table wods add column if not exists skill2_type text not null default 'Weightlifting';
alter table wods add column if not exists skill2_format_config jsonb;
