import {
  applyFrozenOrder,
  buildReadinessRows,
  hoursUntilReadinessThreshold,
  readinessScore,
  READINESS_AMBER_THRESHOLD,
  READINESS_READY_THRESHOLD,
  selectGoodTargets,
  READY_SOON_HOURS,
  type ReadinessRow,
} from '../readiness';
import { computeMuscleRecovery } from '@/services/muscleRecovery';
import type { MuscleRecoveryResult, RecoverySession } from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';
import { COARSE_MUSCLES, type MuscleVolumeStats } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

const NOW = new Date('2026-07-11T12:00:00.000Z');

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
    // Both Fresh (untrained). shoulders MEV 12, biceps MEV 10 → shoulders first.
    const rows = buildReadinessRows([], [], NOW);
    expect(rows.findIndex((r) => r.muscle === 'shoulders')).toBeLessThan(
      rows.findIndex((r) => r.muscle === 'biceps')
    );
  });

  it('a group at MEV ranks below an equally-recovered group behind target', () => {
    const rows = buildReadinessRows([stat('biceps', 10)], [], NOW); // biceps MEV 10 → gap 0
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

  it('carries contributing exercises (drill-down) on coarse rows and fine children, biggest first', () => {
    const reachable = new Set<StandardMuscleGroup>(['glutes', 'glute_med']);
    const rows = buildReadinessRows([stat('glutes', 10), stat('glute_med', 4)], [], NOW, reachable);
    const glutes = rowFor(rows, 'glutes');

    // The coarse row aggregates both muscles' contributing exercises…
    expect(glutes.exercises.map((e) => e.name)).toEqual(['glutes ex', 'glute_med ex']);
    expect(glutes.exercises.map((e) => e.sets)).toEqual([10, 4]);

    // …and the fine child carries only its own.
    const child = glutes.children.find((c) => c.muscle === 'glute_med');
    expect(child!.exercises).toEqual([{ id: 'glute_med', name: 'glute_med ex', performedSets: 4, sets: 4, effective: 4, direct: 4, indirect: 0, directEffective: 4, indirectEffective: 0, unrated: 0 }]);

    // An untrained group has nothing to drill into.
    expect(rowFor(rows, 'chest').exercises).toEqual([]);
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

describe('a trained member always outranks a never-trained one', () => {
  // Regression: a group whose members are ALL Fresh tied on status rank AND on
  // hoursUntilReady (0), so the first member listed won — and for the groups
  // that carry a coarse standard member first ('triceps', 'traps', 'calves',
  // 'glutes', 'abs'), a user who tags at head level never feeds that member.
  // The group inherited its null lastTrainedAt and rendered "No recent data"
  // while every head below it read Fresh off real counted sets.
  const HEADS = new Set<StandardMuscleGroup>(['triceps_long', 'triceps_lat_med']);

  it('a head-tagging user gets a trained Triceps row, not "no recent data"', () => {
    // 5 days ago: well past the 36h triceps window → every head reads Fresh.
    const trainedAt = hoursBefore(NOW, 120);
    const history: RecoverySession[] = [
      session(trainedAt, 'triceps_lat_med', 10, 2),
      session(trainedAt, 'triceps_long', 5, 2),
    ];
    const rows = buildReadinessRows([], history, NOW, HEADS);
    const triceps = rowFor(rows, 'triceps');

    const childStatus = (m: string) =>
      triceps.children.find((c) => c.muscle === m)!.recovery.status;
    expect(childStatus('triceps_lat_med')).toBe('fresh');
    expect(childStatus('triceps_long')).toBe('fresh');

    // The badge reads "No recent data" off a null lastTrainedAt — the group
    // was trained, so it must carry the real timestamp.
    expect(triceps.recovery.status).toBe('fresh');
    expect(triceps.recovery.lastTrainedAt).toEqual(trainedAt);
  });

  it('reports the MOST RECENT session among equally-recovered members', () => {
    const older = hoursBefore(NOW, 168);
    const newer = hoursBefore(NOW, 120);
    const history: RecoverySession[] = [
      session(older, 'triceps_long', 5, 2),
      session(newer, 'triceps_lat_med', 10, 2),
    ];
    const triceps = rowFor(buildReadinessRows([], history, NOW, HEADS), 'triceps');
    expect(triceps.recovery.lastTrainedAt).toEqual(newer);
  });

  it('still reports no data when NO member has been trained', () => {
    const triceps = rowFor(buildReadinessRows([], [], NOW, HEADS), 'triceps');
    expect(triceps.recovery.lastTrainedAt).toBeNull();
    expect(triceps.recovery.status).toBe('fresh');
  });

  it('a fatigued member still wins over a fresher, more recently trained one', () => {
    // Ordering guard: "has data" must break ties only AFTER status rank, never
    // before it — a recently-trained Fresh head must not displace a Fatigued one.
    const history: RecoverySession[] = [
      session(NOW, 'triceps_long', 8, 0), // just maxed → Fatigued
      session(hoursBefore(NOW, 120), 'triceps_lat_med', 4, 2), // Fresh
    ];
    const triceps = rowFor(buildReadinessRows([], history, NOW, HEADS), 'triceps');
    expect(triceps.recovery.status).toBe('fatigued');
    expect(triceps.recovery.lastTrainedAt).toEqual(NOW);
  });
});

describe('erectors readiness is independent of back', () => {
  // A hinge session: primary glutes, secondary erectors — the shape that used
  // to drive back's "Fatigued" reading while lats and upper back were fresh.
  const hinge = (at: Date): RecoverySession => ({
    performedAt: at,
    exercises: [
      {
        primaryMuscle: 'glutes',
        secondaryMuscles: ['erectors'],
        sets: Array.from({ length: 6 }, () => ({ repsInTank: 0 })),
      },
    ],
  });

  it('erector fatigue drives the Erectors row and leaves Back fresh', () => {
    const rows = buildReadinessRows([], [hinge(NOW)], NOW);

    expect(rowFor(rows, 'erectors').recovery.status).toBe('fatigued');
    // Back's worst-of-children now spans lats + upper_back only, so the hinge
    // cannot reach it. Before the promotion this row read Fatigued.
    expect(rowFor(rows, 'back').recovery.status).toBe('fresh');
  });

  it('back fatigue does not make Erectors look fatigued', () => {
    const pulling: RecoverySession = {
      performedAt: NOW,
      exercises: [
        {
          primaryMuscle: 'lats',
          secondaryMuscles: ['upper_back'],
          sets: Array.from({ length: 6 }, () => ({ repsInTank: 0 })),
        },
      ],
    };
    const rows = buildReadinessRows([], [pulling], NOW);

    expect(rowFor(rows, 'back').recovery.status).toBe('fatigued');
    expect(rowFor(rows, 'erectors').recovery.status).toBe('fresh');
  });

  it('computes its own recovery clock rather than inheriting a back child\'s', () => {
    // Erectors trained 30h ago, lats 6h ago: two genuinely different clocks.
    const history = [
      { ...hinge(hoursBefore(NOW, 30)) },
      session(hoursBefore(NOW, 6), 'lats', 6, 0),
    ];
    const rows = buildReadinessRows([], history, NOW);

    const erectors = rowFor(rows, 'erectors');
    const back = rowFor(rows, 'back');
    // Independent clocks: the more recent lat session leaves back with strictly
    // more time to go than the older hinge leaves the erectors.
    expect(back.recovery.hoursUntilReady).toBeGreaterThan(
      erectors.recovery.hoursUntilReady
    );
    // And the erector row is a standalone coarse row, carrying no children.
    expect(erectors.children).toHaveLength(0);
  });

  it('is a top-level readiness row, never a child of back', () => {
    const rows = buildReadinessRows([], [], NOW);
    expect(rows.some((r) => r.muscle === 'erectors')).toBe(true);
    expect(
      rowFor(rows, 'back').children.map((c) => c.muscle)
    ).not.toContain('erectors');
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

  /**
   * The recovery window for a 5-set/RIR-2 triceps session, read from the model
   * rather than assumed. These tests are about TIERING (ready / soon / empty
   * state), so they position the session relative to the real window; hard-
   * coding it pinned the retired step function's flat 36h and broke the moment
   * the dose adjustment became continuous.
   */
  function tricepsWindowHours(): number {
    const probe = computeMuscleRecovery(
      [session(hoursBefore(NOW, 1), 'triceps', 5, 2)],
      'triceps',
      NOW
    );
    return probe.windowHours!;
  }

  it('never presents a Recovering muscle as a ready-now target', () => {
    // The bug fixture: the most-behind muscle (triceps, 0 sets → gap 6) is
    // Recovering (~18h out), while every other muscle is Fresh but at/above MEV
    // (a "Fresh, mid-zone" muscle has gap 0, so it isn't eligible either).
    const triceps = { ...stat('triceps', 12), sets: 0, exercises: [{ id: 'triceps', name: 'triceps ex', performedSets: 0, sets: 0, effective: 0, direct: 0, indirect: 0, directEffective: 0, indirectEffective: 0 }] };
    const stats = [triceps, ...ALL_AT_MEV.filter((s) => s.muscle !== 'triceps')];
    // Positioned so triceps is Recovering and still comfortably OUTSIDE the
    // 'soon' window (READY_SOON_HOURS), which is what this fixture needs.
    const hoursOut = READY_SOON_HOURS + 3;
    const history = [session(hoursBefore(NOW, tricepsWindowHours() - hoursOut), 'triceps', 5, 2)];
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
    expect(nextUp!.hoursUntilReady).toBeCloseTo(READY_SOON_HOURS + 3, 6);
    expect(nextUp!.hoursUntilReady).toBeGreaterThan(READY_SOON_HOURS);
  });

  it('offers a lagging, nearly-ready muscle as a muted "ready soon" pick, not ready-now', () => {
    const triceps = { ...stat('triceps', 12), sets: 0, exercises: [{ id: 'triceps', name: 'triceps ex', performedSets: 0, sets: 0, effective: 0, direct: 0, indirect: 0, directEffective: 0, indirectEffective: 0 }] };
    const stats = [triceps, ...ALL_AT_MEV.filter((s) => s.muscle !== 'triceps')];
    // Positioned INSIDE the 'soon' window: Recovering, but nearly Fresh.
    const hoursOut = READY_SOON_HOURS - 1;
    const history = [session(hoursBefore(NOW, tricepsWindowHours() - hoursOut), 'triceps', 5, 2)];
    const noChildren = new Set<StandardMuscleGroup>();

    const { targets, nextUp } = selectGoodTargets(buildReadinessRows(stats, history, NOW, noChildren), 3);

    const tri = targets.find((t) => t.muscle === 'triceps');
    expect(tri).toBeDefined();
    expect(tri!.tier).toBe('soon');
    expect(tri!.readyInHours).toBeCloseTo(READY_SOON_HOURS - 1, 6);
    expect(tri!.readyInHours).toBeLessThanOrEqual(READY_SOON_HOURS);
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
