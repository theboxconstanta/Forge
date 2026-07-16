-- Workout Engine V2, Faza 5B - stabilizare inainte ca V2 sa devina modelul
-- principal de date. Doua probleme, o singura migratie (a doua depinde de
-- prima): identitate stabila a sectiunilor (slot_key) + sincronizare
-- atomica (RPC). Vezi discutia de arhitectura din aceeasi sesiune pt
-- justificarea completa a deciziilor de mai jos.

-- ============================================================
-- 1. slot_key - punte DELIBERAT limitata la sincronizarea legacy (wods ->
--    Workout Engine V2, Faza 5A) - NU un concept permanent. Odata ce
--    editorul va gestiona sectiuni nativ (adaugate/sterse/reordonate liber
--    de coach, fara sa derive din wods), acelea vor purta slot_key = null
--    si vor folosi id-ul lor real direct, fara nicio potrivire necesara.
--
--    De ce cheie pe ROL semantic (warmup/skill/skill2/metcon), nu pe
--    pozitie sau pe hash de continut: pozitia se schimba la reordonare
--    (viitoare), continutul se schimba la orice editare normala (typo
--    reparat etc.) - niciuna nu descrie identitatea reala a sectiunii,
--    doar rolul ei o face.
-- ============================================================

alter table workout_sections add column if not exists slot_key text;

-- Index unic PARTIAL (doar unde slot_key IS NOT NULL) - acelasi tipar ca
-- workout_section_types_platform_key_uidx (Faza 0): sectiunile native
-- viitoare (slot_key null) nu intra niciodata in coliziune intre ele sau cu
-- cele derivate din legacy, fiindca Postgres trateaza fiecare NULL ca
-- distinct intr-un index unic.
create unique index if not exists workout_sections_workout_slot_key_uidx
  on workout_sections (workout_id, slot_key) where slot_key is not null;

-- Backfill - sectiunile deja existente (Faza 2 backfill + testarea Fazei
-- 5A) nu au inca slot_key. row_number() partitionat pe (workout_id, tip),
-- ordonat dupa order_index - prima aparitie a unui tip primeste chiar
-- cheia tipului (ex. "skill"), a doua primeste tipul+numarul (ex.
-- "skill2") - exact schema de denumire deja folosita de editor azi,
-- derivata automat, nu hardcodata separat.
with ranked as (
  select ws.id, t.key as type_key,
    row_number() over (partition by ws.workout_id, t.key order by ws.order_index) as rn
  from workout_sections ws
  join workout_section_types t on t.id = ws.section_type_id
  where ws.slot_key is null
)
update workout_sections ws
set slot_key = case when ranked.rn = 1 then ranked.type_key else ranked.type_key || ranked.rn::text end
from ranked
where ws.id = ranked.id;

-- ============================================================
-- 2. sync_workout_engine_v2 - RPC atomic, singurul punct de scriere pt
--    sincronizarea legacy -> Workout Engine V2 de acum inainte (inlocuieste
--    upsert-ul separat pe `workouts` + delete/insert separat pe
--    `workout_sections` din Faza 5A). Primeste sectiunile DEJA MAPATE
--    (calculate in JS, de mapLegacyWodToWorkout - neschimbat) - functia
--    de aici face STRICT persistenta (upsert pe conflict, delete-uri
--    tintite), fara nicio logica de mapare/business duplicata in SQL.
--    Acelasi tipar (SECURITY DEFINER + verificare explicita de autorizare
--    in interior) ca set_gym_paid_until/adjust_session_count, deja in
--    proiect.
-- ============================================================

create or replace function sync_workout_engine_v2(
  p_gym_id uuid,
  p_date date,
  p_title text,
  p_legacy_wod_id uuid,
  p_sections jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workout_id uuid;
  v_section jsonb;
  v_type_id uuid;
  v_default_type_id uuid;
  v_keep_slot_keys text[];
begin
  if not is_coach_or_admin(p_gym_id) then
    raise exception 'not authorized';
  end if;

  insert into workouts (gym_id, date, title, legacy_wod_id)
  values (p_gym_id, p_date, p_title, p_legacy_wod_id)
  on conflict (gym_id, date) do update
    set title = excluded.title, legacy_wod_id = excluded.legacy_wod_id, updated_at = now()
  returning id into v_workout_id;

  select coalesce(array_agg(s ->> 'slotKey'), array[]::text[])
    into v_keep_slot_keys
  from jsonb_array_elements(p_sections) as s;

  -- sterge DOAR sloturile legacy care nu mai apar in lista noua (ex. coach
  -- a oprit vizibilitatea Warm-up) - niciodata sectiuni native (slot_key
  -- null), niciodata un delete general.
  delete from workout_sections
  where workout_id = v_workout_id
    and slot_key is not null
    and not (slot_key = any(v_keep_slot_keys));

  select id into v_default_type_id from workout_section_types where key = 'metcon' and gym_id is null;

  for v_section in select * from jsonb_array_elements(p_sections) loop
    select id into v_type_id
    from workout_section_types
    where key = (v_section ->> 'type') and gym_id is null;

    insert into workout_sections (
      workout_id, gym_id, section_type_id, slot_key, order_index, title, description,
      format, format_config, movements, scaling_versions, logging_mode, score_type,
      duration_minutes, benchmark_metadata, metadata
    )
    values (
      v_workout_id, p_gym_id, coalesce(v_type_id, v_default_type_id), v_section ->> 'slotKey',
      (v_section ->> 'order')::int, v_section ->> 'title', v_section ->> 'description',
      v_section ->> 'format', coalesce(v_section -> 'formatConfig', '{}'::jsonb),
      coalesce(v_section -> 'movements', '[]'::jsonb), coalesce(v_section -> 'scalingVersions', '[]'::jsonb),
      coalesce(v_section ->> 'loggingMode', 'none'), v_section ->> 'scoreType',
      (v_section ->> 'duration')::int, coalesce(v_section -> 'benchmarkMetadata', '{}'::jsonb),
      coalesce(v_section -> 'metadata', '{}'::jsonb)
    )
    on conflict (workout_id, slot_key) where slot_key is not null do update set
      section_type_id = excluded.section_type_id,
      order_index = excluded.order_index,
      title = excluded.title,
      description = excluded.description,
      format = excluded.format,
      format_config = excluded.format_config,
      movements = excluded.movements,
      scaling_versions = excluded.scaling_versions,
      logging_mode = excluded.logging_mode,
      score_type = excluded.score_type,
      duration_minutes = excluded.duration_minutes,
      benchmark_metadata = excluded.benchmark_metadata,
      metadata = excluded.metadata,
      updated_at = now();
  end loop;

  return v_workout_id;
end;
$$;

grant execute on function sync_workout_engine_v2(uuid, date, text, uuid, jsonb) to authenticated;
