import {
  buildReadinessRows,
  selectGoodTargets,
  type ReadinessRow,
} from '../readiness';
import type { RecoverySession } from '@/services/muscleRecovery';
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
    // Trained 30h ago (window 48h) → Recovering, ~18h until Fresh (> soon window).
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
    expect(Math.round(nextUp!.hoursUntilReady)).toBe(18);
  });

  it('offers a lagging, nearly-ready muscle as a muted "ready soon" pick, not ready-now', () => {
    const triceps = { ...stat('triceps', 12), sets: 0, exercises: [{ id: 'triceps', name: 'triceps ex', sets: 0 }] };
    const stats = [triceps, ...ALL_AT_MEV.filter((s) => s.muscle !== 'triceps')];
    // Trained 46h ago (window 48h) → Recovering, ~2h until Fresh (within soon window).
    const history = [session(hoursBefore(NOW, 46), 'triceps', 5, 2)];
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
