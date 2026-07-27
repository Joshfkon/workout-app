/**
 * Phase 0b — header set-history line must never mislabel, truncate, or
 * collapse heterogeneous set history. The Arnold Press Jul 20 session is the
 * pinned live-corruption case.
 */

import { formatSetHistoryLine, MAX_DETAILED_SETS } from '../formatSetHistory';

const arnoldJul20 = [
  { weightLabel: '45 lbs', reps: 8, rir: 3 },
  { weightLabel: '45 lbs', reps: 8, rir: 1 },
  { weightLabel: '40 lbs', reps: 10, rir: 0 },
  { weightLabel: '40 lbs', reps: 8, rir: 0 },
];

describe('formatSetHistoryLine', () => {
  it('Arnold Press header corruption case: per-set loads, all four sets, honest RIR span', () => {
    // Live header read "45 lbs x 8, x 8, x 10 @ 3 RIR" — 40 mislabeled as 45,
    // set 4 dropped, RIR collapsed to set 1's.
    const line = formatSetHistoryLine(arnoldJul20);
    expect(line).toBe('45 lbs × 8, × 8 · 40 lbs × 10, × 8 @ 0–3 RIR');
  });

  it('never attributes one load to sets performed at another', () => {
    const line = formatSetHistoryLine(arnoldJul20)!;
    expect(line).toContain('40 lbs × 10');
    expect(line).not.toContain('45 lbs × 8, × 8, × 10');
  });

  it('homogeneous sessions keep the compact single-load form', () => {
    const line = formatSetHistoryLine([
      { weightLabel: '60 lbs', reps: 9, rir: 2 },
      { weightLabel: '60 lbs', reps: 8, rir: 2 },
    ]);
    expect(line).toBe('60 lbs × 9, × 8 @ 2 RIR');
  });

  it('omits the RIR claim entirely when no set carries an effort signal', () => {
    const line = formatSetHistoryLine([
      { weightLabel: '60 lbs', reps: 9, rir: null },
      { weightLabel: '60 lbs', reps: 8, rir: null },
    ]);
    expect(line).toBe('60 lbs × 9, × 8');
  });

  it('long sessions summarize as an honest range — never a silent slice', () => {
    const sets = Array.from({ length: MAX_DETAILED_SETS + 1 }, (_, i) => ({
      weightLabel: i < 4 ? '45 lbs' : '40 lbs',
      reps: 8 + (i % 3),
      rir: i === 0 ? 3 : 0,
    }));
    const line = formatSetHistoryLine(sets)!;
    expect(line).toContain(`(${sets.length} sets)`);
    expect(line).toContain('45 lbs');
    expect(line).toContain('40 lbs');
    expect(line).toContain('@ 0–3 RIR');
  });

  it('appends the seconds suffix for duration exercises', () => {
    const line = formatSetHistoryLine(
      [{ weightLabel: '25 lbs', reps: 45, rir: 2 }],
      { secondsSuffix: true }
    );
    expect(line).toBe('25 lbs × 45s @ 2 RIR');
  });

  it('returns null for an empty session', () => {
    expect(formatSetHistoryLine([])).toBeNull();
  });
});
