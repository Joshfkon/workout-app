import {
  selectRecentSignalBlocks,
  type HistoryWindowBlock,
} from '../historyWindow';

function mkBlock(
  completedAt: string | null,
  opts?: { isDeload?: boolean; sets?: { is_warmup: boolean | null }[] }
): HistoryWindowBlock & { tag: string } {
  return {
    tag: completedAt ?? 'null-date',
    workout_sessions: { completed_at: completedAt, is_deload: opts?.isDeload ?? false },
    set_logs: opts?.sets ?? [{ is_warmup: false }],
  };
}

describe('selectRecentSignalBlocks', () => {
  it('drops set-less, warmup-only and deload blocks before counting the window', () => {
    const blocks = [
      mkBlock('2026-08-24T10:00:00Z', { sets: [] }), // skipped
      mkBlock('2026-08-20T10:00:00Z', { sets: [{ is_warmup: true }] }), // warmup-only
      mkBlock('2026-08-17T10:00:00Z', { isDeload: true }), // deload
      mkBlock('2026-08-10T10:00:00Z'),
      mkBlock('2026-08-03T10:00:00Z'),
    ];
    const out = selectRecentSignalBlocks(blocks, 10);
    expect(out.map((b) => b.tag)).toEqual([
      '2026-08-10T10:00:00Z',
      '2026-08-03T10:00:00Z',
    ]);
  });

  it('sorts most-recent-first itself instead of trusting incoming order, then caps', () => {
    const blocks = [
      mkBlock('2026-08-03T10:00:00Z'),
      mkBlock('2026-08-24T10:00:00Z'),
      mkBlock('2026-08-10T10:00:00Z'),
      mkBlock('2026-08-17T10:00:00Z'),
    ];
    const out = selectRecentSignalBlocks(blocks, 3);
    expect(out.map((b) => b.tag)).toEqual([
      '2026-08-24T10:00:00Z',
      '2026-08-17T10:00:00Z',
      '2026-08-10T10:00:00Z',
    ]);
  });

  it('sinks blocks with no parseable session date to the end', () => {
    const blocks = [
      mkBlock(null),
      mkBlock('2026-08-10T10:00:00Z'),
    ];
    const out = selectRecentSignalBlocks(blocks, 10);
    expect(out.map((b) => b.tag)).toEqual(['2026-08-10T10:00:00Z', 'null-date']);
  });

  it('tolerates null/undefined input and null session joins', () => {
    expect(selectRecentSignalBlocks(null, 5)).toEqual([]);
    expect(selectRecentSignalBlocks(undefined, 5)).toEqual([]);
    const orphan: HistoryWindowBlock = { workout_sessions: null, set_logs: [{ is_warmup: false }] };
    // No session join: not a deload, still counts as signal if it has sets —
    // matching computeHistoryFromBlocks, which only requires sets here.
    expect(selectRecentSignalBlocks([orphan], 5)).toHaveLength(1);
  });
});
