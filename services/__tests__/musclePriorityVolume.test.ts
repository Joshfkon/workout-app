/**
 * A high muscle priority visibly raises that muscle's weekly sets (UX panel
 * round 20: Vince marked hamstrings and side delts high priority on an
 * advanced bulk and got 9 → 10 and 9 → 11 of a 20 target). The boost was
 * swallowed in three places: the session's proportional fair share (every
 * target already sat near MRV, so +20% asked for no bigger SHARE), the
 * muscle's slot in the session (later slots' stimulus-to-fatigue discount
 * refused every hinge after the quads), and the per-session ceiling
 * (now raisable to 16 for a once-a-week split).
 */
import { COARSE_MUSCLES, coarseVolumeLandmarks, type CoarseMuscle } from '../volumeBands';
import {
  creditedSetsByGroup,
  creditedSetsByHead,
  enforceNonDecreasingRamp,
  fairShareSessionSets,
  generateFullMesocycleWithFatigue,
  highPriorityGroups,
  MAX_SESSION_MUSCLE_CEILING,
  MAX_SETS_PER_MUSCLE_PER_SESSION,
  normalizeSessionMuscleCeiling,
  orderSessionMuscles,
  peakTrainingWeek,
  sessionMuscleCeiling,
  RAMP_HEADS,
} from '@/services/sessionBuilderWithFatigue';
import { effectiveTrainingAge } from '@/services/mesocycleBuilder';
import { priorityVolumeAdjustments, type MusclePriorityRow } from '@/lib/training/builderDefaults';
import type { Equipment, ExtendedUserProfile, FullProgramRecommendation, Rating, Split } from '@/types/schema';

const vince: ExtendedUserProfile = {
  goal: 'bulk',
  experience: 'advanced',
  heightCm: 180,
  latestDexa: null,
  age: 29,
  sleepQuality: 3 as Rating,
  stressLevel: 3 as Rating,
  trainingAge: effectiveTrainingAge(0, 'advanced'),
  availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'] as Equipment[],
  injuryHistory: [],
};

const high = (muscle: string): MusclePriorityRow[] => [{ muscle_group: muscle, priority: 1 } as MusclePriorityRow];

function peak(program: FullProgramRecommendation, key: string): number {
  const week = peakTrainingWeek(program.mesocycleWeeks!)!;
  const byGroup = creditedSetsByGroup(week.sessions) as Record<string, number | undefined>;
  const byHead = creditedSetsByHead(week.sessions) as Record<string, number | undefined>;
  return byGroup[key] ?? byHead[key] ?? 0;
}

function build(split: Split, days: number, rows: MusclePriorityRow[], ceiling?: number) {
  return generateFullMesocycleWithFatigue(days, vince, 75, [], [], 1, 5, priorityVolumeAdjustments(rows), split, {
    maxSetsPerMusclePerSession: ceiling,
    reportPriorityEffects: true,
  });
}

describe('fairShareSessionSets with a priority', () => {
  it('serves a prioritized muscle its whole request first; the others keep their floors', () => {
    expect(fairShareSessionSets([12, 12, 12], 24)).toEqual([8, 8, 8]);
    expect(fairShareSessionSets([12, 12, 12], 24, [], [false, true, false])).toEqual([6, 12, 6]);
    // Not enough room for the whole request: the others still keep 2 each.
    expect(fairShareSessionSets([12, 20, 12], 14, [], [false, true, false])).toEqual([2, 10, 2]);
  });

  it('is unchanged without a priority', () => {
    expect(fairShareSessionSets([12, 12, 12, 11, 11], 22, [], [])).toEqual(fairShareSessionSets([12, 12, 12, 11, 11], 22));
  });
});

describe('orderSessionMuscles', () => {
  it('puts a prioritized muscle first, the rest in their usual order', () => {
    expect(orderSessionMuscles(['glutes', 'hamstrings', 'quads'])).toEqual(['quads', 'hamstrings', 'glutes']);
    expect(orderSessionMuscles(['glutes', 'hamstrings', 'quads'], (m) => m === 'glutes')).toEqual([
      'glutes',
      'quads',
      'hamstrings',
    ]);
  });
});

describe('per-session ceiling option', () => {
  it('defaults to 12 and clamps a request to 12–16', () => {
    expect(normalizeSessionMuscleCeiling(undefined)).toBe(MAX_SETS_PER_MUSCLE_PER_SESSION);
    expect(normalizeSessionMuscleCeiling(8)).toBe(12);
    expect(normalizeSessionMuscleCeiling(14)).toBe(14);
    expect(normalizeSessionMuscleCeiling(40)).toBe(MAX_SESSION_MUSCLE_CEILING);
    expect(sessionMuscleCeiling(1, 16)).toBe(16);
    expect(sessionMuscleCeiling(0.75, 16)).toBe(12);
  });

  it('lets a once-a-week muscle exceed 12 sets in its session', () => {
    const at12 = generateFullMesocycleWithFatigue(5, vince, 75, [], [], 1, 5, [], 'Bro Split');
    const at16 = generateFullMesocycleWithFatigue(5, vince, 75, [], [], 1, 5, [], 'Bro Split', {
      maxSetsPerMusclePerSession: 16,
    });
    expect(at16.maxSetsPerMusclePerSession).toBe(16);
    expect(peak(at16, 'chest')).toBeGreaterThan(peak(at12, 'chest'));
    expect(at16.programNotes.join(' ')).toMatch(/diminishing returns past ~10–12/);
  });
});

describe('a high priority raises peak weekly sets by a meaningful amount', () => {
  // Upper/Lower ×4 trains each muscle twice: time, not the ceiling, binds.
  it.each(['hamstrings', 'chest', 'back', 'biceps', 'lateral_delts'])('Upper/Lower ×4, 75 min: %s +4 or more', (muscle) => {
    const before = peak(build('Upper/Lower', 4, []), muscle);
    const after = peak(build('Upper/Lower', 4, high(muscle)), muscle);
    expect(after - before).toBeGreaterThanOrEqual(4);
  });

  // Bro Split ×5 trains each muscle once: the per-session ceiling binds, so
  // the raised ceiling is what lets the priority show — unless the plain
  // plan already fills that one session past MAV (since round 22 a day's
  // leftover minutes go to its muscles: Bro Split biceps 22, back 18.5 at
  // a 16-set limit with no priority), where there is nothing left to add.
  it.each(['hamstrings', 'biceps', 'back', 'lateral_delts'])('Bro Split ×5, 75 min, 16-set ceiling: %s +3 or more, or already past MAV', (muscle) => {
    const before = peak(build('Bro Split', 5, [], 16), muscle);
    const after = peak(build('Bro Split', 5, high(muscle), 16), muscle);
    expect(after).toBeGreaterThanOrEqual(before);
    const alreadyPastMav =
      (COARSE_MUSCLES as readonly string[]).includes(muscle) &&
      before >= coarseVolumeLandmarks(muscle as CoarseMuscle, 'advanced').mav;
    if (!alreadyPastMav) expect(after - before).toBeGreaterThanOrEqual(3);
  });

  it('Bro Split ×5 at the default ceiling never lowers the prioritized muscle', () => {
    for (const muscle of ['hamstrings', 'chest', 'back', 'biceps', 'lateral_delts']) {
      expect(peak(build('Bro Split', 5, high(muscle)), muscle)).toBeGreaterThanOrEqual(peak(build('Bro Split', 5, []), muscle));
    }
  });

  it('reports what changed per priority', () => {
    const program = build('Upper/Lower', 4, high('hamstrings'));
    expect(program.priorityEffects).toHaveLength(1);
    const [effect] = program.priorityEffects!;
    expect(effect).toMatchObject({ muscleGroup: 'hamstrings', direction: 'up', sessionsPerWeek: 2 });
    expect(effect.after - effect.before).toBeGreaterThanOrEqual(4);
    expect(effect.after).toBeCloseTo(peak(program, 'hamstrings'), 1);
    expect(build('Upper/Lower', 4, []).priorityEffects).toBeUndefined();
    // Only on request: it costs a second generation.
    const unrequested = generateFullMesocycleWithFatigue(4, vince, 75, [], [], 1, 5, priorityVolumeAdjustments(high('hamstrings')), 'Upper/Lower');
    expect(unrequested.priorityEffects).toBeUndefined();
  });

  it('head priorities report the head', () => {
    const program = build('Upper/Lower', 4, high('lateral_delts'));
    expect(program.priorityEffects![0]).toMatchObject({ muscleGroup: 'shoulders', head: 'lateral_delts' });
  });

  it('highPriorityGroups reads only raising user priorities', () => {
    const groups = highPriorityGroups(
      priorityVolumeAdjustments([
        { muscle_group: 'hamstrings', priority: 1 },
        { muscle_group: 'lateral_delts', priority: 2 },
        { muscle_group: 'calves', priority: 5 },
      ] as MusclePriorityRow[])
    );
    expect(Array.from(groups).sort()).toEqual(['hamstrings', 'shoulders']);
  });
});

describe('priorities keep the accumulation ramp non-decreasing (group and head)', () => {
  const cases: [Split, number, string[], number | undefined][] = [
    ['Upper/Lower', 4, ['hamstrings', 'lateral_delts'], undefined],
    ['Bro Split', 5, ['hamstrings', 'lateral_delts'], undefined],
    ['Bro Split', 5, ['hamstrings', 'chest'], 16],
    ['PPL', 6, ['biceps', 'chest_upper'], 14],
    ['Full Body', 3, ['back', 'glutes'], undefined],
  ];
  it.each(cases)('%s ×%i, priorities %j, ceiling %s', (split, days, muscles, ceiling) => {
    const rows = muscles.map((m) => ({ muscle_group: m, priority: 1 }) as MusclePriorityRow);
    for (const minutes of [45, 75]) {
      const program = generateFullMesocycleWithFatigue(days, vince, minutes, [], [], 1, 5, priorityVolumeAdjustments(rows), split, {
        maxSetsPerMusclePerSession: ceiling,
      });
      const training = program.mesocycleWeeks!.filter((w) => !w.isDeload);
      // Already enforced: a second pass trims nothing.
      expect(enforceNonDecreasingRamp(program.mesocycleWeeks!)).toBe(0);
      for (let k = 0; k + 1 < training.length; k++) {
        if (training[k].volumeModifier > training[k + 1].volumeModifier) continue;
        const a = creditedSetsByGroup(training[k].sessions) as Record<string, number | undefined>;
        const b = creditedSetsByGroup(training[k + 1].sessions) as Record<string, number | undefined>;
        for (const m of Object.keys(a)) expect(b[m] ?? 0).toBeGreaterThanOrEqual((a[m] ?? 0) - 1e-6);
        const ha = creditedSetsByHead(training[k].sessions) as Record<string, number | undefined>;
        const hb = creditedSetsByHead(training[k + 1].sessions) as Record<string, number | undefined>;
        for (const h of RAMP_HEADS) expect(hb[h] ?? 0).toBeGreaterThanOrEqual((ha[h] ?? 0) - 1e-6);
      }
    }
  });
});
