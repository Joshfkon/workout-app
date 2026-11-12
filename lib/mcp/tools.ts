/**
 * Tools for the Claude connector (MCP) at /mcp.
 *
 * Every call runs AS the signed-in user: the Supabase client carries their
 * OAuth access token, so row-level security scopes each query to their own
 * rows exactly as it does in the app. Each query also filters by user id, so
 * a policy mistake cannot widen what a tool returns.
 *
 * All tools here are read-only. Answers are plain text Claude can quote.
 * Weights are stored in kg and shown in the user's preferred unit.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { now as clockNow } from '@/lib/clock';
import {
  buildTrainingSchedule,
  describeTrainingSchedule,
  getWorkoutsForDate,
  parseLocalDate,
  type ScheduleSourceRow,
} from '@/lib/training/trainingSchedule';
import {
  addDays,
  bestE1rmKg,
  dailyMacroTotals,
  dayInZone,
  describeBlock,
  describeWarmups,
  formatBodyWeight,
  formatDay,
  formatDuration,
  formatLoad,
  formatMacros,
  isValidTimeZone,
  mean,
  mondayOf,
  weeklySetsByMuscle,
  weightLogToKg,
  workingSets,
  type FoodRow,
  type SetRow,
  type Units,
  type VolumeSetRow,
} from './summaries';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Most recent completed sessions containing a matching exercise that
 * exercise_history reads. Comfortably above the 20 sessions a caller can ask
 * for, with room for several same-named variants.
 */
const HISTORY_SESSION_WINDOW = 120;

/** A problem the user can act on; its message is shown as-is. */
class UserError extends Error {}

interface Ctx {
  sb: SupabaseClient;
  userId: string;
  units: Units;
}

type Handler<A> = (args: A, ctx: Ctx) => Promise<string>;

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

async function context(token: string | undefined, claimedUserId: unknown): Promise<Ctx> {
  if (!token) {
    throw new UserError("Not signed in. Reconnect HyperTrack in Claude's connector settings.");
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId = typeof claimedUserId === 'string' ? claimedUserId : '';
  if (!userId) {
    const { data } = await sb.auth.getUser(token);
    userId = data.user?.id ?? '';
  }
  if (!userId) {
    throw new UserError("Couldn't verify your HyperTrack account. Reconnect it in Claude's connector settings.");
  }

  const { data: userRow } = await sb.from('users').select('preferences').eq('id', userId).maybeSingle();
  const prefs = (userRow?.preferences ?? null) as { units?: string } | null;
  return { sb, userId, units: prefs?.units === 'kg' ? 'kg' : 'lb' };
}

/** Throw a readable error for a failed query instead of returning empty data. */
function rows<T>(result: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (result.error) throw new UserError(`Couldn't load ${what}: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

const timeZoneArg = z
  .string()
  .optional()
  .describe(
    "The user's IANA time zone, e.g. 'America/Los_Angeles'. Pass it whenever you know it so 'today' and week boundaries match the user's calendar. Defaults to UTC."
  );

function resolveZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC';
  if (!isValidTimeZone(timeZone)) throw new UserError(`"${timeZone}" is not a valid IANA time zone.`);
  return timeZone;
}

const dayArg = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .describe(what);

// ----------------------------------------------------------------- row types

interface BlockRow {
  id: string;
  order: number;
  exercise_name: string | null;
  skipped_at: string | null;
  exercises: { name: string; primary_muscle: string | null; exercise_type: string | null } | null;
  set_logs: SetRow[] | null;
}

interface SessionRow {
  id: string;
  planned_date: string;
  completed_at: string | null;
  duration_seconds: number | null;
  session_rpe: number | null;
  session_notes: string | null;
  is_deload: boolean;
  exercise_blocks: BlockRow[] | null;
}

const SESSION_SELECT =
  'id, planned_date, completed_at, duration_seconds, session_rpe, session_notes, is_deload, ' +
  'exercise_blocks(id, order, exercise_name, skipped_at, ' +
  'exercises(name, primary_muscle, exercise_type), ' +
  'set_logs(set_number, weight_kg, reps, rpe, is_warmup, set_type))';

const blockName = (b: BlockRow) => b.exercises?.name ?? b.exercise_name ?? 'Unknown exercise';
const isDuration = (b: { exercises: { exercise_type: string | null } | null }) =>
  b.exercises?.exercise_type === 'duration_based';

function describeSession(session: SessionRow, units: Units, detail: boolean): string {
  const blocks = (session.exercise_blocks ?? []).slice().sort((a, b) => a.order - b.order);
  const logged = blocks.filter((b) => workingSets(b.set_logs ?? []).length > 0);
  const setCount = logged.reduce((sum, b) => sum + workingSets(b.set_logs ?? []).length, 0);
  const head =
    `${formatDay(session.completed_at ?? session.planned_date)} [id ${session.id}]: ` +
    `${logged.length} exercise${logged.length === 1 ? '' : 's'}, ${setCount} working sets, ` +
    `${formatDuration(session.duration_seconds)}` +
    (session.is_deload ? ', deload' : '') +
    (session.session_rpe ? `, session RPE ${session.session_rpe}` : '');
  const lines = [head];
  for (const b of detail ? blocks : logged) {
    lines.push(`  - ${describeBlock(blockName(b), b.set_logs ?? [], units, isDuration(b))}`);
  }
  if (session.session_notes) lines.push(`  Notes: ${session.session_notes}`);
  return lines.join('\n');
}

// --------------------------------------------------------------------- tools

export function registerTools(server: McpServer) {
  const tool = <S extends z.ZodObject>(
    name: string,
    cfg: { title: string; description: string; input: S },
    fn: Handler<z.infer<S>>
  ) =>
    server.registerTool(
      name,
      {
        title: cfg.title,
        description: cfg.description,
        inputSchema: cfg.input,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      // The SDK's handler signature is generic over the schema; `any` bridges it.
      (async (args: any, extra: any) => {
        try {
          const auth = extra?.http?.authInfo ?? extra?.authInfo;
          return text(await fn(args, await context(auth?.token, auth?.extra?.userId)));
        } catch (e) {
          const message =
            e instanceof UserError ? e.message : `Something went wrong: ${(e as Error).message}`;
          return { ...text(message), isError: true };
        }
      }) as never
    );

  tool(
    'profile_overview',
    {
      title: 'Profile overview',
      description:
        "The user's training profile at a glance: goal, experience, units, latest body weight, active program and week, and daily nutrition targets. Start here for general questions.",
      input: z.object({}),
    },
    async (_args, c) => {
      const [user, weight, meso, targets] = await Promise.all([
        c.sb
          .from('users')
          .select('goal, experience, height_cm, sex, target_weight_kg, target_body_fat_percent')
          .eq('id', c.userId)
          .maybeSingle(),
        c.sb
          .from('weight_log')
          .select('logged_at, weight, unit')
          .eq('user_id', c.userId)
          .order('logged_at', { ascending: false })
          .limit(1),
        c.sb
          .from('mesocycles')
          .select('name, current_week, total_weeks, split_type')
          .eq('user_id', c.userId)
          .or('is_active.eq.true,state.eq.active')
          .order('created_at', { ascending: false })
          .limit(1),
        c.sb
          .from('nutrition_targets')
          .select('calories, protein, carbs, fat')
          .eq('user_id', c.userId)
          .maybeSingle(),
      ]);
      if (user.error) throw new UserError(`Couldn't load your profile: ${user.error.message}`);

      const u = user.data as Record<string, unknown> | null;
      const lines = [
        `Goal: ${u?.goal ?? 'not set'}. Experience: ${u?.experience ?? 'not set'}. Units: ${c.units}.`,
      ];
      const w = rows<{ logged_at: string; weight: number; unit: string | null }>(weight, 'body weight')[0];
      lines.push(
        w
          ? `Latest body weight: ${formatBodyWeight(weightLogToKg(w.weight, w.unit), c.units)} on ${formatDay(w.logged_at)}.`
          : 'No body weight logged yet.'
      );
      if (typeof u?.target_weight_kg === 'number') {
        lines.push(`Target weight: ${formatBodyWeight(u.target_weight_kg, c.units)}.`);
      }
      const m = rows<{ name: string; current_week: number; total_weeks: number; split_type: string }>(
        meso,
        'your program'
      )[0];
      lines.push(
        m
          ? `Active program: ${m.name} (${m.split_type}), week ${m.current_week} of ${m.total_weeks}.`
          : 'No active mesocycle.'
      );
      const t = targets.data as { calories: number | null; protein: number | null; carbs: number | null; fat: number | null } | null;
      lines.push(
        t?.calories
          ? `Daily targets: ${formatMacros({
              calories: t.calories,
              protein: t.protein ?? 0,
              carbs: t.carbs ?? 0,
              fat: t.fat ?? 0,
            })}.`
          : 'No nutrition targets set.'
      );
      return lines.join('\n');
    }
  );

  tool(
    'recent_workouts',
    {
      title: 'Recent workouts',
      description:
        'The most recent completed workouts, newest first, with each exercise and its working sets (weight × reps @ reps in reserve). Use the [id …] with workout_detail for warm-ups and skipped exercises.',
      input: z.object({
        limit: z.number().int().min(1).max(20).optional().describe('How many workouts (default 5).'),
      }),
    },
    async (args, c) => {
      const sessions = rows<SessionRow>(
        await c.sb
          .from('workout_sessions')
          .select(SESSION_SELECT)
          .eq('user_id', c.userId)
          .eq('state', 'completed')
          .order('completed_at', { ascending: false })
          .limit(args.limit ?? 5),
        'your workouts'
      );
      if (sessions.length === 0) return 'No completed workouts yet.';
      return sessions.map((s) => describeSession(s, c.units, false)).join('\n\n');
    }
  );

  tool(
    'workout_detail',
    {
      title: 'Workout detail',
      description:
        'Everything logged in one workout, including warm-up sets and exercises with no sets. Takes the id shown by recent_workouts.',
      input: z.object({ workout_id: z.string().uuid().describe('The workout [id …] from recent_workouts.') }),
    },
    async (args, c) => {
      const result = await c.sb
        .from('workout_sessions')
        .select(SESSION_SELECT)
        .eq('user_id', c.userId)
        .eq('id', args.workout_id)
        .maybeSingle();
      if (result.error) throw new UserError(`Couldn't load that workout: ${result.error.message}`);
      const session = result.data as SessionRow | null;
      if (!session) throw new UserError('No workout with that id on your account.');

      const lines = [describeSession(session, c.units, true)];
      const warmups = (session.exercise_blocks ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((b) => {
          const list = describeWarmups(b.set_logs ?? [], c.units, isDuration(b));
          return list ? `  - ${blockName(b)}: ${list}` : null;
        })
        .filter(Boolean);
      if (warmups.length) lines.push('Warm-up sets:', ...(warmups as string[]));
      return lines.join('\n');
    }
  );

  tool(
    'exercise_history',
    {
      title: 'Exercise history',
      description:
        "One exercise across recent sessions: working sets per session and the best estimated 1RM, so you can see progress or a plateau. Match is by name, e.g. 'bench press'.",
      input: z.object({
        exercise: z.string().min(2).describe('Exercise name or part of it.'),
        sessions: z.number().int().min(1).max(20).optional().describe('How many sessions back (default 8).'),
      }),
    },
    async (args, c) => {
      const pattern = `%${args.exercise.replace(/[%_,()]/g, ' ').trim()}%`;
      const matches = rows<{ id: string; name: string; exercise_type: string | null }>(
        await c.sb
          .from('exercises')
          .select('id, name, exercise_type')
          .ilike('name', pattern)
          .is('deleted_at', null)
          .limit(25),
        'exercises'
      );
      if (matches.length === 0) throw new UserError(`No exercise matching "${args.exercise}".`);

      const wanted = args.exercise.trim().toLowerCase();
      const exact = matches.filter((m) => m.name.toLowerCase() === wanted);
      const candidates = exact.length > 0 ? exact : matches;

      // Query from the session side so the newest-first order and the limit
      // apply to SESSIONS. Limiting unordered blocks first could drop the most
      // recent sessions for anyone with a long history.
      const sessionRows = rows<{
        completed_at: string | null;
        planned_date: string;
        exercise_blocks: Array<{ exercise_id: string; set_logs: SetRow[] | null }> | null;
      }>(
        await c.sb
          .from('workout_sessions')
          .select(
            'completed_at, planned_date, ' +
              'exercise_blocks!inner(exercise_id, set_logs(set_number, weight_kg, reps, rpe, is_warmup, set_type))'
          )
          .eq('user_id', c.userId)
          .eq('state', 'completed')
          .in(
            'exercise_blocks.exercise_id',
            candidates.map((m) => m.id)
          )
          .order('completed_at', { ascending: false })
          .limit(HISTORY_SESSION_WINDOW),
        'exercise history'
      );
      const blocks = sessionRows.flatMap((session) =>
        (session.exercise_blocks ?? []).map((b) => ({
          exercise_id: b.exercise_id,
          workout_sessions: { completed_at: session.completed_at, planned_date: session.planned_date },
          set_logs: b.set_logs,
        }))
      );

      // Of the name matches, report the one this user has actually trained most.
      const counts = new Map<string, number>();
      for (const b of blocks) {
        if (workingSets(b.set_logs ?? []).length === 0) continue;
        counts.set(b.exercise_id, (counts.get(b.exercise_id) ?? 0) + 1);
      }
      const chosen = candidates
        .filter((m) => counts.has(m.id))
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
      if (!chosen) {
        const names = candidates.slice(0, 8).map((m) => m.name).join(', ');
        return `No logged sets for anything matching "${args.exercise}". Matching exercises: ${names}.`;
      }

      const duration = chosen.exercise_type === 'duration_based';
      const history = blocks
        .filter((b) => b.exercise_id === chosen.id && workingSets(b.set_logs ?? []).length > 0)
        .map((b) => ({
          when: b.workout_sessions.completed_at ?? b.workout_sessions.planned_date,
          sets: b.set_logs ?? [],
        }))
        .sort((a, b) => (a.when < b.when ? 1 : -1))
        .slice(0, args.sessions ?? 8);

      const lines = [`${chosen.name}: last ${history.length} session${history.length === 1 ? '' : 's'}, newest first.`];
      let best: { kg: number; when: string } | null = null;
      for (const h of history) {
        const e1rm = bestE1rmKg(h.sets, duration);
        if (e1rm !== null && (!best || e1rm > best.kg)) best = { kg: e1rm, when: h.when };
        lines.push(
          `  ${describeBlock(formatDay(h.when), h.sets, c.units, duration)}` +
            (e1rm !== null ? ` (est. 1RM ${formatLoad(e1rm, c.units)})` : '')
        );
      }
      if (best) {
        lines.push(`Best estimated 1RM in this window: ${formatLoad(best.kg, c.units)} on ${formatDay(best.when)}.`);
      }
      const others = candidates.filter((m) => m.id !== chosen.id && counts.has(m.id)).map((m) => m.name);
      if (others.length) lines.push(`Other matches with history: ${others.slice(0, 6).join(', ')}.`);
      return lines.join('\n');
    }
  );

  tool(
    'personal_records',
    {
      title: 'Personal records',
      description: "The user's best lifts on record, with weight, reps, estimated 1RM and date.",
      input: z.object({
        exercise: z.string().optional().describe('Optional name filter, e.g. "squat".'),
      }),
    },
    async (args, c) => {
      let query = c.sb
        .from('user_best_lifts')
        .select('exercise_name, weight_kg, reps, estimated_1rm_kg, achieved_at')
        .eq('user_id', c.userId)
        .order('estimated_1rm_kg', { ascending: false })
        .limit(40);
      if (args.exercise) query = query.ilike('exercise_name', `%${args.exercise.replace(/[%_,()]/g, ' ').trim()}%`);
      const lifts = rows<{
        exercise_name: string;
        weight_kg: number;
        reps: number;
        estimated_1rm_kg: number | null;
        achieved_at: string;
      }>(await query, 'personal records');
      if (lifts.length === 0) return 'No personal records on file yet.';
      return lifts
        .map(
          (l) =>
            `${l.exercise_name}: ${formatLoad(l.weight_kg, c.units)} × ${l.reps}` +
            (l.estimated_1rm_kg ? ` (est. 1RM ${formatLoad(l.estimated_1rm_kg, c.units)})` : '') +
            ` on ${formatDay(l.achieved_at)}`
        )
        .join('\n');
    }
  );

  tool(
    'weekly_volume',
    {
      title: 'Weekly training volume',
      description:
        "Hard (non-warm-up) sets per muscle group for each of the last few weeks, counted by each exercise's primary muscle. Weeks start Monday. The app's own volume model also credits secondary muscles fractionally, so in-app numbers can be higher.",
      input: z.object({
        weeks: z.number().int().min(1).max(12).optional().describe('How many weeks including the current one (default 4).'),
        time_zone: timeZoneArg,
      }),
    },
    async (args, c) => {
      const zone = resolveZone(args.time_zone);
      const weeks = args.weeks ?? 4;
      const firstWeek = addDays(mondayOf(dayInZone(clockNow(), zone)), -7 * (weeks - 1));
      // One day of slack covers any zone offset; rows are re-bucketed by local day below.
      const since = `${addDays(firstWeek, -1)}T00:00:00Z`;

      const PAGE = 1000;
      const volumeRows: VolumeSetRow[] = [];
      for (let page = 0; page < 8; page++) {
        const batch = rows<{
          logged_at: string;
          exercise_blocks: { exercises: { primary_muscle: string | null } | null };
        }>(
          await c.sb
            .from('set_logs')
            .select('logged_at, exercise_blocks!inner(exercises(primary_muscle), workout_sessions!inner(user_id))')
            .eq('exercise_blocks.workout_sessions.user_id', c.userId)
            .eq('is_warmup', false)
            .gte('logged_at', since)
            .order('logged_at', { ascending: true })
            .range(page * PAGE, page * PAGE + PAGE - 1),
          'training volume'
        );
        for (const r of batch) {
          volumeRows.push({
            logged_at: r.logged_at,
            primary_muscle: r.exercise_blocks?.exercises?.primary_muscle ?? null,
          });
        }
        if (batch.length < PAGE) break;
      }

      const byWeek = weeklySetsByMuscle(volumeRows, zone).filter((w) => w.weekStart >= firstWeek);
      if (byWeek.length === 0) return `No working sets logged in the last ${weeks} week${weeks === 1 ? '' : 's'}.`;
      return byWeek
        .map(
          (w) =>
            `Week of ${formatDay(w.weekStart)}: ${w.total} hard sets\n` +
            w.muscles.map(([muscle, n]) => `  ${muscle}: ${n}`).join('\n')
        )
        .join('\n\n');
    }
  );

  tool(
    'current_plan',
    {
      title: 'Current training plan',
      description:
        "The active mesocycle (name, week, split, training schedule, deload week), what is scheduled for a given date, and any workout that is planned or in progress.",
      input: z.object({
        date: dayArg("The date to look up, YYYY-MM-DD. Defaults to today in the user's time zone."),
        time_zone: timeZoneArg,
      }),
    },
    async (args, c) => {
      const zone = resolveZone(args.time_zone);
      const day = args.date ?? dayInZone(clockNow(), zone);

      const [mesoResult, openResult] = await Promise.all([
        c.sb
          .from('mesocycles')
          .select(
            'name, current_week, total_weeks, deload_week, split_type, days_per_week, schedule_mode, ' +
              'training_interval_days, sessions_per_day, start_date, preferred_workout_days'
          )
          .eq('user_id', c.userId)
          .or('is_active.eq.true,state.eq.active')
          .order('created_at', { ascending: false })
          .limit(1),
        c.sb
          .from('workout_sessions')
          .select('id, planned_date, state, exercise_blocks(order, exercise_name, exercises(name))')
          .eq('user_id', c.userId)
          .in('state', ['planned', 'in_progress'])
          .gte('planned_date', addDays(day, -1))
          .order('planned_date', { ascending: true })
          .limit(5),
      ]);

      const lines: string[] = [];
      const meso = rows<
        ScheduleSourceRow & {
          name: string;
          current_week: number;
          total_weeks: number;
          deload_week: number;
          split_type: string;
        }
      >(mesoResult, 'your program')[0];

      if (!meso) {
        lines.push('No active mesocycle. Workouts are being logged without a program.');
      } else {
        const schedule = buildTrainingSchedule(meso);
        lines.push(
          `${meso.name}: week ${meso.current_week} of ${meso.total_weeks}, ${meso.split_type} split, ` +
            `${describeTrainingSchedule(schedule)}. Deload is week ${meso.deload_week}.`
        );
        const date = parseLocalDate(day);
        const scheduled = date ? getWorkoutsForDate(meso.split_type, date, schedule) : [];
        lines.push(
          scheduled.length === 0
            ? `${formatDay(day)}: rest day on this schedule.`
            : `${formatDay(day)}: ${scheduled
                .map((w) => `${w.dayName} (${w.muscles.join(', ')})`)
                .join(' and ')}.`
        );
      }

      const open = rows<{
        id: string;
        planned_date: string;
        state: string;
        exercise_blocks: Array<{ order: number; exercise_name: string | null; exercises: { name: string } | null }> | null;
      }>(openResult, 'planned workouts');
      for (const s of open) {
        const names = (s.exercise_blocks ?? [])
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((b) => b.exercises?.name ?? b.exercise_name)
          .filter(Boolean);
        lines.push(
          `${s.state === 'in_progress' ? 'In progress' : 'Planned'} for ${formatDay(s.planned_date)}: ` +
            (names.length ? names.join(', ') : 'no exercises added yet')
        );
      }
      return lines.join('\n');
    }
  );

  tool(
    'nutrition_log',
    {
      title: 'Nutrition log',
      description:
        "Food logged over a range of days: per-day calories and macros against the user's targets, plus every entry when the range is a single day.",
      input: z.object({
        date: dayArg("The last day of the range, YYYY-MM-DD. Defaults to today in the user's time zone."),
        days: z.number().int().min(1).max(31).optional().describe('How many days ending on that date (default 1).'),
        time_zone: timeZoneArg,
      }),
    },
    async (args, c) => {
      const end = args.date ?? dayInZone(clockNow(), resolveZone(args.time_zone));
      const days = args.days ?? 1;
      const start = addDays(end, -(days - 1));

      const [foodResult, targetResult] = await Promise.all([
        c.sb
          .from('food_log')
          .select('logged_at, meal_type, food_name, serving_size, servings, calories, protein, carbs, fat')
          .eq('user_id', c.userId)
          .gte('logged_at', start)
          .lte('logged_at', end)
          .order('logged_at', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(2000),
        c.sb.from('nutrition_targets').select('calories, protein, carbs, fat').eq('user_id', c.userId).maybeSingle(),
      ]);
      const food = rows<FoodRow>(foodResult, 'your food log');
      const t = targetResult.data as { calories: number | null; protein: number | null; carbs: number | null; fat: number | null } | null;

      const lines: string[] = [];
      lines.push(
        t?.calories
          ? `Targets: ${formatMacros({ calories: t.calories, protein: t.protein ?? 0, carbs: t.carbs ?? 0, fat: t.fat ?? 0 })}.`
          : 'No nutrition targets set.'
      );
      if (food.length === 0) {
        lines.push(days === 1 ? `Nothing logged on ${formatDay(end)}.` : `Nothing logged from ${formatDay(start)} to ${formatDay(end)}.`);
        return lines.join('\n');
      }

      const totals = dailyMacroTotals(food);
      for (let i = 0; i < days; i++) {
        const day = addDays(start, i);
        const d = totals.get(day);
        lines.push(d ? `${formatDay(day)}: ${formatMacros(d)} (${d.entries} entries)` : `${formatDay(day)}: nothing logged`);
      }
      if (days > 1) {
        const logged = Array.from(totals.values());
        lines.push(
          `Average over ${logged.length} logged day${logged.length === 1 ? '' : 's'}: ${formatMacros({
            calories: mean(logged.map((d) => d.calories)) ?? 0,
            protein: mean(logged.map((d) => d.protein)) ?? 0,
            carbs: mean(logged.map((d) => d.carbs)) ?? 0,
            fat: mean(logged.map((d) => d.fat)) ?? 0,
          })}.`
        );
      } else {
        lines.push('Entries:');
        for (const f of food) {
          lines.push(
            `  ${f.meal_type}: ${f.food_name}` +
              (f.serving_size ? ` (${f.servings} × ${f.serving_size})` : '') +
              ` — ${Math.round(f.calories)} kcal, ${Math.round(f.protein ?? 0)} g protein`
          );
        }
      }
      return lines.join('\n');
    }
  );

  tool(
    'body_weight_trend',
    {
      title: 'Body weight trend',
      description:
        'Weigh-ins over a period with the 7-day average at the start and end of it and the change between them.',
      input: z.object({
        days: z.number().int().min(7).max(365).optional().describe('How far back to look (default 30).'),
        time_zone: timeZoneArg,
      }),
    },
    async (args, c) => {
      const days = args.days ?? 30;
      const end = dayInZone(clockNow(), resolveZone(args.time_zone));
      const start = addDays(end, -(days - 1));
      const entries = rows<{ logged_at: string; weight: number; unit: string | null }>(
        await c.sb
          .from('weight_log')
          .select('logged_at, weight, unit')
          .eq('user_id', c.userId)
          .gte('logged_at', start)
          .lte('logged_at', end)
          .order('logged_at', { ascending: true })
          .limit(400),
        'your weigh-ins'
      ).map((e) => ({ day: e.logged_at.slice(0, 10), kg: weightLogToKg(e.weight, e.unit) }));

      if (entries.length === 0) return `No weigh-ins in the last ${days} days.`;

      const firstWeek = entries.filter((e) => e.day <= addDays(entries[0].day, 6));
      const lastWeek = entries.filter((e) => e.day >= addDays(entries[entries.length - 1].day, -6));
      const startAvg = mean(firstWeek.map((e) => e.kg))!;
      const endAvg = mean(lastWeek.map((e) => e.kg))!;
      const delta = endAvg - startAvg;
      const deltaShown = c.units === 'lb' ? delta * 2.20462 : delta;

      const lines = [
        `${entries.length} weigh-ins from ${formatDay(entries[0].day)} to ${formatDay(entries[entries.length - 1].day)}.`,
        `7-day average: ${formatBodyWeight(startAvg, c.units)} at the start, ${formatBodyWeight(endAvg, c.units)} at the end ` +
          `(${deltaShown >= 0 ? '+' : ''}${deltaShown.toFixed(1)} ${c.units}).`,
        'Most recent:',
      ];
      for (const e of entries.slice(-10).reverse()) {
        lines.push(`  ${formatDay(e.day)}: ${formatBodyWeight(e.kg, c.units)}`);
      }
      return lines.join('\n');
    }
  );

  tool(
    'recovery_and_activity',
    {
      title: 'Recovery and activity',
      description:
        'Per-day steps, activity calories, sleep, resting heart rate, HRV and the daily check-in ratings (energy, soreness, stress) for recent days.',
      input: z.object({
        days: z.number().int().min(1).max(30).optional().describe('How many days back including today (default 7).'),
        time_zone: timeZoneArg,
      }),
    },
    async (args, c) => {
      const days = args.days ?? 7;
      const end = dayInZone(clockNow(), resolveZone(args.time_zone));
      const start = addDays(end, -(days - 1));
      const range = <T,>(table: string, column: string, select: string) =>
        c.sb.from(table).select(select).eq('user_id', c.userId).gte(column, start).lte(column, end).limit(200) as unknown as Promise<{
          data: T[] | null;
          error: { message: string } | null;
        }>;

      const [activity, checkIns, wellness, sleep] = await Promise.all([
        range<{ date: string; steps_total: number; total_activity_expenditure: number; workout_expenditure: number }>(
          'daily_activity_data',
          'date',
          'date, steps_total, total_activity_expenditure, workout_expenditure'
        ),
        range<{
          date: string;
          sleep_hours: number | null;
          sleep_quality: number | null;
          energy_level: number | null;
          soreness_level: number | null;
          stress_level: number | null;
        }>('daily_check_ins', 'date', 'date, sleep_hours, sleep_quality, energy_level, soreness_level, stress_level'),
        range<{ date: string; hrv_sdnn_ms: number | null; resting_hr_bpm: number | null }>(
          'daily_wellness_metrics',
          'date',
          'date, hrv_sdnn_ms, resting_hr_bpm'
        ),
        range<{ local_day: string; hours: number }>('sleep_log', 'local_day', 'local_day, hours'),
      ]);

      const act = new Map(rows<{ date: string; steps_total: number; total_activity_expenditure: number; workout_expenditure: number }>(activity, 'activity').map((r) => [r.date.slice(0, 10), r]));
      const chk = new Map(
        rows<{ date: string; sleep_hours: number | null; sleep_quality: number | null; energy_level: number | null; soreness_level: number | null; stress_level: number | null }>(
          checkIns,
          'check-ins'
        ).map((r) => [r.date.slice(0, 10), r])
      );
      const well = new Map(rows<{ date: string; hrv_sdnn_ms: number | null; resting_hr_bpm: number | null }>(wellness, 'wellness metrics').map((r) => [r.date.slice(0, 10), r]));
      const slp = new Map(rows<{ local_day: string; hours: number }>(sleep, 'sleep').map((r) => [r.local_day.slice(0, 10), r]));

      const lines: string[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const day = addDays(start, i);
        const a = act.get(day);
        const k = chk.get(day);
        const w = well.get(day);
        const sleepHours = slp.get(day)?.hours ?? k?.sleep_hours ?? null;
        const bits: string[] = [];
        if (a) {
          bits.push(`${a.steps_total.toLocaleString('en-US')} steps`);
          if (a.total_activity_expenditure) bits.push(`${Math.round(a.total_activity_expenditure)} kcal activity`);
        }
        if (sleepHours != null) bits.push(`${sleepHours.toFixed(1)} h sleep`);
        if (w?.resting_hr_bpm != null) bits.push(`RHR ${Math.round(w.resting_hr_bpm)}`);
        if (w?.hrv_sdnn_ms != null) bits.push(`HRV ${Math.round(w.hrv_sdnn_ms)} ms`);
        if (k?.energy_level != null) bits.push(`energy ${k.energy_level}`);
        if (k?.soreness_level != null) bits.push(`soreness ${k.soreness_level}`);
        if (k?.stress_level != null) bits.push(`stress ${k.stress_level}`);
        lines.push(`${formatDay(day)}: ${bits.length ? bits.join(', ') : 'no data'}`);
      }
      const avgSteps = mean(Array.from(act.values()).map((a) => a.steps_total));
      if (avgSteps !== null) lines.push(`Average steps on days with data: ${Math.round(avgSteps).toLocaleString('en-US')}.`);
      return lines.join('\n');
    }
  );

  tool(
    'body_composition',
    {
      title: 'Body composition',
      description: 'The most recent DEXA scans (weight, body fat %, lean and fat mass) and tape measurements.',
      input: z.object({}),
    },
    async (_args, c) => {
      const [scans, measurements] = await Promise.all([
        c.sb
          .from('dexa_scans')
          .select('scan_date, weight_kg, body_fat_percent, lean_mass_kg, fat_mass_kg')
          .eq('user_id', c.userId)
          .order('scan_date', { ascending: false })
          .limit(4),
        c.sb
          .from('body_measurements')
          .select('logged_at, waist, chest, hips, shoulders, neck, left_bicep, right_bicep, left_thigh, right_thigh, left_calf, right_calf')
          .eq('user_id', c.userId)
          .order('logged_at', { ascending: false })
          .limit(2),
      ]);
      const lines: string[] = [];
      const dexa = rows<{ scan_date: string; weight_kg: number; body_fat_percent: number; lean_mass_kg: number; fat_mass_kg: number }>(
        scans,
        'DEXA scans'
      );
      if (dexa.length === 0) lines.push('No DEXA scans on file.');
      for (const s of dexa) {
        lines.push(
          `DEXA ${formatDay(s.scan_date)}: ${formatBodyWeight(s.weight_kg, c.units)}, ${s.body_fat_percent.toFixed(1)}% body fat, ` +
            `${formatBodyWeight(s.lean_mass_kg, c.units)} lean, ${formatBodyWeight(s.fat_mass_kg, c.units)} fat`
        );
      }
      const tape = rows<Record<string, number | string | null>>(measurements, 'measurements');
      if (tape.length === 0) lines.push('No tape measurements on file.');
      for (const m of tape) {
        const parts = Object.entries(m)
          .filter(([key, value]) => key !== 'logged_at' && typeof value === 'number')
          .map(([key, value]) => `${key.replace('_', ' ')} ${value}`);
        lines.push(`Measurements ${formatDay(String(m.logged_at))}: ${parts.join(', ') || 'none recorded'}`);
      }
      return lines.join('\n');
    }
  );
}
