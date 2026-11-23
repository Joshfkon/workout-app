import { mergePendingLiftSessions } from '@/hooks/useLiftTrends';
import type { LiftTrendSessionRow } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { OutboxEntry } from '@/lib/offline/setOutbox';

const block = (id: string, sets: { weight_kg: number; reps: number }[]) => ({
  id,
  exercises: { id: 'curl', name: 'EZ Bar Curl', primary_muscle: 'biceps' },
  set_logs: sets.map((s) => ({ ...s, rpe: 8, is_warmup: false })),
});
const session = (id: string, completed_at: string | null, blocks: ReturnType<typeof block>[]): LiftTrendSessionRow =>
  ({ id, completed_at, exercise_blocks: blocks }) as unknown as LiftTrendSessionRow;

const since = new Date('2026-09-01T00:00:00Z');

describe('mergePendingLiftSessions', () => {
  it('returns server sessions untouched when nothing is queued', () => {
    const server = [session('a', '2026-11-01T10:00:00Z', [block('b1', [{ weight_kg: 30, reps: 10 }])])];
    expect(mergePendingLiftSessions({ serverSessions: server, pendingSessions: [], outbox: [], since })).toBe(server);
  });

  it('includes a workout finished offline, with its queued sets and RPE, oldest first', () => {
    const server = [session('a', '2026-11-01T10:00:00Z', [block('b1', [{ weight_kg: 30, reps: 10 }])])];
    // Server still has it in progress, with no sets synced yet.
    const pending = [session('p', null, [block('b2', [])])];
    const outbox = [
      { id: 'finish:p', table: 'workout_sessions', op: 'update', matchId: 'p', row: { state: 'completed', completed_at: '2026-11-20T10:00:00Z' } },
      { id: 's1', table: 'set_logs', op: 'insert', row: { id: 's1', exercise_block_id: 'b2', weight_kg: 32.5, reps: 10, rpe: 8.5, is_warmup: false } },
    ] as unknown as OutboxEntry[];
    const out = mergePendingLiftSessions({ serverSessions: server, pendingSessions: pending, outbox, since });
    expect(out.map((s) => s.id)).toEqual(['a', 'p']);
    expect(out[1].completed_at).toBe('2026-11-20T10:00:00Z');
    expect(out[1].exercise_blocks?.[0].set_logs).toEqual([
      expect.objectContaining({ weight_kg: 32.5, reps: 10, rpe: 8.5, is_warmup: false }),
    ]);
  });
});
