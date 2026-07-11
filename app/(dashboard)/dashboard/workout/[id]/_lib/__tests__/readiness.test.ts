import {
  buildReadinessRows,
  topTargets,
  type ReadinessRow,
} from '../readiness';
import type { RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';

const NOW = new Date('2026-07-11T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
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
      {
        primaryMuscle,
        secondaryMuscles: [],
        sets: Array.from({ length: setCount }, () => ({ repsInTank })),
      },
    ],
  };
}

function rowFor(rows: ReadinessRow[], muscle: StandardMuscleGroup): ReadinessRow {
  const row = rows.find((r) => r.muscle === muscle);
  if (!row) throw new Error(`no row for ${muscle}`);
  return row;
}

describe('buildReadinessRows', () => {
  it('emits exactly one row per standard muscle group', () => {
    const rows = buildReadinessRows({}, [], NOW);
    expect(rows).toHaveLength(20);
  });

  it('places a Fresh, under-volume muscle above a Fatigued, under-volume muscle', () => {
    // calves: no recent training → Fresh, 0 sets (well under MEV 6).
    // quads: trained now → Fatigued, also 0 weekly sets vs MEV 6.
    const history = [session(NOW, 'quads', 4, 2)];
    const rows = buildReadinessRows({}, history, NOW);

    const calvesIdx = rows.findIndex((r) => r.muscle === 'calves');
    const quadsIdx = rows.findIndex((r) => r.muscle === 'quads');

    expect(rowFor(rows, 'calves').recovery.status).toBe('fresh');
    expect(rowFor(rows, 'quads').recovery.status).toBe('fatigued');
    expect(calvesIdx).toBeLessThan(quadsIdx);
  });

  it('within Fresh muscles, ranks the bigger volume gap first', () => {
    // Both Fresh (untrained). lateral_delts MEV 6, biceps MEV 4 → delts have a
    // bigger gap, so they should rank above biceps.
    const rows = buildReadinessRows({}, [], NOW);
    const deltsIdx = rows.findIndex((r) => r.muscle === 'lateral_delts');
    const bicepsIdx = rows.findIndex((r) => r.muscle === 'biceps');
    expect(deltsIdx).toBeLessThan(bicepsIdx);
  });

  it('a muscle already at target ranks below an equally-recovered muscle behind target', () => {
    // biceps at MEV (4 sets) vs triceps at 0 — both Fresh. triceps ranks higher.
    const rows = buildReadinessRows({ biceps: 4 }, [], NOW);
    const bicepsIdx = rows.findIndex((r) => r.muscle === 'biceps');
    const tricepsIdx = rows.findIndex((r) => r.muscle === 'triceps');
    expect(rowFor(rows, 'biceps').volumeGap).toBe(0);
    expect(tricepsIdx).toBeLessThan(bicepsIdx);
  });

  it('reflects merged weekly sets in the row count and volume status', () => {
    const rows = buildReadinessRows({ chest_upper: 5 }, [], NOW);
    const chest = rowFor(rows, 'chest_upper');
    expect(chest.sets).toBe(5);
    expect(chest.target).toBe(4); // MEV for chest_upper
    expect(chest.volumeStatus).toBe('optimal');
    expect(chest.volumeGap).toBe(0);
  });
});

describe('topTargets', () => {
  it('returns up to N recovered, under-volume muscles in order', () => {
    const rows = buildReadinessRows({}, [], NOW);
    const top = topTargets(rows, 3);
    expect(top).toHaveLength(3);
    top.forEach((r) => {
      expect(r.recovery.status).not.toBe('fatigued');
      expect(r.volumeGap).toBeGreaterThan(0);
    });
    // Ordered by actionability — matches the head of the sorted rows.
    expect(top.map((r) => r.muscle)).toEqual(rows.slice(0, 3).map((r) => r.muscle));
  });

  it('excludes fatigued muscles even when they are far below target', () => {
    // Fatigue every muscle by "training" each right now with a big dose.
    const history: RecoverySession[] = [
      {
        performedAt: NOW,
        exercises: [
          { primaryMuscle: 'quads', secondaryMuscles: [], sets: Array.from({ length: 10 }, () => ({ repsInTank: 0 })) },
        ],
      },
    ];
    const rows = buildReadinessRows({}, history, NOW);
    const top = topTargets(rows, 3);
    expect(top.every((r) => r.muscle !== 'quads')).toBe(true);
  });
});
