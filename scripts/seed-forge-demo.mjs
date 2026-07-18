// One-off seed script for the isolated forge-demo Supabase project.
// Run with SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY pointing at forge-demo (never production).
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars (forge-demo project only).');
}
if (!SUPABASE_URL.includes('lxdpknfiyqzpqxtsotys')) {
  throw new Error(`Refusing to run: SUPABASE_URL does not look like forge-demo (${SUPABASE_URL}).`);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const DEMO_PASSWORD = 'ForgeDemo2026!';
const todayISO = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function must(res, label) {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function createAuthUser(email, fullName) {
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function main() {
  console.log('Creating auth users...');
  const ownerId = await createAuthUser('owner@forgedemo.test', 'Olivia Owner');
  const coachId = await createAuthUser('coach@forgedemo.test', 'Marcus Coach');
  const athletes = [
    { email: 'alice@forgedemo.test', full_name: 'Alice Johnson', first_name: 'Alice', last_name: 'Johnson', gender: 'female' },
    { email: 'ben@forgedemo.test', full_name: 'Ben Carter', first_name: 'Ben', last_name: 'Carter', gender: 'male' },
    { email: 'chloe@forgedemo.test', full_name: 'Chloe Davis', first_name: 'Chloe', last_name: 'Davis', gender: 'female' },
    { email: 'daniel@forgedemo.test', full_name: 'Daniel Evans', first_name: 'Daniel', last_name: 'Evans', gender: 'male' },
    { email: 'elena@forgedemo.test', full_name: 'Elena Foster', first_name: 'Elena', last_name: 'Foster', gender: 'female' },
    { email: 'felix@forgedemo.test', full_name: 'Felix Grant', first_name: 'Felix', last_name: 'Grant', gender: 'male' },
    { email: 'grace@forgedemo.test', full_name: 'Grace Huang', first_name: 'Grace', last_name: 'Huang', gender: 'female' },
    { email: 'henry@forgedemo.test', full_name: 'Henry Ibrahim', first_name: 'Henry', last_name: 'Ibrahim', gender: 'male' },
  ];
  for (const a of athletes) {
    a.id = await createAuthUser(a.email, a.full_name);
  }
  console.log('Auth users created.');

  const gymId = randomUUID();
  must(await sb.from('gyms').insert({
    id: gymId, name: 'Forge Demo Box', join_code: 'DEMO2026', owner_id: ownerId,
    primary_color: '#EF9F27', is_active: true, paid_until: todayISO(90),
  }), 'insert gyms');

  must(await sb.from('admins').insert({ id: ownerId, email: 'owner@forgedemo.test', gym_id: gymId }), 'insert admins');
  must(await sb.from('coaches').insert({ id: coachId, email: 'coach@forgedemo.test', gym_id: gymId }), 'insert coaches');

  // profiles rows already exist (handle_new_user trigger); update gym_id (allowed null->value) + demo details
  must(await sb.from('profiles').update({ gym_id: gymId, first_name: 'Olivia', last_name: 'Owner', full_name: 'Olivia Owner', gender: 'female', weight_unit: 'kg', language: 'en', waiver_accepted: true, waiver_accepted_at: new Date().toISOString() }).eq('id', ownerId), 'update owner profile');
  must(await sb.from('profiles').update({ gym_id: gymId, first_name: 'Marcus', last_name: 'Coach', full_name: 'Marcus Coach', gender: 'male', weight_unit: 'kg', language: 'en', waiver_accepted: true, waiver_accepted_at: new Date().toISOString() }).eq('id', coachId), 'update coach profile');
  for (const a of athletes) {
    must(await sb.from('profiles').update({
      gym_id: gymId, first_name: a.first_name, last_name: a.last_name, full_name: a.full_name,
      gender: a.gender, weight_unit: 'kg', language: 'en', waiver_accepted: true, waiver_accepted_at: new Date().toISOString(),
      birth_date: `199${Math.floor(Math.random() * 9)}-0${1 + Math.floor(Math.random() * 9)}-15`,
    }).eq('id', a.id), `update profile ${a.email}`);
  }
  console.log('Gym, admins, coaches, profiles done.');

  // lookup tables (empty in a schema-only dump, must seed ourselves)
  const sectionTypesInput = [
    { key: 'warmup', label: 'Warm-up', sort_order: 10 },
    { key: 'strength', label: 'Strength', sort_order: 20 },
    { key: 'skill', label: 'Skill', sort_order: 30 },
    { key: 'weightlifting', label: 'Weightlifting', sort_order: 40 },
    { key: 'gymnastics', label: 'Gymnastics', sort_order: 50 },
    { key: 'metcon', label: 'Metcon', sort_order: 60 },
    { key: 'accessory', label: 'Accessory', sort_order: 70 },
    { key: 'conditioning', label: 'Conditioning', sort_order: 80 },
    { key: 'mobility', label: 'Mobility', sort_order: 90 },
    { key: 'recovery', label: 'Recovery', sort_order: 100 },
    { key: 'cooldown', label: 'Cooldown', sort_order: 110 },
    { key: 'coach_notes', label: 'Coach Notes', sort_order: 120 },
  ];
  const sectionTypes = must(await sb.from('workout_section_types').insert(sectionTypesInput).select('id,key'), 'insert workout_section_types');
  const sectionTypeByKey = Object.fromEntries(sectionTypes.map((r) => [r.key, r.id]));

  const scalingInput = [
    { key: 'rx', label: 'RX', sort_order: 10 },
    { key: 'intermediate', label: 'Intermediate', sort_order: 20 },
    { key: 'beginner', label: 'Beginner', sort_order: 30 },
    { key: 'on_ramp', label: 'On Ramp', sort_order: 40 },
  ];
  must(await sb.from('workout_scaling_levels').insert(scalingInput), 'insert workout_scaling_levels');
  console.log('Lookup tables seeded.');

  // subscription plans
  const plans = must(await sb.from('subscription_plans').insert([
    { gym_id: gymId, name: 'Unlimited Monthly', sessions: null, price: 250, duration_months: 1, is_active: true },
    { gym_id: gymId, name: '8 Sessions / Month', sessions: 8, price: 150, duration_months: 1, is_active: true },
    { gym_id: gymId, name: 'Punch Card (12)', sessions: 12, price: 180, duration_months: 3, is_active: true },
  ]).select('id,name'), 'insert subscription_plans');
  const planByName = Object.fromEntries(plans.map((p) => [p.name, p.id]));

  const subStart = todayISO(-21);
  const subEnd = todayISO(40);
  const subscriptionAssignments = [
    ['alice@forgedemo.test', 'Unlimited Monthly', null, 0],
    ['ben@forgedemo.test', 'Unlimited Monthly', null, 0],
    ['chloe@forgedemo.test', '8 Sessions / Month', 8, 3],
    ['daniel@forgedemo.test', 'Unlimited Monthly', null, 0],
    ['elena@forgedemo.test', 'Punch Card (12)', 12, 5],
    ['felix@forgedemo.test', 'Unlimited Monthly', null, 0],
    ['grace@forgedemo.test', '8 Sessions / Month', 8, 2],
    ['henry@forgedemo.test', 'Unlimited Monthly', null, 0],
  ];
  for (const [email, planName, sessionsTotal, sessionsUsed] of subscriptionAssignments) {
    must(await sb.from('subscriptions').insert({
      gym_id: gymId, member_email: email, plan_id: planByName[planName],
      sessions_total: sessionsTotal, sessions_used: sessionsUsed,
      start_date: subStart, end_date: subEnd, is_active: true, queued: false,
      notes: 'Paid: demo seed data',
    }), `insert subscription ${email}`);
  }
  console.log('Subscriptions seeded.');

  must(await sb.from('app_settings').insert({ gym_id: gymId, key: 'cancel_window_hours', value: '12' }), 'insert app_settings');

  // classes: 21-day window, 3 slots/day
  const classSlots = [
    { name: 'CrossFit AM', start_time: '07:00', end_time: '08:00', coach: 'Marcus Coach', max_spots: 12, color: '#EF9F27' },
    { name: 'Open Gym', start_time: '12:00', end_time: '13:00', coach: 'Marcus Coach', max_spots: 8, color: '#4F8EF7' },
    { name: 'CrossFit PM', start_time: '18:00', end_time: '19:00', coach: 'Marcus Coach', max_spots: 15, color: '#EF9F27' },
  ];
  const classRows = [];
  for (let offset = -14; offset <= 6; offset++) {
    const date = todayISO(offset);
    for (const slot of classSlots) {
      classRows.push({ id: randomUUID(), gym_id: gymId, date, ...slot });
    }
  }
  must(await sb.from('classes').insert(classRows), 'insert classes');
  console.log(`Classes seeded (${classRows.length}).`);

  // bookings: each athlete books the AM or PM class on ~60% of days, checked_in true for past
  const bookingRows = [];
  for (let i = 0; i < classRows.length; i++) {
    const cls = classRows[i];
    if (cls.name === 'Open Gym') continue;
    const isPast = cls.date < todayISO(0);
    for (const a of athletes) {
      if (Math.random() < 0.55) {
        bookingRows.push({
          gym_id: gymId, class_id: cls.id, member_id: a.id,
          checked_in: isPast ? Math.random() < 0.85 : false,
        });
      }
    }
  }
  // insert sequentially in chunks to respect capacity trigger ordering
  for (let i = 0; i < bookingRows.length; i += 20) {
    const chunk = bookingRows.slice(i, i + 20);
    const res = await sb.from('bookings').insert(chunk);
    if (res.error) console.warn('booking chunk skipped (likely capacity):', res.error.message);
  }
  console.log('Bookings seeded.');

  // WOD templates, cycled across a 21-day window (also written into workouts/workout_sections)
  const templates = [
    {
      name: 'Fran', type: 'For Time', duration: '10:00', isBenchmark: true,
      format_config: { sharedRepScheme: [21, 15, 9] },
      warmup: ['400m run', '10 PVC pass-throughs', '10 air squats'],
      movements_rx: ['Thrusters', 'Pull-ups'], rx_weight_male: '43kg', rx_weight_female: '29kg',
      movements_intermediate: ['Thrusters', 'Ring Rows'], intermediate_weight_male: '30kg', intermediate_weight_female: '20kg',
    },
    {
      name: 'Cindy', type: 'AMRAP', duration: '20:00', isBenchmark: true,
      format_config: { durationSec: 1200 },
      warmup: ['3 rounds: 200m run, 10 banded pull-aparts'],
      movements_rx: ['5 Pull-ups', '10 Push-ups', '15 Air Squats'],
      movements_intermediate: ['5 Ring Rows', '10 Knee Push-ups', '15 Air Squats'],
    },
    {
      name: 'Grace', type: 'For Time', duration: '8:00', isBenchmark: true,
      format_config: { structure: 'Sequence' },
      warmup: ['Barbell warm-up complex', '5 min row easy'],
      movements_rx: ['30 Clean and Jerks'], rx_weight_male: '61kg', rx_weight_female: '43kg',
      movements_intermediate: ['30 Clean and Jerks'], intermediate_weight_male: '43kg', intermediate_weight_female: '29kg',
    },
    {
      name: 'Death By Burpees', type: 'Death By', duration: '15:00',
      format_config: { startReps: 2, incrementReps: 2, intervalSec: 60 },
      warmup: ['400m jog', 'dynamic stretching'],
      movements_rx: ['Burpees'], movements_intermediate: ['Burpees (step-up)'],
    },
    {
      name: 'Heavy Squat Day', type: 'Strength Sets', duration: '30:00',
      format_config: { setsScheme: [5, 5, 5, 3, 3, 3, 1, 1, 1] },
      warmup: ['Empty bar squats x10', 'PVC overhead squats'],
      movements_rx: ['Back Squat'], rx_weight_male: '80% 1RM', rx_weight_female: '80% 1RM',
      movements_intermediate: ['Back Squat'], intermediate_weight_male: '70% 1RM', intermediate_weight_female: '70% 1RM',
    },
    {
      name: 'Engine Builder', type: 'EMOM', duration: '12:00',
      format_config: { totalRounds: 12, intervalSec: 60 },
      warmup: ['Row 500m easy'],
      movements_rx: ['12 Wall Balls', '10 Toes to Bar'], rx_weight_male: '9kg ball', rx_weight_female: '6kg ball',
      movements_intermediate: ['12 Wall Balls', '10 Hanging Knee Raises'],
    },
    {
      name: 'Chipper Friday', type: 'For Time', duration: '25:00',
      format_config: { structure: 'Sequence' },
      warmup: ['General warm-up', 'shoulder mobility'],
      movements_rx: ['50 Wall Balls', '40 Box Jumps', '30 KB Swings', '20 T2B', '10 Bar Muscle-ups'],
      movements_intermediate: ['50 Wall Balls', '40 Step-ups', '30 KB Swings', '20 Sit-ups', '10 Pull-ups'],
    },
    {
      name: 'Tabata Mash', type: 'Tabata', duration: '16:00',
      format_config: { rounds: 8, workSec: 20, restSec: 10, scoringMode: 'Lowest Reps' },
      warmup: ['Jump rope 3 min'],
      movements_rx: ['Air Squats', 'Push-ups', 'Sit-ups', 'Burpees'],
      movements_intermediate: ['Air Squats', 'Knee Push-ups', 'Sit-ups', 'Step-back Burpees'],
    },
    {
      name: 'Ladder Snatch', type: 'Ladder', duration: '14:00',
      format_config: { ladderType: 'Descending', sharedRepScheme: [50, 40, 30, 20, 10] },
      warmup: ['Barbell snatch progression'],
      movements_rx: ['Power Snatch'], rx_weight_male: '43kg', rx_weight_female: '29kg',
      movements_intermediate: ['Power Snatch'], intermediate_weight_male: '30kg', intermediate_weight_female: '20kg',
    },
    {
      name: 'Partner Metcon', type: 'Partner WOD', duration: '20:00',
      format_config: { splitType: 'You go/I go', baseFormat: 'AMRAP', durationSec: 1200 },
      warmup: ['Partner mobility flow'],
      movements_rx: ['200m Run', '15 Deadlifts', '10 Burpee Box Jumps'], rx_weight_male: '70kg', rx_weight_female: '50kg',
      movements_intermediate: ['200m Run', '15 Deadlifts', '10 Step-up Burpees'], intermediate_weight_male: '50kg', intermediate_weight_female: '35kg',
    },
  ];

  const wodIdByDate = {};
  const workoutIdByDate = {};
  for (let offset = -14, i = 0; offset <= 4; offset++, i++) {
    const date = todayISO(offset);
    const t = templates[i % templates.length];

    const wod = must(await sb.from('wods').insert({
      gym_id: gymId, date, name: t.name, type: t.type, duration: t.duration,
      format_config: t.format_config,
      warmup: t.warmup, warmup_visible: true,
      skill: [], skill_name: null, skill_type: 'Weightlifting', skill_format_config: null, skill_visible: false,
      skill2: [], skill2_name: null, skill2_type: 'Weightlifting', skill2_format_config: null, skill2_visible: false,
      movements_rx: t.movements_rx || [], rx_weight_male: t.rx_weight_male || null, rx_weight_female: t.rx_weight_female || null,
      movements_intermediate: t.movements_intermediate || [], intermediate_weight_male: t.intermediate_weight_male || null, intermediate_weight_female: t.intermediate_weight_female || null,
      movements_beginner: [], movements_onramp: [],
    }).select('id').single(), `insert wod ${date}`);
    wodIdByDate[date] = wod.id;

    const workout = must(await sb.from('workouts').insert({
      gym_id: gymId, date, title: t.name, notes: null, tags: t.isBenchmark ? ['benchmark'] : [],
      is_published: true, created_by: coachId,
    }).select('id').single(), `insert workout ${date}`);
    workoutIdByDate[date] = workout.id;

    const movementsRx = (t.movements_rx || []).map((name) => ({ name, canonicalName: null, reps: null, weight: t.rx_weight_male || null, distance: null, calories: null, equipment: [], notes: null }));
    const movementsIntermediate = (t.movements_intermediate || []).map((name) => ({ name, canonicalName: null, reps: null, weight: t.intermediate_weight_male || null, distance: null, calories: null, equipment: [], notes: null }));
    must(await sb.from('workout_sections').insert({
      workout_id: workout.id, gym_id: gymId, section_type_id: sectionTypeByKey.metcon,
      order_index: 1, title: null, description: null, format: t.type,
      format_config: t.format_config, movements: movementsRx,
      scaling_versions: movementsIntermediate.length ? [{ level: 'intermediate', notes: null, movements: movementsIntermediate }] : [],
      logging_mode: 'required', score_type: t.type === 'AMRAP' ? 'Rounds + Reps' : (t.type === 'For Time' ? 'Time' : (t.type === 'Strength Sets' ? 'Weight' : 'Reps')),
      duration_minutes: null, benchmark_metadata: { name: t.name, isBenchmark: !!t.isBenchmark, isHero: false }, metadata: {},
    }), `insert workout_section ${date}`);
  }
  console.log('WODs + workouts/workout_sections seeded.');

  // wod_logs: athletes log ~65% of past WODs
  const pastDates = Object.keys(wodIdByDate).filter((d) => d < todayISO(0));
  const logRows = [];
  for (const date of pastDates) {
    for (const a of athletes) {
      if (Math.random() < 0.65) {
        const minutes = 6 + Math.floor(Math.random() * 15);
        const seconds = Math.floor(Math.random() * 60);
        logRows.push({
          member_id: a.id, wod_id: wodIdByDate[date], gym_id: gymId,
          // App's Leaderboard query filters variant_level against these exact-cased values
          // (App.jsx fetchClasament: .in('variant_level', ['OnRamp','Beginner','Intermediate','RX'])).
          variant_level: Math.random() < 0.6 ? 'RX' : 'Intermediate',
          result: null, time_result: `${minutes}:${String(seconds).padStart(2, '0')}`,
          notes: null, logged_at: new Date(`${date}T19:30:00Z`).toISOString(),
        });
      }
    }
  }
  for (let i = 0; i < logRows.length; i += 25) {
    must(await sb.from('wod_logs').insert(logRows.slice(i, i + 25)), 'insert wod_logs chunk');
  }
  console.log(`WOD logs seeded (${logRows.length}).`);

  // personal records
  const movements = [
    ['Back Squat', 60, 140, 'kg'], ['Front Squat', 45, 110, 'kg'], ['Deadlift', 80, 180, 'kg'],
    ['Clean and Jerk', 35, 90, 'kg'], ['Snatch', 25, 70, 'kg'],
  ];
  const prRows = [];
  for (const a of athletes) {
    for (const [movement, min, max, unit] of movements) {
      if (Math.random() < 0.75) {
        const value = Math.round((min + Math.random() * (max - min)) / 2.5) * 2.5;
        prRows.push({
          member_id: a.id, gym_id: gymId, movement, value, unit, reps: 1,
          notes: null, recorded_at: new Date(`${todayISO(-Math.floor(Math.random() * 60))}T17:00:00Z`).toISOString(),
        });
      }
    }
  }
  for (let i = 0; i < prRows.length; i += 25) {
    must(await sb.from('personal_records').insert(prRows.slice(i, i + 25)), 'insert personal_records chunk');
  }
  console.log(`Personal records seeded (${prRows.length}).`);

  // feed posts/comments/reactions
  const postTexts = [
    'New PR on back squat today, feeling strong!',
    'Fran in under 5 minutes, finally!',
    'Rough day on the rower but pushed through.',
    "First time doing bar muscle-ups in a workout, so hyped.",
    'Great group energy in the 6am class this morning.',
    'Recovery day - some mobility and a light row.',
  ];
  const postRows = athletes.slice(0, 6).map((a, i) => ({
    member_id: a.id, gym_id: gymId, text: postTexts[i], variant_level: 'rx',
  }));
  const posts = must(await sb.from('feed_posts').insert(postRows).select('id'), 'insert feed_posts');

  const commentRows = [];
  const reactionRows = [];
  const emojis = ['💪', '🔥', '👏', '🎉'];
  for (const post of posts) {
    const commenter = athletes[Math.floor(Math.random() * athletes.length)];
    commentRows.push({ post_id: post.id, member_id: commenter.id, gym_id: gymId, text: 'Nice work!' });
    for (const a of athletes) {
      if (Math.random() < 0.4) {
        reactionRows.push({ post_id: post.id, member_id: a.id, gym_id: gymId, emoji: emojis[Math.floor(Math.random() * emojis.length)] });
      }
    }
  }
  if (commentRows.length) must(await sb.from('feed_comments').insert(commentRows), 'insert feed_comments');
  if (reactionRows.length) must(await sb.from('feed_reactions').insert(reactionRows), 'insert feed_reactions');
  console.log('Feed seeded.');

  console.log('\n=== DONE ===');
  console.log('Gym ID:', gymId);
  console.log('Owner:', 'owner@forgedemo.test', '/', DEMO_PASSWORD);
  console.log('Coach:', 'coach@forgedemo.test', '/', DEMO_PASSWORD);
  console.log('Athlete (primary demo):', 'alice@forgedemo.test', '/', DEMO_PASSWORD);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
