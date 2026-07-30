/**
 * Mock Supabase (auth + PostgREST) with injectable latency, for cold-start
 * measurement. Serves both the Next server's server-side calls and the
 * browser's client-side calls. Logs every request with ms timestamps.
 *
 * LATENCY_MS: added to every response (default 250 — realistic mobile RTT
 * to a Supabase region).
 */
import http from 'node:http';

const PORT = 54321;
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 250);
const T0 = Date.now();

const user = {
  id: 'test-user-id',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'test@test.com',
};

// Legacy-format program_data: exercise ids are NOT uuids so the Log page's
// hero path takes its worst case (programSessionHasUsableExercises must do an
// extra `exercises` lookup round trip).
const mkExercise = (name, muscle) => ({
  exercise: { id: name.toLowerCase().replace(/ /g, '-'), name, primaryMuscle: muscle },
  sets: 4,
  repRange: '8-12',
  restSeconds: 120,
});
const programData = {
  sessions: [
    {
      day: 'Push',
      focus: 'push',
      estimatedMinutes: 62,
      totalSets: 20,
      exercises: [
        mkExercise('Barbell Bench Press', 'chest'),
        mkExercise('Overhead Press', 'shoulders'),
        mkExercise('Incline Dumbbell Press', 'chest'),
        mkExercise('Cable Lateral Raise', 'shoulders'),
        mkExercise('Triceps Pushdown', 'triceps'),
      ],
    },
    {
      day: 'Pull',
      focus: 'pull',
      estimatedMinutes: 60,
      totalSets: 20,
      exercises: [
        mkExercise('Barbell Row', 'back'),
        mkExercise('Lat Pulldown', 'back'),
        mkExercise('Face Pull', 'shoulders'),
        mkExercise('Barbell Curl', 'biceps'),
      ],
    },
  ],
};

const meso = {
  id: 'meso-1',
  name: 'Hypertrophy Block',
  current_week: 2,
  total_weeks: 6,
  deload_week: 6,
  split_type: 'PPL',
  days_per_week: 6,
  preferred_workout_days: null,
  program_data: programData,
  exercise_overrides: [],
  generated_with_enhanced_mode: false,
  state: 'active',
};

const today = new Date().toISOString().slice(0, 10);
const completedSessions = Array.from({ length: 13 }, (_, i) => ({
  started_at: new Date(Date.now() - (14 - i) * 86400_000).toISOString(),
}));

function restFixture(table, url, wantsObject) {
  const q = url.searchParams;
  switch (table) {
    case 'workout_sessions':
      if (q.get('state') === 'eq.in_progress') return [];
      if (q.get('state') === 'eq.completed') return completedSessions;
      return [];
    case 'mesocycles':
      return [meso];
    case 'daily_check_ins':
      return wantsObject ? null : [];
    case 'users':
      return wantsObject ? { goal: 'bulk' } : [{ goal: 'bulk' }];
    case 'food_log':
      return [
        { calories: 420, protein: 35, carbs: 40, fat: 12 },
        { calories: 610, protein: 42, carbs: 55, fat: 22 },
      ];
    case 'nutrition_targets':
      return wantsObject
        ? { calories: 2800, protein: 190, carbs: 300, fat: 80, eating_window_start_min: 420, eating_window_end_min: 1260 }
        : [];
    case 'daily_activity_data':
      return wantsObject ? { steps_total: 6200 } : [];
    case 'weight_log':
      return [{ logged_at: today, weight: 185.2, unit: 'lb' }];
    case 'user_preferences':
      return wantsObject ? { weight_unit: 'lb' } : [];
    case 'exercises':
      return [{ id: '5f1b6f0a-1111-4222-8333-444455556666' }];
    case 'exercise_blocks':
      return [];
    default:
      return [];
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const t = Date.now() - T0;
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'access-control-expose-headers': '*',
    'timing-allow-origin': '*',
  };

  if (req.method === 'OPTIONS') {
    // Preflights are also a real round trip.
    setTimeout(() => {
      res.writeHead(204, cors);
      res.end();
    }, LATENCY_MS);
    console.log(`[${t}ms] OPTIONS ${url.pathname}`);
    return;
  }

  let body;
  let status = 200;
  if (url.pathname.startsWith('/auth/v1/user')) {
    body = user;
  } else if (url.pathname.startsWith('/auth/v1/token')) {
    const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
    body = { access_token: 'jwt', token_type: 'bearer', expires_in: 2592000, expires_at: exp, refresh_token: 'r', user };
  } else if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length).split('/')[0];
    const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
    body = restFixture(table, url, wantsObject);
  } else {
    status = 404;
    body = { error: 'not found' };
  }

  console.log(`[${t}ms] ${req.method} ${url.pathname}${url.search} -> ${status} (+${LATENCY_MS}ms)`);
  setTimeout(() => {
    res.writeHead(status, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify(body));
  }, LATENCY_MS);
});

server.listen(PORT, () => console.log(`mock supabase on :${PORT}, latency ${LATENCY_MS}ms`));
