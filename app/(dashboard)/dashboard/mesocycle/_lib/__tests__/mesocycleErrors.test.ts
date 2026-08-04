import { describeMesocycleInsertFailure } from '../mesocycleErrors';

describe('describeMesocycleInsertFailure', () => {
  it('names the migration when the schedule columns are missing', () => {
    // What PostgREST returns against a database that never ran
    // 20260803000001_mesocycle_interval_schedule.
    const message = describeMesocycleInsertFailure({
      message: "Could not find the 'schedule_mode' column of 'mesocycles' in the schema cache",
      code: 'PGRST204',
    });

    expect(message).toContain('20260803000001_mesocycle_interval_schedule');
    expect(message).toContain('npx supabase db push');
    expect(message).toContain('PGRST204');
  });

  it('surfaces any other database error verbatim instead of a generic string', () => {
    const message = describeMesocycleInsertFailure({
      message: 'new row for relation "mesocycles" violates check constraint "valid_deload_week"',
      code: '23514',
      details: 'Failing row contains (8, 7).',
    });

    expect(message).toContain('valid_deload_week');
    expect(message).toContain('Failing row contains (8, 7).');
    expect(message).not.toContain('Failed to create mesocycle');
  });

  it('falls back when there is no error object to describe', () => {
    expect(describeMesocycleInsertFailure(null)).toBe('Failed to create mesocycle');
  });
});
