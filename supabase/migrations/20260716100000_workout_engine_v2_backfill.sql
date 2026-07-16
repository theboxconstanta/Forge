-- Workout Engine V2, Faza 2 - backfill din `wods` existent in
-- workouts/workout_sections. Migratie de DATE, nu de schema. `wods`/
-- `wod_logs` raman COMPLET neatinse (doar CITITE, niciodata scrise) si
-- raman singura sursa de adevar pt aplicatie - nimic din App.jsx nu
-- citeste inca din workouts/workout_sections dupa aceasta migratie.
--
-- Idempotenta: legacy_wod_id (adaugat mai jos) leaga fiecare Workout de
-- WOD-ul sursa - rularea repetata sare peste orice WOD deja migrat, fara
-- sa creeze duplicate.
-- Per-WOD atomic: fiecare WOD e migrat intr-un bloc BEGIN/EXCEPTION propriu
-- (savepoint implicit PL/pgSQL) - o eroare la un WOD anume anuleaza DOAR
-- Workout-ul si sectiunile lui, restul WOD-urilor continua sa fie migrate.
-- Rollback complet (oricand, instant, 100% sigur - wods/wod_logs nefiind
-- niciodata scrise):
--   delete from workouts where legacy_wod_id is not null;
--   (cascadeaza automat catre workout_sections)

alter table workouts add column if not exists legacy_wod_id uuid references wods(id);
create unique index if not exists workouts_legacy_wod_id_uidx
  on workouts (legacy_wod_id) where legacy_wod_id is not null;

do $$
declare
  v_wod record;
  v_workout_id uuid;
  v_type_warmup uuid;
  v_type_skill uuid;
  v_type_metcon uuid;
  v_order int;
  v_scaling jsonb;
  v_entry jsonb;
  v_migrated_count int := 0;
  v_skipped_count int := 0;
  v_section_count int := 0;
  v_movement_count int := 0;
  v_wods_to_movements jsonb;
begin
  select id into v_type_warmup from workout_section_types where key = 'warmup' and gym_id is null;
  select id into v_type_skill from workout_section_types where key = 'skill' and gym_id is null;
  select id into v_type_metcon from workout_section_types where key = 'metcon' and gym_id is null;

  if v_type_warmup is null or v_type_skill is null or v_type_metcon is null then
    raise exception 'Faza 0 lookup rows missing (warmup/skill/metcon) - run Phase 0 seed first';
  end if;

  for v_wod in select * from wods order by date loop
    -- idempotenta - verificare DIRECT in bucla, inainte de blocul cu
    -- exceptie, ca sa nu depindem de comportamentul CONTINUE intr-un bloc
    -- BEGIN/EXCEPTION imbricat
    if exists (select 1 from workouts where legacy_wod_id = v_wod.id) then
      continue;
    end if;

    begin
      insert into workouts (gym_id, date, title, is_published, created_at, legacy_wod_id)
      values (v_wod.gym_id, v_wod.date, v_wod.name, true, coalesce(v_wod.created_at, now()), v_wod.id)
      returning id into v_workout_id;

      v_order := 0;

      -- Warm-up (doar daca are continut real)
      if v_wod.warmup is not null and array_length(v_wod.warmup, 1) > 0 then
        insert into workout_sections (workout_id, gym_id, section_type_id, order_index, movements)
        values (
          v_workout_id, v_wod.gym_id, v_type_warmup, v_order,
          (select coalesce(jsonb_agg(jsonb_build_object(
            'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
            'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
          )), '[]'::jsonb) from unnest(v_wod.warmup) as m)
        );
        v_order := v_order + 1;
        v_section_count := v_section_count + 1;
        v_movement_count := v_movement_count + array_length(v_wod.warmup, 1);
      end if;

      -- Skill (doar daca are continut real) - format/config preluate din
      -- skill_type/skill_format_config
      if v_wod.skill is not null and array_length(v_wod.skill, 1) > 0 then
        insert into workout_sections (workout_id, gym_id, section_type_id, order_index, title, format, format_config, movements)
        values (
          v_workout_id, v_wod.gym_id, v_type_skill, v_order, v_wod.skill_name, v_wod.skill_type,
          coalesce(v_wod.skill_format_config, '{}'::jsonb),
          (select coalesce(jsonb_agg(jsonb_build_object(
            'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
            'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
          )), '[]'::jsonb) from unnest(v_wod.skill) as m)
        );
        v_order := v_order + 1;
        v_section_count := v_section_count + 1;
        v_movement_count := v_movement_count + array_length(v_wod.skill, 1);
      end if;

      -- Skill 2 (doar daca are continut real) - foloseste acelasi
      -- section_type ca Skill (Faza 0 nu are un tip distinct "skill2"),
      -- distinctia ramane prin title + order_index
      if v_wod.skill2 is not null and array_length(v_wod.skill2, 1) > 0 then
        insert into workout_sections (workout_id, gym_id, section_type_id, order_index, title, format, format_config, movements)
        values (
          v_workout_id, v_wod.gym_id, v_type_skill, v_order,
          coalesce(v_wod.skill2_name, 'Skill 2'), v_wod.skill2_type,
          coalesce(v_wod.skill2_format_config, '{}'::jsonb),
          (select coalesce(jsonb_agg(jsonb_build_object(
            'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
            'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
          )), '[]'::jsonb) from unnest(v_wod.skill2) as m)
        );
        v_order := v_order + 1;
        v_section_count := v_section_count + 1;
        v_movement_count := v_movement_count + array_length(v_wod.skill2, 1);
      end if;

      -- scaling_versions ale sectiunii principale - doar intermediate/
      -- beginner/on_ramp (RX e baza, vezi "movements" pe sectiunea
      -- principala mai jos - acelasi tipar ca schema AI, unde RX nu are
      -- nevoie de o intrare separata in scaling fiindca e deja campul de
      -- baza). O varianta e inclusa doar daca are miscari SAU notite reale.
      v_scaling := '[]'::jsonb;

      if (v_wod.movements_intermediate is not null and array_length(v_wod.movements_intermediate, 1) > 0)
         or v_wod.notes_intermediate is not null then
        v_entry := jsonb_build_object(
          'level', 'intermediate', 'notes', v_wod.notes_intermediate,
          'movements', (select coalesce(jsonb_agg(jsonb_build_object(
            'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
            'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
          )), '[]'::jsonb) from unnest(coalesce(v_wod.movements_intermediate, '{}')) as m)
        );
        v_scaling := v_scaling || jsonb_build_array(v_entry);
        v_movement_count := v_movement_count + coalesce(array_length(v_wod.movements_intermediate, 1), 0);
      end if;

      if (v_wod.movements_beginner is not null and array_length(v_wod.movements_beginner, 1) > 0)
         or v_wod.notes_beginner is not null then
        v_entry := jsonb_build_object(
          'level', 'beginner', 'notes', v_wod.notes_beginner,
          'movements', (select coalesce(jsonb_agg(jsonb_build_object(
            'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
            'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
          )), '[]'::jsonb) from unnest(coalesce(v_wod.movements_beginner, '{}')) as m)
        );
        v_scaling := v_scaling || jsonb_build_array(v_entry);
        v_movement_count := v_movement_count + coalesce(array_length(v_wod.movements_beginner, 1), 0);
      end if;

      if (v_wod.movements_onramp is not null and array_length(v_wod.movements_onramp, 1) > 0)
         or v_wod.notes_onramp is not null then
        v_entry := jsonb_build_object(
          'level', 'on_ramp', 'notes', v_wod.notes_onramp,
          'movements', (select coalesce(jsonb_agg(jsonb_build_object(
            'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
            'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
          )), '[]'::jsonb) from unnest(coalesce(v_wod.movements_onramp, '{}')) as m)
        );
        v_scaling := v_scaling || jsonb_build_array(v_entry);
        v_movement_count := v_movement_count + coalesce(array_length(v_wod.movements_onramp, 1), 0);
      end if;

      -- Sectiunea principala (Metcon, primary) - notes_rx merge pe
      -- description (nota coach-ului pt prescriptia RX); rx_weight_male/
      -- female nu sunt per-miscare (nu stim CARE miscare din array le
      -- corespunde) - pastrate brut in metadata.legacyWeights, nu atasate
      -- fals de o miscare anume.
      insert into workout_sections (
        workout_id, gym_id, section_type_id, order_index, description, format, format_config,
        movements, scaling_versions, logging_mode, score_type, metadata
      )
      values (
        v_workout_id, v_wod.gym_id, v_type_metcon, v_order, v_wod.notes_rx, v_wod.type,
        coalesce(v_wod.format_config, '{}'::jsonb),
        (select coalesce(jsonb_agg(jsonb_build_object(
          'name', m, 'canonicalName', null, 'reps', null, 'weight', null,
          'distance', null, 'calories', null, 'equipment', '[]'::jsonb, 'notes', null
        )), '[]'::jsonb) from unnest(coalesce(v_wod.movements_rx, '{}')) as m),
        v_scaling,
        'required',
        -- score_type DERIVAT din format (nu exista coloana sursa directa) -
        -- aceeasi mapare deja folosita/aprobata in prompt.ts
        -- (SCORE_TYPE_BY_FORMAT), aplicata determinist, nu ghicita.
        case v_wod.type
          when 'AMRAP' then 'Rounds + Reps'
          when 'Ascending AMRAP' then 'Rounds + Reps'
          when 'AMRAP with Buy-In' then 'Rounds + Reps'
          when 'For Time' then 'Time'
          when 'RFT' then 'Time'
          when 'Chipper' then 'Time'
          when 'Ladder' then 'Time'
          when 'Partner WOD' then 'Time'
          when 'EMOM' then 'Reps'
          when 'Tabata' then 'Reps'
          when 'Intervals' then 'Reps'
          when 'Death By' then 'Reps'
          when 'Death By Weight' then 'Weight'
          when 'Complex' then 'Weight'
          when 'Strength Sets' then 'Weight'
          when 'Build to Heavy/1RM' then 'Weight'
          when 'Weightlifting' then 'Weight'
          when 'Superset' then 'Sets'
          when 'Chained AMRAP' then 'Reps'
          when 'Not For Time' then 'Completion'
          when 'Max Effort' then 'Weight'
          else 'Unknown'
        end,
        jsonb_build_object(
          'legacyWodId', v_wod.id,
          'legacyWeights', jsonb_build_object(
            'rx', jsonb_build_object('male', v_wod.rx_weight_male, 'female', v_wod.rx_weight_female),
            'intermediate', jsonb_build_object('male', v_wod.intermediate_weight_male, 'female', v_wod.intermediate_weight_female),
            'beginner', jsonb_build_object('male', v_wod.beginner_weight_male, 'female', v_wod.beginner_weight_female),
            'on_ramp', jsonb_build_object('male', v_wod.onramp_weight_male, 'female', v_wod.onramp_weight_female)
          )
        )
      );
      v_section_count := v_section_count + 1;
      v_movement_count := v_movement_count + coalesce(array_length(v_wod.movements_rx, 1), 0);

      v_migrated_count := v_migrated_count + 1;
    exception when others then
      v_skipped_count := v_skipped_count + 1;
      raise warning 'Skipped wod % (%): %', v_wod.id, v_wod.name, sqlerrm;
    end;
  end loop;

  raise notice 'Backfill done: migrated=%, skipped=%, sections_created=%, movements_migrated=%',
    v_migrated_count, v_skipped_count, v_section_count, v_movement_count;
end $$;
