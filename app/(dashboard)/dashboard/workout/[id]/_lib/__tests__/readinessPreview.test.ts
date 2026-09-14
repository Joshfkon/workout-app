import {
  buildNextDayPreviewRows,
  nextLocalDaySameTime,
} from '../readinessPreview';
import { buildReadinessRows, selectGoodTargets, type ReadinessRow } from '../readiness';
import { computeMuscleRecovery } from '@/services/muscleRecovery';
import type { RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';
import type { MuscleVolumeStats } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

const NOW = new Date('2026-07-11T12:00:00.000Z');

const hoursBefore = (base: Date, h: number) => new Date(base.getTime() - h * 3600 * 1000);

function stat(muscle: string, sets: number): MuscleVolumeStats {
  return { muscle, sets, effectiveSets: sets, unratedSets: 0, directSets: sets, indirectSets: 0, directEffectiveSets: sets, indirectEffectiveSets: 0, target: 0, status: 'optimal', exercises: [{ id: muscle, name: `${muscle} ex`, performedSets: sets, sets, effective: sets, direct: sets, indirect: 0, directEffective: sets, indirectEffective: 0 }] };
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

describe('nextLocalDaySameTime', () => {
  it('is a calendar-day move preserving wall-clock time', () => {
    const tomorrow = nextLocalDaySameTime(NOW);
    expect(tomorrow.getHours()).toBe(NOW.getHours());
    expect(tomorrow.getMinutes()).toBe(NOW.getMinutes());
    // One local calendar day forward.
    const dayMs = 24 * 3600 * 1000;
    expect(
      Math.round(
        (new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).getTime() -
          new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime()) /
          dayMs
      )
    ).toBe(1);
  });
});

describe('buildNextDayPreviewRows ("preview tomorrow")', () => {
  it('ages the oldest counted day out of the rolling window and re-zones', () => {
    // Biceps at MEV today (10 credited sets), ALL logged on the oldest day
    // still in the window — tomorrow they age out entirely.
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW);
    expect(rowFor(rows, 'biceps').volumeGap).toBe(0);

    const preview = buildNextDayPreviewRows(
      rows,
      { biceps: [0, 0, 0, 0, 0, 0, 10] },
      {},
      [],
      NOW
    );
    const biceps = rowFor(preview, 'biceps');
    expect(biceps.sets).toBe(0);
    expect(biceps.zone).toBe('below_mev');
    expect(biceps.belowMev).toBe(true);
    expect(biceps.volumeGap).toBe(biceps.band.mev);
    expect(biceps.volumeStatus).toBe('low');
  });

  it('keeps volume that is still inside tomorrow\'s window', () => {
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW);
    const preview = buildNextDayPreviewRows(
      rows,
      { biceps: [10, 0, 0, 0, 0, 0, 0] }, // all logged today
      {},
      [],
      NOW
    );
    expect(rowFor(preview, 'biceps').sets).toBe(10);
    expect(rowFor(preview, 'biceps').zone).toBe('in_zone');
  });

  it('re-evaluates recovery at tomorrow\'s instant via the same heuristic', () => {
    // Quads hammered 30h ago → Fatigued today; tomorrow the SAME pure
    // heuristic decides, one day later.
    const history = [session(hoursBefore(NOW, 30), 'quads', 8, 0)];
    const rows = buildReadinessRows([], history, NOW);
    const today = rowFor(rows, 'quads').recovery;
    expect(today.status).toBe('fatigued');

    const preview = buildNextDayPreviewRows(rows, {}, {}, history, NOW);
    const next = rowFor(preview, 'quads').recovery;
    expect(next.status).toBe(
      computeMuscleRecovery(history, 'quads', nextLocalDaySameTime(NOW)).status
    );
    // Strictly closer to ready than today (whatever the window length).
    expect(next.hoursUntilReady).toBeLessThan(today.hoursUntilReady);
  });

  it('does NOT carry today\'s soreness overrides into tomorrow', () => {
    // Fresh by the time model, forced Fatigued today by the "still sore" chip.
    const history = [session(hoursBefore(NOW, 120), 'hamstrings', 4, 2)];
    const overrides = new Set<StandardMuscleGroup>(['hamstrings']);
    const rows = buildReadinessRows([], history, NOW, undefined, undefined, overrides);
    expect(rowFor(rows, 'hamstrings').recovery.status).toBe('fatigued');

    const preview = buildNextDayPreviewRows(rows, {}, {}, history, NOW);
    expect(rowFor(preview, 'hamstrings').recovery.status).toBe('fresh');
  });

  it('projects fine children from the per-head buckets and recomputes laggingChildren', () => {
    // Glutes group in zone today AND tomorrow (16 sets logged today); the
    // reachable glute_med child is in zone today (5 ≥ MEV 2) but ALL its sets
    // age out tomorrow → the child lags and demotes the parent.
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const rows = buildReadinessRows(
      [stat('glutes', 16), stat('glute_med', 5)],
      [],
      NOW,
      reachable
    );
    expect(rowFor(rows, 'glutes').laggingChildren).toBe(false);

    const preview = buildNextDayPreviewRows(
      rows,
      { glutes: [16, 0, 0, 0, 0, 0, 0] },
      { glute_med: [0, 0, 0, 0, 0, 0, 5] },
      [],
      NOW
    );
    const glutes = rowFor(preview, 'glutes');
    expect(glutes.zone).toBe('in_zone');
    const child = glutes.children.find((c) => c.muscle === 'glute_med')!;
    expect(child.sets).toBe(0);
    expect(child.belowMev).toBe(true);
    expect(glutes.laggingChildren).toBe(true);
  });

  it('empties the per-exercise drill-down (today\'s amounts are not tomorrow\'s)', () => {
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const rows = buildReadinessRows(
      [stat('glutes', 16), stat('glute_med', 5)],
      [],
      NOW,
      reachable
    );
    const preview = buildNextDayPreviewRows(rows, { glutes: [16, 0, 0, 0, 0, 0, 0] }, {}, [], NOW);
    expect(preview.every((r) => r.exercises.length === 0)).toBe(true);
    expect(preview.every((r) => r.children.every((c) => c.exercises.length === 0))).toBe(true);
  });

  it('re-sorts by tomorrow\'s actionability and feeds selectGoodTargets', () => {
    // Biceps: at MEV today (gap 0), everything aging out tomorrow (gap 10),
    // Fresh → tomorrow it becomes a top target it wasn't today.
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW);
    expect(selectGoodTargets(rows).targets.every((t) => t.muscle !== 'biceps')).toBe(true);

    const preview = buildNextDayPreviewRows(
      rows,
      { biceps: [0, 0, 0, 0, 0, 0, 10] },
      {},
      [],
      NOW
    );
    expect(rowFor(preview, 'biceps').score).toBeGreaterThan(0);
    const { targets } = selectGoodTargets(preview);
    expect(targets.some((t) => t.muscle === 'biceps')).toBe(true);
  });
});
