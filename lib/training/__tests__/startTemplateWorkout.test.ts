import {
  parseTemplateRepRange,
  buildTemplateExerciseBlocks,
  startWorkoutFromTemplate,
  type TemplateExerciseRow,
} from '@/lib/training/startTemplateWorkout';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('parseTemplateRepRange', () => {
  it.each([
    ['8-12', [8, 12]],
    ['8 - 12', [8, 12]],
    ['12-8', [8, 12]], // reversed input still yields min ≤ max
    ['10', [10, 10]],
    ['12+', [12, 12]],
    ['6 to 8 reps', [6, 8]],
  ])('parses %s', (input, expected) => {
    expect(parseTemplateRepRange(input)).toEqual(expected);
  });

  it.each([null, undefined, '', 'AMRAP', '0'])('falls back to 8-12 for %s', (input) => {
    expect(parseTemplateRepRange(input)).toEqual([8, 12]);
  });

  it('clamps absurd rep counts into the column bounds', () => {
    expect(parseTemplateRepRange('500-900')).toEqual([100, 100]);
  });
});

describe('buildTemplateExerciseBlocks', () => {
  const rows: TemplateExerciseRow[] = [
    {
      exercise_id: 'ex-1',
      default_sets: 4,
      default_reps: '6-10',
      default_weight: 60,
      default_rest_seconds: 180,
      notes: 'Pause at the bottom',
    },
    {
      exercise_id: 'ex-2',
      default_sets: 3,
      default_reps: '10-15',
      default_weight: null,
      default_rest_seconds: 60,
      notes: null,
    },
  ];

  it('carries the template prescription onto the session blocks in order', () => {
    const blocks = buildTemplateExerciseBlocks('sess-1', 'Push Day', rows);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      workout_session_id: 'sess-1',
      exercise_id: 'ex-1',
      order: 1,
      target_sets: 4,
      target_rep_range: [6, 10],
      target_weight_kg: 60,
      target_rest_seconds: 180,
      suggestion_reason: 'From template: Push Day',
      note: 'Pause at the bottom',
    });
    expect(blocks[1]).toMatchObject({ exercise_id: 'ex-2', order: 2, target_weight_kg: 0 });
  });

  it('clamps hand-edited values into the exercise_blocks constraints', () => {
    const blocks = buildTemplateExerciseBlocks('s', 'T', [
      {
        exercise_id: 'ex-3',
        default_sets: 25,
        default_reps: '8-12',
        default_weight: -5,
        default_rest_seconds: 1800,
      },
      {
        exercise_id: 'ex-4',
        default_sets: 0,
        default_reps: null,
        default_weight: null,
        default_rest_seconds: -30,
      },
    ]);

    expect(blocks[0]).toMatchObject({
      target_sets: 10,
      target_weight_kg: 0,
      target_rest_seconds: 600,
    });
    expect(blocks[1]).toMatchObject({ target_sets: 1, target_rest_seconds: 0 });
  });

  it('leaves warmups to the workout page', () => {
    expect(buildTemplateExerciseBlocks('s', 'T', rows)[0]).toMatchObject({
      warmup_protocol: { sets: [] },
    });
  });
});

// ---------------------------------------------------------------------------

interface FakeOptions {
  template?: { id: string; name: string; times_performed: number | null } | null;
  templateExercises?: TemplateExerciseRow[];
  liveExerciseIds?: string[];
  blocksError?: { code: string } | null;
}

/** Minimal Supabase stub covering just the queries this module makes. */
function fakeSupabase(options: FakeOptions = {}) {
  const {
    template = { id: 'tpl-1', name: 'Push Day', times_performed: 2 },
    templateExercises = [
      { exercise_id: 'ex-1', default_sets: 3, default_reps: '8-12', default_rest_seconds: 90 },
    ],
    liveExerciseIds,
    blocksError = null,
  } = options;

  const calls = {
    insertedSessions: [] as Record<string, unknown>[],
    insertedBlocks: [] as Record<string, unknown>[],
    templateUpdates: [] as Record<string, unknown>[],
    deletedSessionIds: [] as string[],
  };

  const client = {
    from(table: string) {
      if (table === 'workout_templates') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: template, error: template ? null : { code: 'PGRST116' } }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            calls.templateUpdates.push(values);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'workout_template_exercises') {
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: templateExercises, error: null }) }),
          }),
        };
      }
      if (table === 'exercises') {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: (liveExerciseIds ?? ids).map((id) => ({ id })),
                error: null,
              }),
          }),
        };
      }
      if (table === 'workout_sessions') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            calls.insertedSessions.push(...rows);
            return { select: () => Promise.resolve({ data: [{ id: 'sess-1' }], error: null }) };
          },
          delete: () => ({
            eq: (_col: string, id: string) => {
              calls.deletedSessionIds.push(id);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'exercise_blocks') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            calls.insertedBlocks.push(...rows);
            return Promise.resolve({ error: blocksError });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

describe('startWorkoutFromTemplate', () => {
  it('creates a template-origin session carrying the template exercises', async () => {
    const { client, calls } = fakeSupabase({
      templateExercises: [
        { exercise_id: 'ex-1', default_sets: 4, default_reps: '6-10', default_rest_seconds: 180 },
        { exercise_id: 'ex-2', default_sets: 3, default_reps: '10-15', default_rest_seconds: 60 },
      ],
    });

    const result = await startWorkoutFromTemplate(client, 'user-1', 'tpl-1');

    expect(result).toEqual({ sessionId: 'sess-1', templateName: 'Push Day' });
    expect(calls.insertedSessions[0]).toMatchObject({
      user_id: 'user-1',
      state: 'planned',
      origin: 'template',
    });
    expect(calls.insertedBlocks.map((b) => b.exercise_id)).toEqual(['ex-1', 'ex-2']);
    expect(calls.insertedBlocks.map((b) => b.order)).toEqual([1, 2]);
  });

  it('records the template as performed', async () => {
    const { client, calls } = fakeSupabase();
    await startWorkoutFromTemplate(client, 'user-1', 'tpl-1');

    expect(calls.templateUpdates[0]).toMatchObject({ times_performed: 3 });
    expect(calls.templateUpdates[0].last_performed_at).toEqual(expect.any(String));
  });

  it('refuses to start an empty template', async () => {
    const { client, calls } = fakeSupabase({ templateExercises: [] });

    await expect(startWorkoutFromTemplate(client, 'user-1', 'tpl-1')).rejects.toThrow(
      /no exercises yet/i
    );
    expect(calls.insertedSessions).toHaveLength(0);
  });

  it('skips template rows whose exercise no longer exists', async () => {
    const { client, calls } = fakeSupabase({
      templateExercises: [
        { exercise_id: 'ex-1', default_sets: 3, default_reps: '8-12', default_rest_seconds: 90 },
        { exercise_id: 'deleted', default_sets: 3, default_reps: '8-12', default_rest_seconds: 90 },
      ],
      liveExerciseIds: ['ex-1'],
    });

    await startWorkoutFromTemplate(client, 'user-1', 'tpl-1');

    expect(calls.insertedBlocks.map((b) => b.exercise_id)).toEqual(['ex-1']);
  });

  it('errors instead of starting a session when every exercise is gone', async () => {
    const { client, calls } = fakeSupabase({ liveExerciseIds: [] });

    await expect(startWorkoutFromTemplate(client, 'user-1', 'tpl-1')).rejects.toThrow(
      /no longer exist/i
    );
    expect(calls.insertedSessions).toHaveLength(0);
  });

  it('cleans up the session when the blocks insert fails', async () => {
    const { client, calls } = fakeSupabase({ blocksError: { code: '23503' } });

    await expect(startWorkoutFromTemplate(client, 'user-1', 'tpl-1')).rejects.toMatchObject({
      code: '23503',
    });
    expect(calls.deletedSessionIds).toEqual(['sess-1']);
  });
});
