import {
  computeMuscleRecovery,
  RECOVERY_CONFIG,
  type RecoveryExercise,
  type RecoverySession,
} from '@/services/muscleRecovery';
import {
  boundedComponentsOf,
  capacityOwnerFor,
  STANDARD_MUSCLE_GROUPS,
  type StandardMuscleGroup,
} from '@/types/schema';

/**
 * Recovery must flow along a groupCapacity ↔ boundedComponent edge.
 *
 * The volume model keeps a coarse tag on its coarse row on purpose (a 'traps'
 * tag cannot name which head it hit, so it must not smear across them). That
 * is right for crediting sets and wrong for recovery: fatigue does not
 * partition by which token an exercise happens to carry. Before this, a heavy
 * deadlift day — 'traps' as a SECONDARY, which is how the great majority of
 * the library tags trap involvement — left both trap heads reporting "never
 * trained → Fresh" on every per-standard-muscle surface (Train page recovery
 * list, workout builder, AI suggestions) while the user's traps were sore.
 */

const NOW = new Date('2026-08-10T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function session(performedAt: Date, exercises: RecoveryExercise[]): RecoverySession {
  return { performedAt, exercises };
}

function sets(count: number, repsInTank: number | null = 1) {
  return Array.from({ length: count }, () => ({ repsInTank }));
}

/** Every (parent, component) pair in the taxonomy — traps, calves, triceps. */
const FAMILY_PAIRS: [StandardMuscleGroup, StandardMuscleGroup][] =
  STANDARD_MUSCLE_GROUPS.flatMap((parent) =>
    boundedComponentsOf(parent).map(
      (child): [StandardMuscleGroup, StandardMuscleGroup] => [parent, child]
    )
  );

describe('recovery flows across a muscle family', () => {
  it('covers the traps, calves and triceps families', () => {
    expect(FAMILY_PAIRS.length).toBeGreaterThan(0);
    expect(new Set(FAMILY_PAIRS.map(([parent]) => parent))).toEqual(
      new Set(['traps', 'calves', 'triceps'])
    );
  });

  it.each(FAMILY_PAIRS)(
    'a group-tagged session (%s) registers on its component (%s)',
    (parent, child) => {
      const history = [
        session(hoursAgo(12), [
          { primaryMuscle: parent, secondaryMuscles: [], sets: sets(4) },
        ]),
      ];

      const result = computeMuscleRecovery(history, child, NOW, RECOVERY_CONFIG);

      expect(result.lastTrainedAt).toEqual(hoursAgo(12));
      expect(result.dose).toBeGreaterThan(0);
      expect(result.status).not.toBe('fresh');
    }
  );

  it.each(FAMILY_PAIRS)(
    'a component-tagged session registers on its group (%s) at full strength',
    (parent, child) => {
      const history = [
        session(hoursAgo(12), [
          { primaryMuscle: child, secondaryMuscles: [], sets: sets(4) },
        ]),
      ];

      const result = computeMuscleRecovery(history, parent, NOW, RECOVERY_CONFIG);

      // Work on a component IS work on the group — no discount on this edge.
      expect(result.dose).toBe(4);
      expect(result.status).not.toBe('fresh');
    }
  );

  it.each(FAMILY_PAIRS)(
    'a group tag (%s) reaches its component (%s) only indirectly',
    (parent, child) => {
      const direct = computeMuscleRecovery(
        [session(hoursAgo(12), [{ primaryMuscle: child, secondaryMuscles: [], sets: sets(4) }])],
        child,
        NOW,
        RECOVERY_CONFIG
      );
      const viaParent = computeMuscleRecovery(
        [session(hoursAgo(12), [{ primaryMuscle: parent, secondaryMuscles: [], sets: sets(4) }])],
        child,
        NOW,
        RECOVERY_CONFIG
      );

      // A coarse tag cannot say which component it hit, so it lands at the
      // secondary discount rather than as direct work on that head.
      expect(viaParent.dose).toBeCloseTo(direct.dose * RECOVERY_CONFIG.secondaryDoseFactor);
    }
  );

  it('never leaks between siblings', () => {
    const siblingPairs = FAMILY_PAIRS.flatMap(([, child]) =>
      boundedComponentsOf(capacityOwnerFor(child))
        .filter((sibling) => sibling !== child)
        .map((sibling): [StandardMuscleGroup, StandardMuscleGroup] => [child, sibling])
    );
    expect(siblingPairs.length).toBeGreaterThan(0);

    for (const [trained, sibling] of siblingPairs) {
      const result = computeMuscleRecovery(
        [session(hoursAgo(12), [{ primaryMuscle: trained, secondaryMuscles: [], sets: sets(4) }])],
        sibling,
        NOW,
        RECOVERY_CONFIG
      );
      // Credit across this family is disjoint — shrugs must never fatigue the
      // mid/lower traps, nor calf raises tagged soleus the gastrocnemius.
      expect(result.dose).toBe(0);
      expect(result.status).toBe('fresh');
      expect(result.lastTrainedAt).toBeNull();
    }
  });

  it('does not reach unrelated muscles', () => {
    const result = computeMuscleRecovery(
      [session(hoursAgo(12), [{ primaryMuscle: 'traps', secondaryMuscles: [], sets: sets(4) }])],
      'upper_back',
      NOW,
      RECOVERY_CONFIG
    );
    expect(result.status).toBe('fresh');
    expect(result.lastTrainedAt).toBeNull();
  });

  it('the deadlift case: a secondary group tag still reaches both trap heads', () => {
    // Exactly how supabase/seed.sql tags the Deadlift. The original defect was
    // that BOTH heads read "never trained → Fresh" the morning after a heavy
    // pull, so the claim under test is REACH: the parent tag lands on the
    // components at all.
    const history = [
      session(hoursAgo(24), [
        {
          primaryMuscle: 'glutes',
          secondaryMuscles: ['hamstrings', 'erectors', 'traps', 'forearms', 'quads'],
          sets: sets(4, 0),
        },
      ]),
    ];

    for (const muscle of ['traps', 'upper_traps', 'mid_lower_traps'] as const) {
      const result = computeMuscleRecovery(history, muscle, NOW, RECOVERY_CONFIG);
      expect(result.lastTrainedAt).toEqual(hoursAgo(24));
      expect(result.dose).toBeGreaterThan(0);
      expect(result.status).not.toBe('fresh');
    }
  });

  it('KNOWN CONSEQUENCE: components clear a group-tagged session before the group does', () => {
    // The parent -> child edge applies `secondaryDoseFactor` TWICE for a
    // secondary group tag (once for being secondary, once for the tag not
    // naming a head), so each head sees half the group's dose. Under the
    // additive dose model every window bottomed out near the base and this was
    // invisible; a multiplicative window makes it explicit — the group can
    // read Fatigued while its own heads read Fresh.
    //
    // Pinned as an OBSERVATION, not an endorsement: resolving it means deciding
    // whether a group row aggregates its heads' fatigue or carries its own,
    // which is the disjoint-credit question in MUSCLE_VOLUME_AUTHORITY and is
    // out of scope for the dose-scale change. If the family model is fixed,
    // this test should go red.
    const history = [
      session(hoursAgo(36), [
        {
          primaryMuscle: 'glutes',
          secondaryMuscles: ['hamstrings', 'erectors', 'traps', 'forearms', 'quads'],
          sets: sets(4, 0),
        },
      ]),
    ];
    const group = computeMuscleRecovery(history, 'traps', NOW, RECOVERY_CONFIG);
    const head = computeMuscleRecovery(history, 'upper_traps', NOW, RECOVERY_CONFIG);

    expect(head.dose).toBeCloseTo(group.dose * RECOVERY_CONFIG.secondaryDoseFactor, 10);
    expect(head.windowHours!).toBeLessThan(group.windowHours!);
    expect(group.status).not.toBe('fresh');
    expect(head.status).toBe('fresh');
  });
});

describe('trap recovery windows', () => {
  it('puts the whole trap family on the large-group window, not the default', () => {
    for (const muscle of ['traps', 'upper_traps', 'mid_lower_traps'] as const) {
      expect(RECOVERY_CONFIG.windowHoursByMuscle[muscle]).toBe(60);
    }
    // Same window as the groups loaded by the same pulling sets — a session
    // must not claim the upper back needs 60h and the traps 48h off one set.
    expect(RECOVERY_CONFIG.windowHoursByMuscle.traps).toBe(
      RECOVERY_CONFIG.windowHoursByMuscle.upper_back
    );
    expect(RECOVERY_CONFIG.windowHoursByMuscle.traps).toBeGreaterThan(
      RECOVERY_CONFIG.defaultWindowHours
    );
  });

  it('gives the traps a longer window than the small fast recoverers', () => {
    const heavy = [
      session(hoursAgo(50), [
        { primaryMuscle: 'traps', secondaryMuscles: [], sets: sets(5, 0) },
        { primaryMuscle: 'biceps', secondaryMuscles: [], sets: sets(5, 0) },
      ]),
    ];

    const traps = computeMuscleRecovery(heavy, 'traps', NOW, RECOVERY_CONFIG);
    const biceps = computeMuscleRecovery(heavy, 'biceps', NOW, RECOVERY_CONFIG);

    expect(traps.windowHours!).toBeGreaterThan(biceps.windowHours!);
    expect(traps.hoursUntilReady).toBeGreaterThan(biceps.hoursUntilReady);
    expect(traps.status).not.toBe('fresh');
  });
});
