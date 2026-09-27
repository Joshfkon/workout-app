/**
 * The explicit `unknown` readiness status: a group with no evidence (no
 * recovery debt, nothing in the known-muscles lookback) must never read as
 * Fresh, never be a Good Target, and rank below Fresh but above Recovering.
 */
import {
  buildReadinessRows,
  compareByActionability,
  knownMusclesFromExercises,
  readinessTier,
  selectGoodTargets,
  type ReadinessRow,
} from '../readiness';
import { computeMuscleRecovery, type RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';
import type { MuscleVolumeStats } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const hoursBefore = (base: Date, h: number) => new Date(base.getTime() - h * 3600 * 1000);

function stat(muscle: string, sets: number): MuscleVolumeStats {
  return { muscle, sets, effectiveSets: sets, unratedSets: 0, directSets: sets, indirectSets: 0, directEffectiveSets: sets, indirectEffectiveSets: 0, target: 0, status: 'optimal', exercises: [{ id: muscle, name: `${muscle} ex`, performedSets: sets, sets, effective: sets, direct: sets, indirect: 0, directEffective: sets, indirectEffective: 0 }] };
}

function session(performedAt: Date, primaryMuscle: string, setCount: number, repsInTank: number | null): RecoverySession {
  return {
    performedAt,
    exercises: [{ primaryMuscle, secondaryMuscles: [], sets: Array.from({ length: setCount }, () => ({ repsInTank })) }],
  };
}

function rowFor(rows: ReadinessRow[], muscle: string): ReadinessRow {
  const row = rows.find((r) => r.muscle === muscle);
  if (!row) throw new Error(`no row for ${muscle}`);
  return row;
}

/** Every coarse group at/above MEV → no coarse group lags on volume. */
const ALL_AT_MEV = [
  stat('chest_upper', 12), stat('lats', 14), stat('front_delts', 12),
  stat('biceps', 12), stat('triceps', 12), stat('quads', 14),
  stat('hamstrings', 12), stat('glutes', 16), stat('calves', 12),
  stat('abs', 12), stat('traps', 10), stat('forearms', 10),
  stat('adductors', 10), stat('erectors', 8),
];

describe('unknown readiness (zero-history groups)', () => {
  // The reported bug: Forearms with 0 credited sets and "No recent data" was
  // listed in Good Targets Today because missing data read as Fresh.
  it('a zero-history group is unknown, scores 0 and is never a good target', () => {
    const rows = buildReadinessRows([], [], NOW);
    const forearms = rowFor(rows, 'forearms');
    expect(forearms.volumeGap).toBeGreaterThan(0); // 0 sets vs MEV 4
    expect(forearms.recovery.status).toBe('fresh'); // the heuristic is unchanged
    expect(forearms.readiness).toBe('unknown');
    expect(forearms.score).toBe(0);

    const { targets, nextUp } = selectGoodTargets(rows, 3);
    expect(targets).toHaveLength(0);
    expect(nextUp).toBeNull();
  });

  it('with only zero-history groups otherwise, trained groups are still targets', () => {
    // Chest trained 5 days ago (Fresh, 3 sets < MEV 8); nothing else ever.
    const history = [session(hoursBefore(NOW, 120), 'chest', 3, 2)];
    const rows = buildReadinessRows([stat('chest', 3)], history, NOW);
    const { targets } = selectGoodTargets(rows, 3);
    // Chest and its trained heads; nothing without evidence.
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.muscle.startsWith('chest'))).toBe(true);
  });

  it('a group trained inside the known lookback (but not this week) is Fresh, not unknown', () => {
    const known = new Set<StandardMuscleGroup>(['forearms']);
    const rows = buildReadinessRows([], [], NOW, undefined, undefined, undefined, undefined, known);
    expect(rowFor(rows, 'forearms').readiness).toBe('fresh');
    expect(rowFor(rows, 'calves').readiness).toBe('unknown');
    const { targets } = selectGoodTargets(rows, 3);
    expect(targets.map((t) => t.muscle)).toEqual(['forearms']);
  });

  it('a fine child is unknown unless that child itself has evidence', () => {
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const known = new Set<StandardMuscleGroup>(['glutes']);
    const rows = buildReadinessRows(ALL_AT_MEV, [], NOW, reachable, undefined, undefined, undefined, known);
    const gluteMed = rowFor(rows, 'glutes').children.find((c) => c.muscle === 'glute_med')!;
    expect(gluteMed.readiness).toBe('unknown');
    expect(selectGoodTargets(rows, 3).targets.some((t) => t.muscle === 'glute_med')).toBe(false);
  });

  it('a recovery debt or soreness report outranks "unknown"', () => {
    const rows = buildReadinessRows([], [session(NOW, 'quads', 4, 2)], NOW);
    expect(rowFor(rows, 'quads').readiness).toBe('fatigued');
    const sore = buildReadinessRows([], [], NOW, undefined, undefined, new Set<StandardMuscleGroup>(['hamstrings']));
    expect(rowFor(sore, 'hamstrings').readiness).toBe('fatigued');
  });

  it('readinessTier orders fresh-with-deficit > fresh > unknown > recovering > fatigued', () => {
    const order = [
      readinessTier('fresh', 3),
      readinessTier('fresh', 0),
      readinessTier('unknown', 5),
      readinessTier('recovering', 5),
      readinessTier('fatigued', 5),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(5);
  });

  it('sorts rows by that tier order', () => {
    // biceps: known, Fresh, at MEV (no deficit). chest: known, Fresh, deficit.
    // forearms: unknown. quads: fatigued (trained now).
    const known = new Set<StandardMuscleGroup>(['biceps', 'chest_upper', 'chest_lower', 'quads']);
    const rows = buildReadinessRows(
      [stat('biceps', 10)],
      [session(NOW, 'quads', 4, 2)],
      NOW,
      undefined,
      undefined,
      undefined,
      undefined,
      known
    );
    const idx = (m: string) => rows.findIndex((r) => r.muscle === m);
    expect(idx('chest')).toBeLessThan(idx('biceps'));
    expect(idx('biceps')).toBeLessThan(idx('forearms'));
    expect(idx('forearms')).toBeLessThan(idx('quads'));
    // And the comparator agrees pairwise.
    expect(compareByActionability(rowFor(rows, 'forearms'), rowFor(rows, 'quads'))).toBeLessThan(0);
  });

  it('places unknown above recovering', () => {
    // Triceps positioned Recovering (well inside its window); forearms unknown.
    const probe = computeMuscleRecovery([session(hoursBefore(NOW, 1), 'triceps', 5, 2)], 'triceps', NOW);
    const history = [session(hoursBefore(NOW, probe.windowHours! * 0.8), 'triceps', 5, 2)];
    const rows = buildReadinessRows([], history, NOW);
    expect(rowFor(rows, 'triceps').readiness).toBe('recovering');
    expect(rowFor(rows, 'forearms').readiness).toBe('unknown');
    expect(rows.findIndex((r) => r.muscle === 'forearms')).toBeLessThan(
      rows.findIndex((r) => r.muscle === 'triceps')
    );
  });
});

describe('knownMusclesFromExercises', () => {
  it('collects primary and secondary credited muscles', () => {
    const known = knownMusclesFromExercises([
      { primaryMuscle: 'biceps', secondaryMuscles: ['forearms'] },
    ]);
    expect(known.has('forearms')).toBe(true);
    expect(Array.from(known).some((m) => m.startsWith('biceps'))).toBe(true);
    expect(known.has('quads')).toBe(false);
  });

  it('is empty for no exercises', () => {
    expect(knownMusclesFromExercises([]).size).toBe(0);
  });
});
