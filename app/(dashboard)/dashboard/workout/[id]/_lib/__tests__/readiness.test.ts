import {
  applyFrozenOrder,
  buildReadinessRows,
  hoursUntilReadinessThreshold,
  readinessScore,
  READINESS_AMBER_THRESHOLD,
  READINESS_READY_THRESHOLD,
  selectGoodTargets,
  type ReadinessRow,
} from '../readiness';
import type { MuscleRecoveryResult, RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';
import { COARSE_MUSCLES, type MuscleVolumeStats } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

const NOW = new Date('2026-07-11T12:00:00.000Z');

function stat(muscle: string, sets: number): MuscleVolumeStats {
  return { muscle, sets, target: 0, status: 'optimal', exercises: [{ id: muscle, name: `${muscle} ex`, sets }] };
}

function session(
  performedAt: Date,
  primaryMuscle: string,
  setCount: number,
  repsInTank: number | null
): RecoverySession {
  return {
    performedAt,
    exercises: [
      { primaryMuscle, secondaryMuscles: [], sets: Array.from({ length: setCount }, () => ({ repsInTank })) },
    ],
  };
}

function rowFor(rows: ReadinessRow[], muscle: string): ReadinessRow {
  const row = rows.find((r) => r.muscle === muscle);
  if (!row) throw new Error(`no row for ${muscle}`);
  return row;
}

describe('buildReadinessRows (coarse rows)', () => {
  it('emits exactly one row per coarse muscle group', () => {
    const rows = buildReadinessRows([], [], NOW);
    expect(rows).toHaveLength(COARSE_MUSCLES.length);
  });

  it('places a Fresh, under-volume group above a Fatigued, under-volume group', () => {
    const history = [session(NOW, 'quads', 4, 2)]; // quads trained now → Fatigued
    const rows = buildReadinessRows([], history, NOW);

    expect(rowFor(rows, 'calves').recovery.status).toBe('fresh');
    expect(rowFor(rows, 'quads').recovery.status).toBe('fatigued');
    expect(rows.findIndex((r) => r.muscle === 'calves')).toBeLessThan(
      rows.findIndex((r) => r.muscle === 'quads')
    );
  });

  it('within Fresh groups, ranks the bigger volume gap first', () => {
    // Both Fresh (untrained). shoulders MEV 8, biceps MEV 6 → shoulders first.
    const rows = buildReadinessRows([], [], NOW);
    expect(rows.findIndex((r) => r.muscle === 'shoulders')).toBeLessThan(
      rows.findIndex((r) => r.muscle === 'biceps')
    );
  });

  it('a group at MEV ranks below an equally-recovered group behind target', () => {
    const rows = buildReadinessRows([stat('biceps', 6)], [], NOW); // biceps MEV 6 → gap 0
    expect(rowFor(rows, 'biceps').volumeGap).toBe(0);
    expect(rows.findIndex((r) => r.muscle === 'triceps')).toBeLessThan(
      rows.findIndex((r) => r.muscle === 'biceps')
    );
  });

  it('rolls fine standard sets into the coarse row with the shared band + zone', () => {
    const rows = buildReadinessRows([stat('chest_upper', 5)], [], NOW);
    const chest = rowFor(rows, 'chest');
    expect(chest.sets).toBe(5);
    expect(chest.band).toEqual({ mev: 8, mrv: 22 });
    expect(chest.zone).toBe('below_mev'); // 5 < MEV 8
    expect(chest.volumeGap).toBe(3);
  });

  it('carries every reachable fine child with its own recovery (visibility is the list component\'s job)', () => {
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    // glute_med in-zone (5 ≥ MEV 2) — still carried, flagged not-lagging.
    const rows = buildReadinessRows([stat('glutes', 10), stat('glute_med', 5)], [], NOW, reachable);
    const child = rowFor(rows, 'glutes').children.find((c) => c.muscle === 'glute_med');
    expect(child).toBeDefined();
    expect(child!.belowMev).toBe(false);
    expect(child!.recovery.status).toBe('fresh');
  });

  it('surfaces a reachable, lagging fine child under an on-target parent', () => {
    // Glutes at MEV via glute max; glute_med reachable but untrained (0 < MEV 2).
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const rows = buildReadinessRows([stat('glutes', 16)], [], NOW, reachable);
    const glutes = rowFor(rows, 'glutes');
    expect(glutes.zone).toBe('in_zone'); // parent is fine
    const child = glutes.children.find((c) => c.muscle === 'glute_med');
    expect(child).toBeDefined();
    expect(child!.belowMev).toBe(true);
  });
});

describe('recovery aggregation + divergence auto-expand (shoulders fixture)', () => {
  const DELTS = new Set<StandardMuscleGroup>(['front_delts', 'lateral_delts', 'rear_delts']);

  it('side delts Fatigued + front/rear Fresh → parent Fatigued, auto-expands, counted once', () => {
    const history: RecoverySession[] = [
      session(NOW, 'lateral_delts', 8, 0), // just maxed → Fatigued
      session(hoursBefore(NOW, 120), 'front_delts', 4, 2), // 5d ago → Fresh
      session(hoursBefore(NOW, 120), 'rear_delts', 4, 2), // 5d ago → Fresh
    ];
    const rows = buildReadinessRows([], history, NOW, DELTS);
    const shoulders = rowFor(rows, 'shoulders');

    // Conservative parent: the LEAST-recovered member wins — never Fresh
    // while a member is Fatigued.
    expect(shoulders.recovery.status).toBe('fatigued');

    // Members keep their OWN recovery for the expanded view.
    const childStatus = (m: string) =>
      shoulders.children.find((c) => c.muscle === m)!.recovery.status;
    expect(childStatus('lateral_delts')).toBe('fatigued');
    expect(childStatus('front_delts')).toBe('fresh');
    expect(childStatus('rear_delts')).toBe('fresh');

    // A Fresh member a full status level away from the Fatigued parent →
    // the parent self-reveals.
    expect(shoulders.autoExpand).toBe(true);

    // Headline math: coarse groups only — shoulders appears once in the
    // universe and once among the not-ready, regardless of its three members.
    expect(rows).toHaveLength(COARSE_MUSCLES.length);
    expect(rows.filter((r) => r.muscle === 'shoulders')).toHaveLength(1);
    const notReady = rows.filter((r) => r.recovery.status !== 'fresh');
    expect(notReady.map((r) => r.muscle)).toEqual(['shoulders']);
  });

  it('does not auto-expand when every trained member matches the parent status', () => {
    const history: RecoverySession[] = [
      session(NOW, 'lateral_delts', 8, 0),
      session(NOW, 'front_delts', 8, 0),
      session(NOW, 'rear_delts', 8, 0),
    ];
    const rows = buildReadinessRows([], history, NOW, DELTS);
    const shoulders = rowFor(rows, 'shoulders');
    expect(shoulders.recovery.status).toBe('fatigued');
    expect(shoulders.autoExpand).toBe(false);
  });

  it('never-trained (no-data) members do not count as divergence', () => {
    // Only the side delts have ever been trained; front/rear have no data.
    const history: RecoverySession[] = [session(NOW, 'lateral_delts', 8, 0)];
    const rows = buildReadinessRows([], history, NOW, DELTS);
    const shoulders = rowFor(rows, 'shoulders');
    expect(shoulders.recovery.status).toBe('fatigued');
    expect(shoulders.autoExpand).toBe(false);
  });
});

/** Every coarse group at/above MEV → no coarse group lags on volume. */
const ALL_AT_MEV = [
  stat('chest_upper', 12), stat('lats', 14), stat('front_delts', 12),
  stat('biceps', 12), stat('triceps', 12), stat('quads', 14),
  stat('hamstrings', 12), stat('glutes', 16), stat('calves', 12),
  stat('abs', 12), stat('traps', 10), stat('forearms', 10),
  stat('adductors', 10), stat('erectors', 8),
];

const hoursBefore = (base: Date, h: number) => new Date(base.getTime() - h * 3600 * 1000);

describe('selectGoodTargets', () => {
  it('returns up to N Fresh, under-volume targets (coarse + fine children)', () => {
    const { targets } = selectGoodTargets(buildReadinessRows([], [], NOW), 3);
    expect(targets).toHaveLength(3);
    targets.forEach((t) => {
      expect(t.score).toBeGreaterThan(0);
      expect(t.tier).toBe('ready');
    });
  });

  it('a lagging fine child appears in targets even when its parent is on target', () => {
    // Every coarse group at/above MEV so no coarse candidates remain; only the
    // reachable, untrained fine child glute_med lags → it is the top target.
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const { targets } = selectGoodTargets(buildReadinessRows(ALL_AT_MEV, [], NOW, reachable), 3);
    expect(targets.some((t) => t.muscle === 'glute_med' && t.isChild)).toBe(true);
  });

  it('excludes fatigued groups even when far below target', () => {
    const history: RecoverySession[] = [
      { performedAt: NOW, exercises: [{ primaryMuscle: 'quads', secondaryMuscles: [], sets: Array.from({ length: 10 }, () => ({ repsInTank: 0 })) }] },
    ];
    const { targets } = selectGoodTargets(buildReadinessRows([], history, NOW), 3);
    expect(targets.every((t) => t.muscle !== 'quads')).toBe(true);
  });

  it('never presents a Recovering muscle as a ready-now target', () => {
    // The bug fixture: the most-behind muscle (triceps, 0 sets → gap 6) is
    // Recovering (~18h out), while every other muscle is Fresh but at/above MEV
    // (a "Fresh, mid-zone" muscle has gap 0, so it isn't eligible either).
    const triceps = { ...stat('triceps', 12), sets: 0, exercises: [{ id: 'triceps', name: 'triceps ex', sets: 0 }] };
    const stats = [triceps, ...ALL_AT_MEV.filter((s) => s.muscle !== 'triceps')];
    // Trained 30h ago (window 36h) → Recovering, ~6h until Fresh (> soon window).
    const history = [session(hoursBefore(NOW, 30), 'triceps', 5, 2)];
    // Empty reachable → no fine children surface; the coarse triceps row is the
    // sole lagging candidate, keeping the fixture focused on the reported bug.
    const noChildren = new Set<StandardMuscleGroup>();

    const { targets, nextUp } = selectGoodTargets(buildReadinessRows(stats, history, NOW, noChildren), 3);

    // The recovering muscle is NEVER a ready-now pick…
    expect(targets.every((t) => !(t.muscle === 'triceps' && t.tier === 'ready'))).toBe(true);
    // …and with it too far out for the soon tier, the strip falls back to the
    // honest empty state naming triceps as the soonest-ready lagging muscle.
    expect(targets).toHaveLength(0);
    expect(nextUp?.muscle).toBe('triceps');
    expect(Math.round(nextUp!.hoursUntilReady)).toBe(6);
  });

  it('offers a lagging, nearly-ready muscle as a muted "ready soon" pick, not ready-now', () => {
    const triceps = { ...stat('triceps', 12), sets: 0, exercises: [{ id: 'triceps', name: 'triceps ex', sets: 0 }] };
    const stats = [triceps, ...ALL_AT_MEV.filter((s) => s.muscle !== 'triceps')];
    // Trained 34h ago (window 36h) → Recovering, ~2h until Fresh (within soon window).
    const history = [session(hoursBefore(NOW, 34), 'triceps', 5, 2)];
    const noChildren = new Set<StandardMuscleGroup>();

    const { targets, nextUp } = selectGoodTargets(buildReadinessRows(stats, history, NOW, noChildren), 3);

    const tri = targets.find((t) => t.muscle === 'triceps');
    expect(tri).toBeDefined();
    expect(tri!.tier).toBe('soon');
    expect(Math.round(tri!.readyInHours)).toBe(2);
    // Present as a target → no empty-state fallback needed.
    expect(nextUp).toBeNull();
  });
});

describe('buildReadinessRows soreness overrides ("still sore" today)', () => {
  it('forces an otherwise-Fresh muscle to Fatigued for the session', () => {
    // Hamstrings trained 5 days ago → time model says Fresh.
    const history = [session(new Date(NOW.getTime() - 5 * 24 * 3600 * 1000), 'hamstrings', 4, 2)];

    const without = buildReadinessRows([], history, NOW);
    expect(rowFor(without, 'hamstrings').recovery.status).toBe('fresh');

    const overrides = new Set<StandardMuscleGroup>(['hamstrings']);
    const rows = buildReadinessRows([], history, NOW, undefined, undefined, overrides);
    expect(rowFor(rows, 'hamstrings').recovery.status).toBe('fatigued');
  });

  it('the override zeroes the muscle\'s actionability score (never a "good target")', () => {
    const history = [session(new Date(NOW.getTime() - 5 * 24 * 3600 * 1000), 'hamstrings', 4, 2)];
    const overrides = new Set<StandardMuscleGroup>(['hamstrings']);
    const rows = buildReadinessRows([], history, NOW, undefined, undefined, overrides);

    expect(rowFor(rows, 'hamstrings').score).toBe(0);
    const { targets } = selectGoodTargets(rows);
    expect(targets.every((t) => t.muscle !== 'hamstrings')).toBe(true);
  });

  it('does not touch other muscles', () => {
    const history = [
      session(new Date(NOW.getTime() - 5 * 24 * 3600 * 1000), 'hamstrings', 4, 2),
      session(new Date(NOW.getTime() - 5 * 24 * 3600 * 1000), 'biceps', 4, 2),
    ];
    const overrides = new Set<StandardMuscleGroup>(['hamstrings']);
    const rows = buildReadinessRows([], history, NOW, undefined, undefined, overrides);

    expect(rowFor(rows, 'biceps').recovery.status).toBe('fresh');
  });
});

describe('readinessScore / hoursUntilReadinessThreshold', () => {
  const rec = (hoursSinceLast: number | null, windowHours: number | null): MuscleRecoveryResult =>
    ({
      status: 'recovering',
      hoursSinceLast,
      estimatedReadyAt: null,
      lastTrainedAt: hoursSinceLast === null ? null : NOW,
      hoursUntilReady: 0,
      windowHours,
      dose: 4,
    }) as MuscleRecoveryResult;

  it('is 1 for a never-trained muscle', () => {
    expect(readinessScore(rec(null, null))).toBe(1);
  });

  it('is the clamped fraction of the recovery window elapsed', () => {
    expect(readinessScore(rec(0, 48))).toBe(0);
    expect(readinessScore(rec(24, 48))).toBe(0.5);
    expect(readinessScore(rec(48, 48))).toBe(1);
    expect(readinessScore(rec(96, 48))).toBe(1); // clamped past the window
  });

  it('reports 0 hours when already at/above the ready threshold', () => {
    expect(hoursUntilReadinessThreshold(rec(40, 48))).toBe(0); // 40/48 ≈ 0.83 ≥ 0.8
    expect(hoursUntilReadinessThreshold(rec(null, null))).toBe(0);
  });

  it('reports the hours remaining until readiness crosses the threshold', () => {
    // 0.8 × 48h window = 38.4h; 24h elapsed → 14.4h to go.
    expect(hoursUntilReadinessThreshold(rec(24, 48))).toBeCloseTo(14.4);
  });

  it('the thresholds bracket green/amber/red as documented', () => {
    expect(READINESS_READY_THRESHOLD).toBe(0.8);
    expect(READINESS_AMBER_THRESHOLD).toBe(0.5);
  });
});

describe('applyFrozenOrder', () => {
  it('keeps the frozen relative order for known keys', () => {
    expect(applyFrozenOrder(['b', 'a', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('appends keys the frozen order has not seen, in desired order', () => {
    expect(applyFrozenOrder(['d', 'b', 'a'], ['a', 'b'])).toEqual(['a', 'b', 'd']);
  });

  it('drops frozen keys absent from the desired set', () => {
    expect(applyFrozenOrder(['b'], ['a', 'b', 'c'])).toEqual(['b']);
  });
});
