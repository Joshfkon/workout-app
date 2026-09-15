import {
  buildFutureReadinessRows,
  futureInstant,
  PREVIEW_MAX_HOURS,
} from '../readinessPreview';
import { buildReadinessRows, selectGoodTargets, type ReadinessRow } from '../readiness';
import { computeMuscleRecovery } from '@/services/muscleRecovery';
import type { RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';
import type { MuscleVolumeStats } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

// LOCAL noon, away from day boundaries: +6h stays inside today and +24h
// crosses exactly one local midnight, in whatever timezone the tests run.
const NOW = new Date(2026, 6, 11, 12, 0);

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

describe('futureInstant', () => {
  it('is exact elapsed time in hours', () => {
    expect(futureInstant(NOW, 6).getTime() - NOW.getTime()).toBe(6 * 3600 * 1000);
    expect(futureInstant(NOW, 0).getTime()).toBe(NOW.getTime());
  });
});

describe('buildFutureReadinessRows (time slider)', () => {
  // Biceps at MEV today (10 credited sets), ALL logged on the oldest day
  // still in the window.
  const OLDEST_DAY_BUCKETS = { biceps: [0, 0, 0, 0, 0, 0, 10] };

  it('at 0 hours reproduces today\'s volume and recovery', () => {
    const history = [session(hoursBefore(NOW, 30), 'quads', 8, 0)];
    const rows = buildReadinessRows([stat('biceps', 10)], history, NOW);
    const preview = buildFutureReadinessRows(rows, OLDEST_DAY_BUCKETS, {}, history, NOW, 0);
    expect(rowFor(preview, 'biceps').sets).toBe(rowFor(rows, 'biceps').sets);
    expect(rowFor(preview, 'quads').recovery.status).toBe(
      rowFor(rows, 'quads').recovery.status
    );
  });

  it('within today (no midnight crossed) volume holds while recovery advances', () => {
    const history = [session(hoursBefore(NOW, 30), 'quads', 8, 0)];
    const rows = buildReadinessRows([stat('biceps', 10)], history, NOW);
    const today = rowFor(rows, 'quads').recovery;

    const preview = buildFutureReadinessRows(rows, OLDEST_DAY_BUCKETS, {}, history, NOW, 6);
    // NOW is local noon, so +6h is the same local day: nothing ages out even
    // though every biceps set sits on the window's last counted day.
    expect(rowFor(preview, 'biceps').sets).toBe(10);
    // Recovery is hour-granular: 6h closer to ready.
    expect(rowFor(preview, 'quads').recovery.hoursUntilReady).toBeCloseTo(
      Math.max(0, today.hoursUntilReady - 6),
      6
    );
  });

  it('each crossed local midnight ages the oldest counted day out of the window', () => {
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW);
    expect(rowFor(rows, 'biceps').volumeGap).toBe(0);

    // +24h from local noon crosses exactly one midnight → the oldest bucket drops.
    const preview = buildFutureReadinessRows(rows, OLDEST_DAY_BUCKETS, {}, [], NOW, 24);
    const biceps = rowFor(preview, 'biceps');
    expect(biceps.sets).toBe(0);
    expect(biceps.zone).toBe('below_mev');
    expect(biceps.belowMev).toBe(true);
    expect(biceps.volumeGap).toBe(biceps.band.mev);
    expect(biceps.volumeStatus).toBe('low');
  });

  it('steps down day by day across the slider range', () => {
    // 4 sets three days ago, 6 sets on the oldest day.
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW);
    const daily = { biceps: [0, 0, 0, 4, 0, 0, 6] };
    const at = (h: number) =>
      rowFor(buildFutureReadinessRows(rows, daily, {}, [], NOW, h), 'biceps').sets;
    expect(at(0)).toBe(10);
    expect(at(24)).toBe(4); // oldest day gone
    expect(at(48)).toBe(4);
    expect(at(PREVIEW_MAX_HOURS)).toBe(4); // 3-days-ago bucket drops on day +4
  });

  it('re-evaluates recovery at the future instant via the same heuristic', () => {
    const history = [session(hoursBefore(NOW, 30), 'quads', 8, 0)];
    const rows = buildReadinessRows([], history, NOW);
    expect(rowFor(rows, 'quads').recovery.status).toBe('fatigued');

    const preview = buildFutureReadinessRows(rows, {}, {}, history, NOW, 30);
    expect(rowFor(preview, 'quads').recovery.status).toBe(
      computeMuscleRecovery(history, 'quads', futureInstant(NOW, 30)).status
    );
  });

  it('does NOT carry today\'s soreness overrides forward', () => {
    // Fresh by the time model, forced Fatigued today by the "still sore" chip.
    const history = [session(hoursBefore(NOW, 120), 'hamstrings', 4, 2)];
    const overrides = new Set<StandardMuscleGroup>(['hamstrings']);
    const rows = buildReadinessRows([], history, NOW, undefined, undefined, overrides);
    expect(rowFor(rows, 'hamstrings').recovery.status).toBe('fatigued');

    const preview = buildFutureReadinessRows(rows, {}, {}, history, NOW, 24);
    expect(rowFor(preview, 'hamstrings').recovery.status).toBe('fresh');
  });

  it('projects fine children from the per-head buckets and recomputes laggingChildren', () => {
    // Glutes group in zone today AND at +24h (16 sets logged today); the
    // reachable glute_med child is in zone today (5 ≥ MEV 2) but ALL its sets
    // age out after one midnight → the child lags and demotes the parent.
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const rows = buildReadinessRows(
      [stat('glutes', 16), stat('glute_med', 5)],
      [],
      NOW,
      reachable
    );
    expect(rowFor(rows, 'glutes').laggingChildren).toBe(false);

    const preview = buildFutureReadinessRows(
      rows,
      { glutes: [16, 0, 0, 0, 0, 0, 0] },
      { glute_med: [0, 0, 0, 0, 0, 0, 5] },
      [],
      NOW,
      24
    );
    const glutes = rowFor(preview, 'glutes');
    expect(glutes.zone).toBe('in_zone');
    const child = glutes.children.find((c) => c.muscle === 'glute_med')!;
    expect(child.sets).toBe(0);
    expect(child.belowMev).toBe(true);
    expect(glutes.laggingChildren).toBe(true);
  });

  it('empties the per-exercise drill-down (today\'s amounts are not the future\'s)', () => {
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const rows = buildReadinessRows(
      [stat('glutes', 16), stat('glute_med', 5)],
      [],
      NOW,
      reachable
    );
    const preview = buildFutureReadinessRows(
      rows,
      { glutes: [16, 0, 0, 0, 0, 0, 0] },
      {},
      [],
      NOW,
      24
    );
    expect(preview.every((r) => r.exercises.length === 0)).toBe(true);
    expect(preview.every((r) => r.children.every((c) => c.exercises.length === 0))).toBe(true);
  });

  it('re-sorts by future actionability and feeds selectGoodTargets', () => {
    // Biceps: at MEV today (gap 0), everything aging out after one midnight
    // (gap 10), Fresh → ahead it becomes a top target it isn't now.
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW);
    expect(selectGoodTargets(rows).targets.every((t) => t.muscle !== 'biceps')).toBe(true);

    const preview = buildFutureReadinessRows(rows, OLDEST_DAY_BUCKETS, {}, [], NOW, 24);
    expect(rowFor(preview, 'biceps').score).toBeGreaterThan(0);
    const { targets } = selectGoodTargets(preview);
    expect(targets.some((t) => t.muscle === 'biceps')).toBe(true);
  });
});
