import {
  detectProgressionStall,
  detectLoadUnderprescribed,
  LOAD_STALL_SESSIONS,
  UNDERLOAD_CONSECUTIVE_SESSIONS,
  type ProgressionHealthSession,
} from '../progressionHealth';

const LB = 0.45359237;

/**
 * A session of `sets` × reps at one load. Oldest-first lists in tests.
 * `rir: null` = logged with NO effort signal (maps to undefined — a default
 * parameter would silently swallow an explicit undefined).
 */
const session = (
  date: string,
  weightKg: number,
  reps: number[],
  rir: number | null = 2
): ProgressionHealthSession => ({
  date,
  sets: reps.map((r) => ({ weightKg, reps: r, ...(rir === null ? {} : { rir }) })),
});

describe('detectProgressionStall (5a)', () => {
  it('fires on 4 consecutive sessions at a static load (regression 8)', () => {
    const sessions = [
      session('2026-07-08', 62.5 * LB, [10, 10, 9]),
      session('2026-07-15', 62.5 * LB, [10, 10, 10]),
      session('2026-07-22', 62.5 * LB, [11, 10, 10]),
      session('2026-07-29', 62.5 * LB, [11, 11, 10]),
    ];
    const flag = detectProgressionStall(sessions, { minIncrementKg: 2.27 });
    expect(flag).not.toBeNull();
    expect(flag!.sessions).toBeGreaterThanOrEqual(LOAD_STALL_SESSIONS);
    expect(flag!.loadKg).toBeCloseTo(62.5 * LB, 5);
  });

  it('does NOT fire on 3 static sessions, or when the load moved inside the window', () => {
    expect(
      detectProgressionStall(
        [
          session('2026-07-15', 62.5 * LB, [10, 10]),
          session('2026-07-22', 62.5 * LB, [10, 10]),
          session('2026-07-29', 62.5 * LB, [11, 10]),
        ],
        { minIncrementKg: 2.27 }
      )
    ).toBeNull();
    expect(
      detectProgressionStall(
        [
          session('2026-07-08', 55 * LB, [10, 10]),
          session('2026-07-15', 62.5 * LB, [10, 10]),
          session('2026-07-22', 62.5 * LB, [10, 10]),
          session('2026-07-29', 62.5 * LB, [11, 10]),
        ],
        { minIncrementKg: 2.27 }
      )
    ).toBeNull();
  });

  it('names the sharper target-stall claim: +1 met transitions going nowhere (Kelso shape)', () => {
    // Totals 30 → 31 → 32 → 33 at a fixed load: every reconstructed target
    // (prev + 1) met, target only trivially raised — a jam wearing a
    // progression costume, not "on track".
    const sessions = [
      session('2026-07-01', 62.5 * LB, [10, 10, 10]),
      session('2026-07-08', 62.5 * LB, [11, 10, 10]),
      session('2026-07-15', 62.5 * LB, [11, 11, 10]),
      session('2026-07-22', 62.5 * LB, [11, 11, 11]),
    ];
    const flag = detectProgressionStall(sessions, { minIncrementKg: 2.27, repTotal: true });
    expect(flag).not.toBeNull();
    expect(flag!.kind).toBe('target_stall');
    expect(flag!.sessions).toBe(4);
  });

  it('the target-stall claim is gated to rep_total exercises — e1RM mode gets the generic load stall', () => {
    // Same creeping-totals shape, but the exercise does not progress on rep
    // totals: describing a "rep-total target" it never had would be false.
    const sessions = [
      session('2026-07-01', 62.5 * LB, [10, 10, 10]),
      session('2026-07-08', 62.5 * LB, [11, 10, 10]),
      session('2026-07-15', 62.5 * LB, [11, 11, 10]),
      session('2026-07-22', 62.5 * LB, [11, 11, 11]),
    ];
    const flag = detectProgressionStall(sessions, { minIncrementKg: 2.27 });
    expect(flag).not.toBeNull();
    expect(flag!.kind).toBe('load_stall');
  });

  it('decisive total growth at a held load is a load stall, not a target stall', () => {
    // Rep-total exercises legitimately park the load while totals climb —
    // +4/session is real progression, so only the load-parked claim renders.
    const sessions = [
      session('2026-07-01', 62.5 * LB, [10, 10, 10]),
      session('2026-07-08', 62.5 * LB, [12, 11, 11]),
      session('2026-07-15', 62.5 * LB, [13, 13, 12]),
      session('2026-07-22', 62.5 * LB, [14, 14, 14]),
    ];
    const flag = detectProgressionStall(sessions, { minIncrementKg: 2.27, repTotal: true });
    expect(flag).not.toBeNull();
    expect(flag!.kind).toBe('load_stall');
  });

  it('returns null with fewer than 2 usable sessions', () => {
    expect(detectProgressionStall([session('2026-07-29', 50, [10])])).toBeNull();
    expect(detectProgressionStall([])).toBeNull();
  });
});

describe('detectLoadUnderprescribed (5b)', () => {
  it('fires on 2 consecutive sessions above the ceiling at RIR ≥ 2 (regression 8)', () => {
    // Kelso Shrug shape: 14 reps @3 RIR in an 8-12 range, two sessions
    // running — the engine must recommend a load increase explicitly.
    const sessions = [
      session('2026-07-22', 62.5 * LB, [13, 11, 10], 2),
      session('2026-07-29', 62.5 * LB, [14, 10, 10], 3),
    ];
    const flag = detectLoadUnderprescribed(sessions, 12);
    expect(flag).not.toBeNull();
    expect(flag!.sessions).toBeGreaterThanOrEqual(UNDERLOAD_CONSECUTIVE_SESSIONS);
    expect(flag!.repMax).toBe(12);
    expect(flag!.worstReps).toBe(14);
  });

  it('one above-ceiling session alone does not fire (needs consecutive evidence)', () => {
    const sessions = [
      session('2026-07-22', 62.5 * LB, [10, 10, 10], 2),
      session('2026-07-29', 62.5 * LB, [14, 10, 10], 3),
    ];
    expect(detectLoadUnderprescribed(sessions, 12)).toBeNull();
  });

  it('above-ceiling reps WITHOUT reserve do not fire (grinding past the range is not under-load)', () => {
    const sessions = [
      session('2026-07-22', 62.5 * LB, [14, 12], 0),
      session('2026-07-29', 62.5 * LB, [13, 12], 1),
    ];
    expect(detectLoadUnderprescribed(sessions, 12)).toBeNull();
  });

  it('missing RIR never counts as reserve — no effort signal, no claim', () => {
    const sessions = [
      session('2026-07-22', 62.5 * LB, [14, 12], null),
      session('2026-07-29', 62.5 * LB, [14, 12], null),
    ];
    expect(detectLoadUnderprescribed(sessions, 12)).toBeNull();
  });

  it('high-rep sets at a deliberately lighter load are not evidence against the working load', () => {
    // Each session: top-load work squarely in range, plus a light back-off
    // set running past the ceiling. The flag would tell the user to raise a
    // load that is already appropriate — only top-load-group sets count.
    const sessions: ProgressionHealthSession[] = [
      {
        date: '2026-07-22',
        sets: [
          { weightKg: 100, reps: 10, rir: 2 },
          { weightKg: 100, reps: 9, rir: 2 },
          { weightKg: 60, reps: 18, rir: 3 }, // back-off burnout
        ],
      },
      {
        date: '2026-07-29',
        sets: [
          { weightKg: 100, reps: 10, rir: 2 },
          { weightKg: 60, reps: 17, rir: 3 },
        ],
      },
    ];
    expect(detectLoadUnderprescribed(sessions, 12, { minIncrementKg: 2.5 })).toBeNull();
  });

  it('a break in the run resets it: only the most recent consecutive sessions count', () => {
    const sessions = [
      session('2026-07-15', 62.5 * LB, [14, 13], 3),
      session('2026-07-22', 62.5 * LB, [10, 10], 2), // in-range session breaks the run
      session('2026-07-29', 62.5 * LB, [14, 12], 3),
    ];
    expect(detectLoadUnderprescribed(sessions, 12)).toBeNull();
  });
});
