import {
  buildReadinessRows,
  topTargets,
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

describe('topTargets', () => {
  it('returns up to N recovered, under-volume targets (coarse + fine children)', () => {
    const top = topTargets(buildReadinessRows([], [], NOW), 3);
    expect(top).toHaveLength(3);
    top.forEach((t) => expect(t.score).toBeGreaterThan(0));
  });

  it('a lagging fine child appears in targets even when its parent is on target', () => {
    // Every coarse group at/above MEV so no coarse candidates remain; only the
    // reachable, untrained fine child glute_med lags → it is the top target.
    const fullyTrained = [
      stat('chest_upper', 12), stat('lats', 14), stat('front_delts', 12),
      stat('biceps', 12), stat('triceps', 12), stat('quads', 14),
      stat('hamstrings', 12), stat('glutes', 16), stat('calves', 12),
      stat('abs', 12), stat('traps', 10), stat('forearms', 10),
      stat('adductors', 10), stat('erectors', 8),
    ];
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const top = topTargets(buildReadinessRows(fullyTrained, [], NOW, reachable), 3);
    expect(top.some((t) => t.muscle === 'glute_med' && t.isChild)).toBe(true);
  });

  it('excludes fatigued groups even when far below target', () => {
    const history: RecoverySession[] = [
      { performedAt: NOW, exercises: [{ primaryMuscle: 'quads', secondaryMuscles: [], sets: Array.from({ length: 10 }, () => ({ repsInTank: 0 })) }] },
    ];
    const top = topTargets(buildReadinessRows([], history, NOW), 3);
    expect(top.every((t) => t.muscle !== 'quads')).toBe(true);
  });
});
