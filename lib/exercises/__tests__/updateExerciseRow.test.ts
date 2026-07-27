import {
  updateExerciseRow,
  type UpdateExerciseSupabase,
} from '@/lib/exercises/updateExerciseRow';

function clientReturning(result: {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
}): UpdateExerciseSupabase {
  return {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => Promise.resolve(result),
        }),
      }),
    }),
  };
}

describe('updateExerciseRow', () => {
  it('returns updated when the write lands on a row', async () => {
    const result = await updateExerciseRow(
      clientReturning({ data: [{ id: 'ex-1' }], error: null }),
      'ex-1',
      { secondary_muscles: ['quads'] }
    );
    expect(result).toEqual({ ok: true, outcome: 'updated' });
  });

  it('maps a zero-row "success" (RLS-filtered stock row) to blocked, not ok', async () => {
    const result = await updateExerciseRow(
      clientReturning({ data: [], error: null }),
      'ex-1',
      { secondary_muscles: ['quads'] }
    );
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toBeTruthy();
  });

  it('surfaces request errors with the DB message', async () => {
    const result = await updateExerciseRow(
      clientReturning({ data: null, error: { message: 'reps out of range' } }),
      'ex-1',
      { default_rep_range: [1, 5000] }
    );
    expect(result).toEqual({ ok: false, outcome: 'error', message: 'reps out of range' });
  });
});
