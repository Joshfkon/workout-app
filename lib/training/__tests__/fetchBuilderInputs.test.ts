import { recentTrainingFromRows } from '../fetchBuilderInputs';
import { BUILDER_HISTORY_DAYS } from '../builderDefaults';

describe('recentTrainingFromRows (builder schedule defaults input)', () => {
  const now = new Date('2026-11-24T12:00:00Z');

  it('maps each session to the standard muscles it trained, and measures the span', () => {
    const { sessions, spanDays } = recentTrainingFromRows(
      [
        {
          completed_at: '2026-11-10T12:00:00Z',
          exercise_blocks: [
            { exercises: { primary_muscle: 'chest' } },
            { exercises: { primary_muscle: null } },
            { exercises: null },
          ],
        },
        { completed_at: '2026-11-20T12:00:00Z', exercise_blocks: null },
      ],
      now
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveLength(1);
    expect(sessions[1]).toEqual([]);
    expect(spanDays).toBe(14);
  });

  it('falls back to the full history window with no sessions', () => {
    expect(recentTrainingFromRows([], now)).toEqual({ sessions: [], spanDays: BUILDER_HISTORY_DAYS });
  });
});
