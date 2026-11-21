/**
 * runHevyImport against an in-memory fake Supabase client: checks the rows it
 * writes and that importing the same file twice adds nothing the second time.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { runHevyImport } from '../runHevyImport';
import { parseHevyCSV } from '@/services/hevyImport';

type Row = Record<string, unknown>;

function fakeSupabase(seedExercises: Row[] = []) {
  const tables: Record<string, Row[]> = {
    exercises: [...seedExercises],
    workout_sessions: [],
    exercise_blocks: [],
    set_logs: [],
  };
  let nextId = 1;

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingInsert: Row[] | null = null;

    const exec = () => {
      if (pendingInsert) {
        const inserted = pendingInsert.map((r) => ({ id: `${table}-${nextId++}`, ...r }));
        tables[table].push(...inserted);
        return { data: inserted, error: null };
      }
      return { data: tables[table].filter((r) => filters.every((f) => f(r))), error: null };
    };

    const q = {
      select: () => q,
      insert: (rows: Row | Row[]) => {
        pendingInsert = Array.isArray(rows) ? rows : [rows];
        return q;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      ilike: (c: string, v: string) => (filters.push((r) => String(r[c]).toLowerCase() === v.toLowerCase()), q),
      order: () => q,
      limit: () => q,
      single: async () => {
        const { data } = exec();
        return { data: data[0] ?? null, error: data[0] ? null : { message: 'none' } };
      },
      maybeSingle: async () => ({ data: exec().data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(exec()).then(resolve),
    };
    return q;
  }

  return { client: { from } as unknown as SupabaseClient, tables };
}

const HEADER =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
const CSV = [
  HEADER,
  'Push,"18 Nov 2026, 18:22","18 Nov 2026, 19:42",Good one,Bench Press (Barbell),,Slow eccentric,0,warmup,40,10,,,',
  'Push,"18 Nov 2026, 18:22","18 Nov 2026, 19:42",Good one,Bench Press (Barbell),,Slow eccentric,1,failure,80,8,,,',
  'Push,"18 Nov 2026, 18:22","18 Nov 2026, 19:42",Good one,Plank,,,0,normal,,,,60,',
  'Legs,"20 Nov 2026, 07:05","20 Nov 2026, 08:00",,Leg Press (Machine),,,0,normal,150,12,,,8',
].join('\n');

describe('runHevyImport', () => {
  const library = [{ id: 'bench', name: 'Barbell Bench Press', is_custom: false }];

  it('writes completed sessions, blocks and set logs', async () => {
    const { client, tables } = fakeSupabase(library);
    const { workouts } = parseHevyCSV(CSV);
    const res = await runHevyImport(client, 'u1', workouts, { 'Bench Press (Barbell)': 'bench' }, () => {});

    expect(res).toMatchObject({ success: true, imported: 2, skipped: 0, duplicates: 0, newExercises: 2 });

    const created = tables.exercises.filter((e) => e.is_custom);
    expect(created.map((e) => [e.name, e.exercise_type])).toEqual([
      ['Plank', 'duration_based'],
      ['Leg Press (Machine)', 'rep_based'],
    ]);

    const push = tables.workout_sessions[0];
    expect(push).toMatchObject({
      user_id: 'u1',
      state: 'completed',
      planned_date: '2026-11-18',
      duration_seconds: 80 * 60,
      session_notes: 'Push\nGood one',
      completion_percent: 100,
    });
    expect(push.started_at).toBe(workouts[0].startedAt);
    expect(push.completed_at).toBe(workouts[0].endedAt);

    const benchBlock = tables.exercise_blocks.find((b) => b.exercise_id === 'bench')!;
    expect(benchBlock).toMatchObject({ order: 1, target_sets: 1, note: 'Slow eccentric' });

    const benchSets = tables.set_logs.filter((s) => s.exercise_block_id === benchBlock.id);
    expect(benchSets).toEqual([
      expect.objectContaining({ set_number: 1, set_type: 'warmup', is_warmup: true, weight_kg: 40, reps: 10 }),
      expect.objectContaining({ set_number: 2, set_type: 'normal', rpe: 10, weight_kg: 80, reps: 8 }),
    ]);
    expect(tables.set_logs).toHaveLength(4);
  });

  it('re-importing the same file adds nothing', async () => {
    const { client, tables } = fakeSupabase(library);
    const { workouts } = parseHevyCSV(CSV);
    await runHevyImport(client, 'u1', workouts, { 'Bench Press (Barbell)': 'bench' }, () => {});
    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));

    const again = await runHevyImport(client, 'u1', parseHevyCSV(CSV).workouts, {}, () => {});
    expect(again).toMatchObject({ imported: 0, duplicates: 2, newExercises: 0 });
    expect(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))).toEqual(counts);
  });
});
