// Repair pass: the on_auth_user_created trigger was missing on forge-demo's auth.users
// at the time seed-forge-demo.mjs ran (schema-only dump excludes auth-schema triggers),
// so profiles rows were never created for the already-created demo auth users.
// This backfills profiles, then finishes the feed_posts/comments/reactions step that
// failed on the FK to profiles.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL?.includes('lxdpknfiyqzpqxtsotys')) throw new Error('Refusing: not forge-demo URL.');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function must(res, label) {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function main() {
  const { data: userList, error } = await sb.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const demoUsers = userList.users.filter((u) => u.email.endsWith('@forgedemo.test'));
  console.log(`Found ${demoUsers.length} demo auth users.`);

  const gym = must(await sb.from('gyms').select('id').eq('name', 'Forge Demo Box').single(), 'select gym');
  const gymId = gym.id;

  const details = {
    'owner@forgedemo.test': { first_name: 'Olivia', last_name: 'Owner', full_name: 'Olivia Owner', gender: 'female' },
    'coach@forgedemo.test': { first_name: 'Marcus', last_name: 'Coach', full_name: 'Marcus Coach', gender: 'male' },
    'alice@forgedemo.test': { first_name: 'Alice', last_name: 'Johnson', full_name: 'Alice Johnson', gender: 'female' },
    'ben@forgedemo.test': { first_name: 'Ben', last_name: 'Carter', full_name: 'Ben Carter', gender: 'male' },
    'chloe@forgedemo.test': { first_name: 'Chloe', last_name: 'Davis', full_name: 'Chloe Davis', gender: 'female' },
    'daniel@forgedemo.test': { first_name: 'Daniel', last_name: 'Evans', full_name: 'Daniel Evans', gender: 'male' },
    'elena@forgedemo.test': { first_name: 'Elena', last_name: 'Foster', full_name: 'Elena Foster', gender: 'female' },
    'felix@forgedemo.test': { first_name: 'Felix', last_name: 'Grant', full_name: 'Felix Grant', gender: 'male' },
    'grace@forgedemo.test': { first_name: 'Grace', last_name: 'Huang', full_name: 'Grace Huang', gender: 'female' },
    'henry@forgedemo.test': { first_name: 'Henry', last_name: 'Ibrahim', full_name: 'Henry Ibrahim', gender: 'male' },
  };

  const nowIso = new Date().toISOString();
  for (const u of demoUsers) {
    const d = details[u.email];
    must(await sb.from('profiles').upsert({
      id: u.id, email: u.email, full_name: d.full_name, first_name: d.first_name, last_name: d.last_name,
      gender: d.gender, gym_id: gymId, weight_unit: 'kg', language: 'en',
      waiver_accepted: true, waiver_accepted_at: nowIso,
    }, { onConflict: 'id' }), `upsert profile ${u.email}`);
  }
  console.log('Profiles backfilled.');

  const athleteEmails = ['alice', 'ben', 'chloe', 'daniel', 'elena', 'felix', 'grace', 'henry'].map((n) => `${n}@forgedemo.test`);
  const athletes = demoUsers.filter((u) => athleteEmails.includes(u.email));

  const { data: existingPosts } = await sb.from('feed_posts').select('id').eq('gym_id', gymId);
  if (existingPosts && existingPosts.length > 0) {
    console.log('Feed posts already exist, skipping feed seed.');
  } else {
    const postTexts = [
      'New PR on back squat today, feeling strong!',
      'Fran in under 5 minutes, finally!',
      'Rough day on the rower but pushed through.',
      'First time doing bar muscle-ups in a workout, so hyped.',
      'Great group energy in the 6am class this morning.',
      'Recovery day - some mobility and a light row.',
    ];
    const postRows = athletes.slice(0, 6).map((a, i) => ({ member_id: a.id, gym_id: gymId, text: postTexts[i], variant_level: 'rx' }));
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
  }

  // class_waitlist also FKs to profiles - add a couple entries now that profiles exist
  const { data: fullClasses } = await sb
    .from('classes')
    .select('id, date, name, max_spots, bookings:bookings(count)')
    .eq('gym_id', gymId)
    .limit(5);
  console.log('Sample classes for optional waitlist check:', fullClasses?.length || 0);

  console.log('\n=== REPAIR DONE ===');
}

main().catch((err) => {
  console.error('REPAIR FAILED:', err);
  process.exit(1);
});
