/**
 * Tests for the extracted session read (./loadSession).
 *
 * The read itself is thin, so the value is in the parts that were previously
 * buried in a load effect: that ordering is requested explicitly (positional
 * consumers depend on it), that a block whose exercise didn't resolve is
 * dropped from the domain view but still counted for the stale-session
 * predicate, and the resume-position rules around skipped blocks.
 */
import {
  loadWorkoutSession,
  resolveResumePosition,
  workingSetsForBlock,
} from '../loadSession';
import type { SetLog } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '../types';

type Client = Parameters<typeof loadWorkoutSession>[0];

function stubClient(data: {
  session?: Record<string, unknown> | null;
  blocks?: Record<string, unknown>[];
  sets?: Record<string, unknown>[];
  blocksError?: { message: string } | null;
}) {
  const ordered: string[] = [];
  const client = {
    from(table: string) {
      if (table === 'workout_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                data.session
                  ? { data: data.session, error: null }
                  : { data: null, error: { message: 'not found' } },
            }),
          }),
        };
      }
      if (table === 'exercise_blocks') {
        return {
          select: () => ({
            eq: () => ({
              order: async (col: string) => {
                ordered.push(`exercise_blocks:${col}`);
                return { data: data.blocks ?? [], error: data.blocksError ?? null };
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          in: () => ({
            order: async (col: string) => {
              ordered.push(`set_logs:${col}`);
              return { data: data.sets ?? [], error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: client as unknown as Client, ordered };
}

const exercise = { id: 'e1', name: 'Bench', primary_muscle: 'chest' };
const blockRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  exercise_id: 'e1',
  order: 1,
  target_sets: 3,
  target_rep_range: [8, 12],
  target_rir: 2,
  target_weight_kg: 100,
  target_rest_seconds: 180,
  exercises: exercise,
  ...overrides,
});
const setRow = (id: string, blockId: string, setNumber: number) => ({
  id,
  exercise_block_id: blockId,
  set_number: setNumber,
  weight_kg: 100,
  reps: 8,
  rpe: 8,
  is_warmup: false,
  set_type: 'normal',
  quality: 'stimulative',
  quality_reason: '',
  logged_at: '2026-05-01T10:00:00.000Z',
});
const sessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  user_id: 'u1',
  state: 'in_progress',
  planned_date: '2026-05-01',
  ...overrides,
});

describe('loadWorkoutSession', () => {
  it('returns null for a session that does not exist', async () => {
    const { client } = stubClient({ session: null });
    expect(await loadWorkoutSession(client, 's1')).toBeNull();
  });

  it('requests blocks by order and sets by set_number', async () => {
    // Positional consumers (previousSets[i] is that workout's i-th working
    // set) break silently without this, and the result is irreproducible.
    const { client, ordered } = stubClient({
      session: sessionRow(),
      blocks: [blockRow('b1')],
      sets: [setRow('x', 'b1', 1)],
    });
    await loadWorkoutSession(client, 's1');
    expect(ordered).toEqual(['exercise_blocks:order', 'set_logs:set_number']);
  });

  it('drops a block whose exercise did not resolve but still counts the row', async () => {
    // blockRowCount feeds the stale-empty-session predicate, which asks "were
    // there any block ROWS", not "were any of them usable".
    const { client } = stubClient({
      session: sessionRow(),
      blocks: [blockRow('b1'), blockRow('b2', { exercises: null })],
    });
    const loaded = (await loadWorkoutSession(client, 's1'))!;

    expect(loaded.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(loaded.blockRowCount).toBe(2);
    expect(loaded.rawBlocks).toHaveLength(2);
  });

  it('skips the sets query entirely when there are no blocks', async () => {
    const { client, ordered } = stubClient({ session: sessionRow(), blocks: [] });
    const loaded = (await loadWorkoutSession(client, 's1'))!;

    expect(loaded.sets).toEqual([]);
    expect(ordered).toEqual(['exercise_blocks:order']);
  });

  it('collects skipped block ids from skipped_at', async () => {
    const { client } = stubClient({
      session: sessionRow(),
      blocks: [blockRow('b1'), blockRow('b2', { skipped_at: '2026-05-01T11:00:00Z' })],
    });
    const loaded = (await loadWorkoutSession(client, 's1'))!;
    expect(Array.from(loaded.skippedBlockIds)).toEqual(['b2']);
  });

  it('surfaces the location, defaulting to null on legacy rows', async () => {
    const withLoc = stubClient({ session: sessionRow({ location_id: 'gym-1' }), blocks: [] });
    expect((await loadWorkoutSession(withLoc.client, 's1'))!.locationId).toBe('gym-1');

    const legacy = stubClient({ session: sessionRow(), blocks: [] });
    expect((await loadWorkoutSession(legacy.client, 's1'))!.locationId).toBeNull();
  });

  it('throws when the blocks query itself fails', async () => {
    // Distinct from "a session with no blocks", which is a legitimate shell.
    const { client } = stubClient({ session: sessionRow(), blocksError: { message: 'boom' } });
    await expect(loadWorkoutSession(client, 's1')).rejects.toEqual({ message: 'boom' });
  });
});

describe('resolveResumePosition', () => {
  const blocks = (...specs: [string, number][]) =>
    specs.map(([id, targetSets]) => ({ id, targetSets })) as Pick<
      ExerciseBlockWithExercise,
      'id' | 'targetSets'
    >[];
  const set = (blockId: string, setNumber: number, extra: Partial<SetLog> = {}): SetLog =>
    ({ id: `${blockId}-${setNumber}`, exerciseBlockId: blockId, setNumber, isWarmup: false, setType: 'normal', ...extra } as SetLog);

  it('starts a fresh session at the first block, set 1', () => {
    expect(resolveResumePosition(blocks(['b1', 3], ['b2', 3]), [])).toEqual({
      blockIndex: 0,
      setNumber: 1,
    });
  });

  it('resumes mid-block at the next set number', () => {
    expect(
      resolveResumePosition(blocks(['b1', 3], ['b2', 3]), [set('b1', 1), set('b1', 2)])
    ).toEqual({ blockIndex: 0, setNumber: 3 });
  });

  it('moves to the next block once the current one is complete', () => {
    expect(
      resolveResumePosition(blocks(['b1', 2], ['b2', 3]), [set('b1', 1), set('b1', 2)])
    ).toEqual({ blockIndex: 1, setNumber: 1 });
  });

  it('never resumes onto a skipped block', () => {
    expect(
      resolveResumePosition(blocks(['b1', 3], ['b2', 3]), [], new Set(['b1']))
    ).toEqual({ blockIndex: 1, setNumber: 1 });
  });

  it('skips a skipped block even when a later one is incomplete', () => {
    const result = resolveResumePosition(
      blocks(['b1', 3], ['b2', 3], ['b3', 3]),
      [set('b1', 1), set('b1', 2), set('b1', 3)],
      new Set(['b2'])
    );
    expect(result).toEqual({ blockIndex: 2, setNumber: 1 });
  });

  it('ignores warmups when counting progress', () => {
    const result = resolveResumePosition(blocks(['b1', 2]), [
      set('b1', 1, { isWarmup: true }),
      set('b1', 1),
    ]);
    expect(result).toEqual({ blockIndex: 0, setNumber: 2 });
  });

  it('holds on the last block rather than pointing past the end when all are done', () => {
    const result = resolveResumePosition(blocks(['b1', 1], ['b2', 1]), [set('b1', 1), set('b2', 1)]);
    expect(result.blockIndex).toBe(0);
    expect(result.blockIndex).toBeLessThan(2);
  });

  it('does not point at a skipped block when everything else is complete', () => {
    const result = resolveResumePosition(
      blocks(['b1', 1], ['b2', 1]),
      [set('b2', 1)],
      new Set(['b1'])
    );
    expect(result.blockIndex).toBe(1);
  });
});

describe('workingSetsForBlock', () => {
  it('excludes warmups by flag and by set type', () => {
    const sets = [
      { id: '1', exerciseBlockId: 'b1', isWarmup: true, setType: 'normal' },
      { id: '2', exerciseBlockId: 'b1', isWarmup: false, setType: 'warmup' },
      { id: '3', exerciseBlockId: 'b1', isWarmup: false, setType: 'normal' },
      { id: '4', exerciseBlockId: 'b2', isWarmup: false, setType: 'normal' },
    ] as SetLog[];
    expect(workingSetsForBlock(sets, 'b1').map((s) => s.id)).toEqual(['3']);
  });
});
