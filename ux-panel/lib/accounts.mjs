/**
 * Synthetic persona accounts on a LOCAL Supabase (ux-panel/local-db/setup.sh).
 *
 * Every account is recognisably synthetic, so cleanup can never touch a real
 * user: the email is uxpanel+<persona>-<run>@synthetic-panel.test (a reserved
 * TLD that cannot receive mail) and user_metadata.synthetic_panel = true.
 * Cleanup deletes only users matching BOTH.
 *
 * assertLocalSupabase() refuses any non-local URL: the panel never creates
 * accounts or rows in production.
 */
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

/** Deterministic noise in [-1, 1] from a key (no Math.random: reproducible). */
function seededNoise(key) {
  const h = createHash('sha1').update(key).digest();
  return (h.readUInt16BE(0) / 0xffff) * 2 - 1;
}

export const SYNTHETIC_DOMAIN = 'synthetic-panel.test';

export function assertLocalSupabase(url) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      `Refusing to create synthetic accounts on ${host}: the panel only seeds a LOCAL Supabase. ` +
        'Run ux-panel/local-db/setup.sh and point NEXT_PUBLIC_SUPABASE_URL at it.',
    );
  }
}

export function adminClient(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see ux-panel/README.md).');
  assertLocalSupabase(url);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function syntheticEmail(personaId, runId) {
  return `uxpanel+${personaId}-${runId}@${SYNTHETIC_DOMAIN}`.toLowerCase();
}

/** Credentials only — the account is created by the persona (first-run) or by createAccount. */
export function newCredentials(personaId, runId, journeyId) {
  return {
    email: syntheticEmail(`${personaId}-${journeyId}`, runId),
    password: `Px9-${randomBytes(9).toString("hex")}-aA`,
  };
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** Create a confirmed synthetic auth user (the users row comes from the handle_new_user trigger). */
export async function createAccount(admin, { email, password }, runId) {
  const data = await must(
    admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { synthetic_panel: true, run_id: runId } }),
    `create ${email}`,
  );
  return data.user.id;
}

/** Tag a user created through the app's own sign-up form so cleanup finds it. */
export async function tagAccount(admin, email, runId) {
  const users = await listSyntheticUsers(admin, { requireTag: false });
  const u = users.find((x) => x.email === email);
  if (!u) return null;
  await must(admin.auth.admin.updateUserById(u.id, { user_metadata: { ...u.user_metadata, synthetic_panel: true, run_id: runId } }), `tag ${email}`);
  return u.id;
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const LIFTS = [
  { name: 'Barbell Bench Press', base: 0.75 },
  { name: 'Barbell Back Squat', base: 1.0 },
  { name: 'Barbell Row', base: 0.65 },
  { name: 'Dumbbell Bench Press', base: 0.28 },
  { name: 'Lat Pulldown', base: 0.6 },
  { name: 'Romanian Deadlift', base: 0.9 },
];

/**
 * Which lifts a seeded session trains. Default: two alternating mixed days.
 * `account.split: 'ppl'` (a persona who says they run push/pull/legs) gets a
 * real rotation, ending so the next day is push — otherwise the app's split
 * detection has nothing true to read.
 */
const PPL_DAYS = [
  ['Barbell Bench Press', 'Dumbbell Bench Press'],
  ['Barbell Row', 'Lat Pulldown'],
  ['Barbell Back Squat', 'Romanian Deadlift'],
].map((names) => names.map((n) => LIFTS.find((l) => l.name === n)));

export function liftsForSession(split, w) {
  if (split === 'ppl') return PPL_DAYS[w % 3];
  return w % 2 === 0 ? LIFTS.slice(0, 3) : LIFTS.slice(3, 6);
}

const FOODS = [
  { food_name: 'Greek yogurt, plain', serving_size: '170 g', calories: 100, protein: 17, carbs: 6, fat: 0.7, meal_type: 'breakfast' },
  { food_name: 'Oatmeal with banana', serving_size: '1 bowl', calories: 310, protein: 9, carbs: 58, fat: 5, meal_type: 'breakfast' },
  { food_name: 'Chicken breast, grilled', serving_size: '150 g', calories: 248, protein: 46, carbs: 0, fat: 5.4, meal_type: 'lunch' },
  { food_name: 'White rice, cooked', serving_size: '1 cup', calories: 205, protein: 4.3, carbs: 45, fat: 0.4, meal_type: 'lunch' },
  { food_name: 'Salmon fillet', serving_size: '150 g', calories: 312, protein: 31, carbs: 0, fat: 20, meal_type: 'dinner' },
  { food_name: 'Protein shake (whey)', serving_size: '1 scoop', calories: 120, protein: 24, carbs: 3, fat: 1.5, meal_type: 'snack' },
];

const HISTORY = {
  regular: { workouts: 9, spanDays: 21, weighIns: 11, foodDays: 5 },
  light: { workouts: 3, spanDays: 14, weighIns: 4, foodDays: 2 },
  'food-only': { workouts: 0, spanDays: 21, weighIns: 7, foodDays: 7 },
};

/**
 * Give a returning persona a profile (onboarding done) and a few weeks of
 * plausible history so Progress, Recents and Train have something to show.
 * Numbers are illustrative inputs only — the app computes everything else.
 */
export async function seedReturningUser(admin, userId, persona) {
  const a = persona.account;
  // What the persona would have answered at sign-up ("Do you lift weights?"
  // → "No, food tracking"). Seeded accounts skip the form, so without this
  // Home treated a food-only persona as a lifter.
  if (a.history === 'food-only') {
    const { data } = await admin.auth.admin.getUserById(userId);
    await must(
      admin.auth.admin.updateUserById(userId, { user_metadata: { ...(data?.user?.user_metadata ?? {}), tracking_focus: 'food' } }),
      'tracking_focus',
    );
  }
  const h = HISTORY[a.history] ?? HISTORY.light;
  await must(
    admin
      .from('users')
      .update({
        onboarding_completed: true,
        onboarding_step: null,
        goal: a.goal,
        experience: a.experience,
        sex: a.sex,
        weight_kg: a.weightKg,
        height_cm: a.heightCm,
        birth_date: `${a.birthYear}-06-15`,
        // Standing injuries the persona would have told onboarding about
        // (users.preferences.injuryAreas: shoulder, lower_back, knee, …), so a
        // returning-user journey doesn't read as "the app never asked".
        preferences: { units: a.units, ...(a.injuryAreas?.length ? { injuryAreas: a.injuryAreas } : {}) },
      })
      .eq('id', userId),
    'update users',
  );

  const kcal = Math.round(a.weightKg * (a.goal === 'bulk' ? 38 : a.goal === 'cut' ? 26 : 32));
  const protein = Math.round(a.weightKg * 2);
  await must(
    admin.from('nutrition_targets').upsert({ user_id: userId, calories: kcal, protein, fat: Math.round((kcal * 0.25) / 9), carbs: Math.round((kcal - protein * 4 - kcal * 0.25) / 4) }, { onConflict: 'user_id' }),
    'nutrition_targets',
  );

  const trend = a.goal === 'bulk' ? 0.04 : a.goal === 'cut' ? -0.06 : 0;
  const weighIns = [];
  for (let i = 0; i < h.weighIns; i++) {
    const offset = -Math.round((h.spanDays * (h.weighIns - 1 - i)) / Math.max(1, h.weighIns - 1));
    // Trend toward today's weight (offset ≤ 0), plus irregular day-to-day
    // water noise (±0.6 kg, deterministic per user and day). The old
    // ((i*37)%5) pattern repeated every 5 weigh-ins and read as a fake sine
    // wave to the personas.
    const kg = a.weightKg + trend * offset + seededNoise(`${userId}:${i}`) * 0.6;
    weighIns.push({ user_id: userId, logged_at: ymd(day(offset)), weight: a.units === 'lb' ? +(kg * 2.20462).toFixed(1) : +kg.toFixed(1), unit: a.units });
  }
  if (weighIns.length) await must(admin.from('weight_log').insert(weighIns), 'weight_log');

  const foods = [];
  for (let d = h.foodDays; d >= 1; d--) {
    for (const f of FOODS.slice(0, 4 + (d % 3))) foods.push({ ...f, user_id: userId, logged_at: ymd(day(-d)), servings: 1, source: 'manual' });
  }
  if (foods.length) await must(admin.from('food_log').insert(foods), 'food_log');

  if (!h.workouts) return;
  const names = LIFTS.map((l) => l.name);
  const exercises = await must(admin.from('exercises').select('id, name').in('name', names), 'exercises');
  const byName = Object.fromEntries(exercises.map((e) => [e.name, e.id]));
  // Strength follows the PERSONA's real experience, not the account's setting:
  // Maya "joined a gym last week" but her account says novice, which seeded
  // 88 lb Romanian deadlifts and read as the app prescribing far too heavy.
  // A true beginner's first weeks sit around the empty bar / light dumbbells.
  const STRENGTH = { none: 0.35, novice: 0.7, intermediate: 1.0, advanced: 1.3 };
  // A beginner adds reps almost every session; a flat 10/9/8 history made
  // Progress honestly say "0 of your 3 lifts beat their first workout".
  const beginner = ['none', 'novice'].includes(persona.experience);
  const strength = STRENGTH[persona.experience] ?? STRENGTH[a.experience] ?? 0.8;
  for (let w = 0; w < h.workouts; w++) {
    const offset = -Math.round(h.spanDays - (w * h.spanDays) / h.workouts);
    const date = day(offset);
    date.setHours(7, 0, 0, 0);
    const start = new Date(date);
    const end = new Date(start.getTime() + 55 * 60 * 1000);
    const [session] = await must(
      admin
        .from('workout_sessions')
        .insert({ user_id: userId, state: 'completed', planned_date: ymd(date), started_at: start.toISOString(), completed_at: end.toISOString(), completion_percent: 100, duration_seconds: 3300 })
        .select('id'),
      'workout_sessions',
    );
    const lifts = liftsForSession(a.split, w);
    for (const [order, lift] of lifts.entries()) {
      const exerciseId = byName[lift.name];
      if (!exerciseId) continue;
      const [block] = await must(
        admin
          .from('exercise_blocks')
          .insert({ workout_session_id: session.id, exercise_id: exerciseId, exercise_name: lift.name, order: order + 1, target_sets: 3, target_rep_range: [8, 12], target_rir: 2 })
          .select('id'),
        'exercise_blocks',
      );
      // Realistic progression: ~1.5% per time this lift is trained (each lift
      // comes round every other session, every third on a PPL split), rounded to plate steps. A flat
      // +2.5 kg per session read as an implausible +10%/week on light lifts.
      const timesTrained = Math.floor(w / (a.split === 'ppl' ? 3 : 2));
      const load = Math.max(5, Math.round((a.weightKg * lift.base * strength * (1 + 0.015 * timesTrained)) / 2.5) * 2.5);
      const repsBase = beginner ? [10, 9, 8].map((r) => Math.min(12, r + timesTrained)) : [10, 9, 8];
      const sets = repsBase.map((reps, i) => ({
        exercise_block_id: block.id,
        set_number: i + 1,
        weight_kg: load,
        reps,
        rpe: 7.5 + i * 0.5,
        is_warmup: false,
        set_type: 'normal',
        logged_at: new Date(start.getTime() + (order * 15 + i * 4) * 60 * 1000).toISOString(),
      }));
      await must(admin.from('set_logs').insert(sets), 'set_logs');
    }
  }
}

async function listSyntheticUsers(admin, { requireTag = true } = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await must(admin.auth.admin.listUsers({ page, perPage: 200 }), 'listUsers');
    out.push(
      ...data.users.filter(
        (u) => u.email?.endsWith(`@${SYNTHETIC_DOMAIN}`) && (!requireTag || u.user_metadata?.synthetic_panel === true),
      ),
    );
    if (data.users.length < 200) break;
  }
  return out;
}

/** Delete synthetic panel users (all runs, or one run). Cascades to their rows. */
export async function cleanupSynthetic(admin, { runId } = {}) {
  const users = (await listSyntheticUsers(admin)).filter((u) => !runId || u.user_metadata?.run_id === runId);
  for (const u of users) {
    // Delete the app's users row first (cascades every user-owned table).
    // Deleting the auth user directly fails locally: a delete trigger names
    // exercise_blocks without a schema and GoTrue runs with search_path=auth.
    await must(admin.from('users').delete().eq('id', u.id), `delete app rows for ${u.email}`);
    await must(admin.auth.admin.deleteUser(u.id), `delete ${u.email}`);
  }
  return users.length;
}
