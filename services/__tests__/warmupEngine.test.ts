/**
 * Warmup Readiness Engine — regression tests.
 *
 * The four contract scenarios (from the defect report):
 *   1. Arnold Press after 7 chest sets at 45 lb → exactly ONE
 *      rotation-focused ramp set (not zero, not a full protocol).
 *   2. First exercise of a session, cold, heavy compound → full ramp protocol.
 *   3. Third consecutive same-muscle exercise, moderate load, pattern + ROM
 *      already loaded → ZERO warmup sets WITH a stated reason.
 *   4. Same muscle but 40+ min elapsed → partial credit, decay applied.
 */

import {
  evaluateWarmupReadiness,
  canonicalizeMovementPattern,
  deriveRomDemands,
  warmthDecay,
  resolveWarmupLoad,
  WARMTH_HALF_LIFE_MINUTES,
  type WarmupExerciseMeta,
  type WarmupReadinessInput,
} from '../warmupEngine';

// ---- fixtures ----

const NOW = new Date('2026-07-27T10:00:00Z');

/** ISO timestamp `minutes` before NOW. */
const minsAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60000).toISOString();

const inclinePress: WarmupExerciseMeta = {
  id: 'ex-incline',
  name: 'Iso-Lateral Incline Press',
  primaryMuscle: 'chest_upper',
  secondaryMuscles: ['front_delts', 'triceps'],
  movementPattern: 'horizontal_push', // legacy token
  mechanic: 'compound',
};

const cableFly: WarmupExerciseMeta = {
  id: 'ex-fly',
  name: 'Cable Fly',
  primaryMuscle: 'chest_lower',
  secondaryMuscles: [],
  movementPattern: 'isolation_shoulder_horizontal_adduction',
  mechanic: 'isolation',
};

const arnoldPress: WarmupExerciseMeta = {
  id: 'ex-arnold',
  name: 'Arnold Press',
  primaryMuscle: 'front_delts',
  secondaryMuscles: ['lateral_delts', 'triceps'],
  movementPattern: 'compound', // useless legacy value — classifier must use the name
  mechanic: 'compound',
};

const pecDeck: WarmupExerciseMeta = {
  id: 'ex-pecdeck',
  name: 'Pec Deck',
  primaryMuscle: 'chest_lower',
  secondaryMuscles: [],
  movementPattern: 'isolation',
  mechanic: 'isolation',
};

const squat: WarmupExerciseMeta = {
  id: 'ex-squat',
  name: 'Barbell Back Squat',
  primaryMuscle: 'quads',
  secondaryMuscles: ['glutes', 'erectors'],
  movementPattern: 'squat',
  equipmentRequired: ['barbell'],
  mechanic: 'compound',
};

const blocks = [
  { id: 'b1', exercise: inclinePress },
  { id: 'b2', exercise: cableFly },
  { id: 'b3', exercise: arnoldPress },
  { id: 'b4', exercise: pecDeck },
];

const workingSet = (blockId: string, minutesAgo: number) => ({
  exerciseBlockId: blockId,
  loggedAt: minsAgo(minutesAgo),
  isWarmup: false,
  setType: 'normal' as const,
});

const baseInput = (overrides: Partial<WarmupReadinessInput>): WarmupReadinessInput => ({
  exercise: arnoldPress,
  workingWeightKg: 20.4, // 45 lb
  targetReps: 11,
  targetRir: 1,
  completedSets: [],
  blocks,
  now: NOW,
  isFirstExercise: false,
  ...overrides,
});

// The defect session: 4 incline press sets then 3 cable fly sets, recent.
const sevenChestSets = [
  workingSet('b1', 26),
  workingSet('b1', 23),
  workingSet('b1', 20),
  workingSet('b1', 17),
  workingSet('b2', 12),
  workingSet('b2', 8),
  workingSet('b2', 4),
];

// ---- regression scenario 1: the observed defect ----

describe('Arnold Press after 7 chest sets at 45 lb (the observed defect)', () => {
  const result = evaluateWarmupReadiness(
    baseInput({ completedSets: sevenChestSets })
  );

  it('produces exactly ONE targeted ramp set — not zero, not a full protocol', () => {
    expect(result.kind).toBe('targeted_ramp');
    expect(result.sets).toHaveLength(1);
  });

  it('the ramp set names WHY it exists (rotation not yet loaded)', () => {
    expect(result.sets[0].reason).toMatch(/rotation/i);
    expect(result.sets[0].reason).toMatch(/not yet loaded/i);
  });

  it('muscle temperature is PAID by the prior chest pressing', () => {
    expect(result.dimensions.muscleTemperature.paid).toBe(true);
  });

  it('movement pattern is UNPAID — horizontal pressing does not pay for vertical', () => {
    expect(result.dimensions.movementPattern.paid).toBe(false);
  });

  it('joint ROM is UNPAID — rotation demand unmet', () => {
    expect(result.dimensions.jointRom.paid).toBe(false);
    expect(result.dimensions.jointRom.unmetDemands).toContain('supination_pronation');
  });

  it('load ramp is not applicable at ~11 reps to failure', () => {
    expect(result.dimensions.loadRamp.paid).toBe(true);
  });

  it('ramp set is ~60% of working weight at 8–10 reps', () => {
    expect(result.sets[0].percentOfWorking).toBe(60);
    expect(result.sets[0].targetReps).toBeGreaterThanOrEqual(8);
    expect(result.sets[0].targetReps).toBeLessThanOrEqual(10);
  });

  it('decision reason is always present (no silent decision)', () => {
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ---- regression scenario 2: cold heavy compound ----

describe('first exercise of a session, cold, heavy compound', () => {
  const result = evaluateWarmupReadiness(
    baseInput({
      exercise: squat,
      workingWeightKg: 140,
      targetReps: 4,
      targetRir: 1,
      completedSets: [],
      isFirstExercise: true,
    })
  );

  it('prescribes a full ramp protocol', () => {
    expect(result.kind).toBe('full_protocol');
    expect(result.sets.length).toBeGreaterThanOrEqual(3);
  });

  it('all warmth dimensions are unpaid and the load ramp is required', () => {
    expect(result.dimensions.muscleTemperature.paid).toBe(false);
    expect(result.dimensions.movementPattern.paid).toBe(false);
    expect(result.dimensions.loadRamp.paid).toBe(false);
  });

  it('states its reason', () => {
    expect(result.reason).toMatch(/cold start/i);
  });
});

// ---- regression scenario 3: third consecutive same-muscle exercise ----

describe('third consecutive chest exercise at moderate load', () => {
  // Pec deck after incline press + cable fly: temperature paid, fly pattern
  // grooved by the cable fly, deep-stretch demand loaded by the cable fly.
  const result = evaluateWarmupReadiness(
    baseInput({
      exercise: pecDeck,
      workingWeightKg: 50,
      targetReps: 12,
      targetRir: 2,
      completedSets: sevenChestSets,
    })
  );

  it('prescribes ZERO warmup sets', () => {
    expect(result.kind).toBe('none');
    expect(result.sets).toHaveLength(0);
  });

  it('states the null decision with its reason — never renders silence', () => {
    expect(result.reason).toMatch(/no warmup needed/i);
    expect(result.reason).toMatch(/prior set/i);
  });
});

// ---- regression scenario 4: same muscle, 40+ minutes elapsed ----

describe('same muscle but 40+ min elapsed since last set', () => {
  const staleChestSets = [
    workingSet('b1', 52),
    workingSet('b1', 49),
    workingSet('b1', 46),
    workingSet('b1', 43),
  ];
  const result = evaluateWarmupReadiness(
    baseInput({
      exercise: pecDeck,
      workingWeightKg: 50,
      targetReps: 12,
      targetRir: 2,
      completedSets: staleChestSets,
    })
  );

  it('applies decay: partial credit, not full warmth and not zero', () => {
    const score = result.dimensions.muscleTemperature.score;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
    expect(result.dimensions.muscleTemperature.paid).toBe(false);
  });

  it('prescribes a shortened protocol (decay applied), not a cold-start full protocol', () => {
    expect(result.kind).toBe('partial_protocol');
    expect(result.sets.length).toBeGreaterThan(0);
    const fullCold = evaluateWarmupReadiness(
      baseInput({
        exercise: pecDeck,
        workingWeightKg: 50,
        targetReps: 12,
        targetRir: 2,
        completedSets: [],
      })
    );
    expect(result.sets.length).toBeLessThan(fullCold.sets.length);
  });
});

// ---- decision visibility & session scoping ----

describe('decision visibility and scoping rules', () => {
  it('every decision kind carries a non-empty reason', () => {
    const scenarios = [
      baseInput({ completedSets: [] }),
      baseInput({ completedSets: sevenChestSets }),
      baseInput({ exercise: pecDeck, completedSets: sevenChestSets, workingWeightKg: 50, targetReps: 12, targetRir: 2 }),
    ];
    for (const input of scenarios) {
      const d = evaluateWarmupReadiness(input);
      expect(d.reason.trim().length).toBeGreaterThan(0);
      expect(d.dimensions.muscleTemperature.reason.length).toBeGreaterThan(0);
      expect(d.dimensions.movementPattern.reason.length).toBeGreaterThan(0);
      expect(d.dimensions.jointRom.reason.length).toBeGreaterThan(0);
      expect(d.dimensions.loadRamp.reason.length).toBeGreaterThan(0);
    }
  });

  it('warmth is session-scoped by contract: no completed sets → no credit', () => {
    const d = evaluateWarmupReadiness(baseInput({ completedSets: [] }));
    expect(d.dimensions.muscleTemperature.score).toBe(0);
    expect(d.kind).toBe('full_protocol');
  });

  it('warmup-type prior sets earn reduced credit and no secondary-muscle credit', () => {
    const warmupOnly = [
      { exerciseBlockId: 'b1', loggedAt: minsAgo(5), isWarmup: true, setType: 'warmup' },
      { exerciseBlockId: 'b1', loggedAt: minsAgo(4), isWarmup: true, setType: 'warmup' },
    ];
    // Arnold's primary (front_delts) only overlaps incline press via
    // SECONDARY muscles — warmup sets must not credit it at all.
    const d = evaluateWarmupReadiness(baseInput({ completedSets: warmupOnly }));
    expect(d.dimensions.muscleTemperature.score).toBe(0);
  });

  it('a heavy top set forces a load ramp even when fully warm', () => {
    const heavySquats = [
      { id: 'b-squat-1', exercise: { ...squat, id: 'ex-squat-other', name: 'Hack Squat', movementPattern: 'squat' } },
    ];
    const d = evaluateWarmupReadiness(
      baseInput({
        exercise: squat,
        workingWeightKg: 150,
        e1rmKg: 160,
        targetReps: 3,
        targetRir: 1,
        blocks: heavySquats,
        completedSets: [
          { exerciseBlockId: 'b-squat-1', loggedAt: minsAgo(5), isWarmup: false, setType: 'normal' },
          { exerciseBlockId: 'b-squat-1', loggedAt: minsAgo(9), isWarmup: false, setType: 'normal' },
          { exerciseBlockId: 'b-squat-1', loggedAt: minsAgo(13), isWarmup: false, setType: 'normal' },
        ],
      })
    );
    expect(d.dimensions.loadRamp.paid).toBe(false);
    expect(d.sets.length).toBeGreaterThan(0);
    expect(d.kind).toBe('targeted_ramp');
  });
});

// ---- decay curve ----

describe('warmthDecay', () => {
  it('halves at the half-life', () => {
    expect(warmthDecay(WARMTH_HALF_LIFE_MINUTES)).toBeCloseTo(0.5, 5);
  });
  it('is 1.0 at zero elapsed', () => {
    expect(warmthDecay(0)).toBe(1);
  });
  it('is ~0.16 at 40 minutes with the 15-minute half-life', () => {
    expect(warmthDecay(40)).toBeGreaterThan(0.1);
    expect(warmthDecay(40)).toBeLessThan(0.2);
  });
});

// ---- classifiers ----

describe('canonicalizeMovementPattern', () => {
  it('maps legacy tokens', () => {
    expect(canonicalizeMovementPattern(inclinePress)).toBe('horizontal_press');
    expect(canonicalizeMovementPattern(squat)).toBe('squat');
    expect(
      canonicalizeMovementPattern({ id: 'x', name: 'Romanian Deadlift', primaryMuscle: 'hamstrings', movementPattern: 'hip_hinge' })
    ).toBe('hinge');
  });

  it('classifies customs by name when the stored pattern is useless', () => {
    expect(canonicalizeMovementPattern(arnoldPress)).toBe('vertical_press');
    expect(canonicalizeMovementPattern(pecDeck)).toBe('isolation_shoulder_horizontal_adduction');
    expect(
      canonicalizeMovementPattern({ id: 'x', name: 'Iso-Lateral Incline Press', primaryMuscle: 'chest_upper', movementPattern: 'compound' })
    ).toBe('horizontal_press');
  });

  it('keeps antagonist isolation patterns distinct', () => {
    const curl = canonicalizeMovementPattern({ id: 'x', name: 'Dumbbell Curl', primaryMuscle: 'biceps', movementPattern: 'isolation' });
    const pushdown = canonicalizeMovementPattern({ id: 'y', name: 'Cable Tricep Pushdown', primaryMuscle: 'triceps', movementPattern: 'isolation' });
    expect(curl).toBe('isolation_elbow_flexion');
    expect(pushdown).toBe('isolation_elbow_extension');
    expect(curl).not.toBe(pushdown);
  });

  it('returns null for unclassifiable exercises (dimension stays conservatively unpaid)', () => {
    expect(
      canonicalizeMovementPattern({ id: 'x', name: 'Mystery Machine Thing', primaryMuscle: 'chest', movementPattern: '' })
    ).toBeNull();
  });
});

describe('deriveRomDemands', () => {
  it('prefers the stored rom_demands column when populated', () => {
    const stored = deriveRomDemands({ ...arnoldPress, romDemands: ['overhead'] });
    expect(stored).toEqual(['overhead']);
  });

  it('derives rotation + overhead for Arnold Press from the name', () => {
    const demands = deriveRomDemands(arnoldPress);
    expect(demands).toContain('supination_pronation');
    expect(demands).toContain('overhead');
  });

  it('derives deep stretch for flys', () => {
    expect(deriveRomDemands(cableFly)).toContain('deep_stretch');
  });

  it('derives hinge end-range for RDLs', () => {
    const demands = deriveRomDemands({ id: 'x', name: 'Romanian Deadlift', primaryMuscle: 'hamstrings', movementPattern: 'hip_hinge' });
    expect(demands).toContain('hip_hinge_deep');
  });
});

// ---- vocabulary bridge (backfill interop) ----

import { canonicalizePatternToken, legacyPatternFamily } from '../warmupEngine';

describe('canonicalizePatternToken / legacyPatternFamily (vocabulary bridge)', () => {
  it('maps legacy tokens to canonical so mixed-vocab rows compare equal', () => {
    expect(canonicalizePatternToken('horizontal_push')).toBe('horizontal_press');
    expect(canonicalizePatternToken('horizontal_press')).toBe('horizontal_press');
    expect(canonicalizePatternToken('hip_hinge')).toBe('hinge');
    expect(canonicalizePatternToken('elbow_flexion')).toBe('isolation_elbow_flexion');
    // A legacy-valued custom row equals a backfilled canonical seed row
    expect(canonicalizePatternToken('vertical_push')).toBe(canonicalizePatternToken('vertical_press'));
  });

  it('passes unknown free text through instead of guessing', () => {
    expect(canonicalizePatternToken('compound')).toBe('compound');
    expect(canonicalizePatternToken('')).toBe('');
    expect(canonicalizePatternToken(null)).toBe('');
  });

  it('bridges canonical tokens back to the legacy families the SFR/fatigue tables know', () => {
    expect(legacyPatternFamily('horizontal_press')).toBe('horizontal_push');
    expect(legacyPatternFamily('hinge')).toBe('hip_hinge');
    expect(legacyPatternFamily('isolation_elbow_flexion')).toBe('elbow_flexion');
    expect(legacyPatternFamily('isolation_ankle_plantar')).toBe('calf_raise');
    expect(legacyPatternFamily('isolation_shoulder_horizontal_adduction')).toBe('shoulder_isolation');
    // Tokens the tables never had a row for fall to the isolation bucket
    expect(legacyPatternFamily('isolation_knee_extension')).toBe('isolation');
    // Legacy input works too (canonicalized on the way in)
    expect(legacyPatternFamily('horizontal_push')).toBe('horizontal_push');
    expect(legacyPatternFamily('squat')).toBe('squat');
  });
});

// ---- Codex review fixes (PR #551) ----

describe('cold muscle with a grooved pattern on a DIFFERENT muscle (review fix)', () => {
  // Biceps curls groove isolation_elbow_flexion; a following forearm
  // reverse curl shares the pattern but has zero muscle overlap. The null
  // decision must never fire for a cold muscle.
  const bicepsCurl: WarmupExerciseMeta = {
    id: 'ex-curl',
    name: 'Dumbbell Curl',
    primaryMuscle: 'biceps',
    secondaryMuscles: [],
    movementPattern: 'elbow_flexion',
    mechanic: 'isolation',
  };
  const reverseCurl: WarmupExerciseMeta = {
    id: 'ex-reverse-curl',
    name: 'EZ Bar Reverse Curl',
    primaryMuscle: 'forearms',
    secondaryMuscles: [],
    movementPattern: 'elbow_flexion',
    mechanic: 'isolation',
  };
  const curlBlocks = [
    { id: 'b-curl', exercise: bicepsCurl },
    { id: 'b-reverse', exercise: reverseCurl },
  ];
  const result = evaluateWarmupReadiness(
    baseInput({
      exercise: reverseCurl,
      workingWeightKg: 30,
      targetReps: 10,
      targetRir: 2,
      blocks: curlBlocks,
      completedSets: [workingSet('b-curl', 8), workingSet('b-curl', 5), workingSet('b-curl', 2)],
    })
  );

  it('pattern is paid but temperature is not', () => {
    expect(result.dimensions.movementPattern.paid).toBe(true);
    expect(result.dimensions.muscleTemperature.paid).toBe(false);
  });

  it('never returns the null decision for a cold muscle — prescribes a protocol', () => {
    expect(result.kind).not.toBe('none');
    expect(result.sets.length).toBeGreaterThan(0);
  });
});

describe('working sets already logged on the target exercise (review fix)', () => {
  it('returns an explicit null decision once a working set is logged, not a stale cold protocol', () => {
    const result = evaluateWarmupReadiness(
      baseInput({
        completedSets: [workingSet('b3', 3)], // b3 = the Arnold Press block itself
      })
    );
    expect(result.kind).toBe('none');
    expect(result.sets).toHaveLength(0);
    expect(result.reason).toMatch(/working sets already logged/i);
  });

  it('covers duplicate blocks of the same exercise', () => {
    const dupBlocks = [...blocks, { id: 'b3-dup', exercise: arnoldPress }];
    const result = evaluateWarmupReadiness(
      baseInput({
        blocks: dupBlocks,
        completedSets: [workingSet('b3-dup', 10)],
      })
    );
    expect(result.kind).toBe('none');
    expect(result.reason).toMatch(/working sets already logged/i);
  });

  it('a logged warmup-type set on the target does NOT count as being past warmup', () => {
    const result = evaluateWarmupReadiness(
      baseInput({
        completedSets: [
          { exerciseBlockId: 'b3', loggedAt: minsAgo(2), isWarmup: true, setType: 'warmup' },
        ],
      })
    );
    expect(result.kind).not.toBe('none');
  });
});

// ============================================
// resolveWarmupLoad — percent → loadable number
// ============================================

describe('resolveWarmupLoad', () => {
  describe('externally loaded exercises', () => {
    it('is the plain percentage of the working load', () => {
      const r = resolveWarmupLoad({
        percentOfWorking: 60,
        workingLoadKg: 100,
        mode: 'external',
      });
      expect(r.dimension).toBe('external');
      expect(r.dimensionKg).toBeCloseTo(60);
      expect(r.effectiveKg).toBeCloseTo(60);
      expect(r.clamped).toBe(false);
    });

    it('falls back to the external reading when bodyweight is unknown', () => {
      // Without a bodyweight the effective load cannot be decomposed — better
      // the old number than an invented composition.
      const r = resolveWarmupLoad({
        percentOfWorking: 60,
        workingLoadKg: 100,
        mode: 'weighted',
      });
      expect(r.dimension).toBe('external');
      expect(r.dimensionKg).toBeCloseTo(60);
    });
  });

  describe('weighted bodyweight (belt/vest)', () => {
    it('resolves the percentage onto the ADDED weight, not the effective load', () => {
      // 98 kg lifter + 20 kg belt = 118 kg working. 85% = 100.3 kg effective,
      // which is 2.3 kg on the belt — NOT "100 kg" on a chin-up bar.
      const r = resolveWarmupLoad({
        percentOfWorking: 85,
        workingLoadKg: 118,
        mode: 'weighted',
        userBodyweightKg: 98,
      });
      expect(r.dimension).toBe('added');
      expect(r.dimensionKg).toBeCloseTo(2.3, 1);
      expect(r.effectiveKg).toBeCloseTo(100.3, 1);
      expect(r.clamped).toBe(false);
    });

    it('floors at bodyweight when the percentage lands below it', () => {
      // The reported defect: a 60% ramp on a 98 kg bodyweight movement
      // rendered "51 kg" — a load that lifter cannot produce.
      const r = resolveWarmupLoad({
        percentOfWorking: 60,
        workingLoadKg: 98,
        mode: 'weighted',
        userBodyweightKg: 98,
      });
      expect(r.dimension).toBe('none');
      expect(r.dimensionKg).toBe(0);
      expect(r.effectiveKg).toBe(98);
      expect(r.clamped).toBe(true);
    });

    it('does not flag the top set itself as clamped', () => {
      const r = resolveWarmupLoad({
        percentOfWorking: 100,
        workingLoadKg: 98,
        mode: 'weighted',
        userBodyweightKg: 98,
      });
      expect(r.clamped).toBe(false);
    });
  });

  describe('assisted bodyweight', () => {
    it('a lighter ramp means MORE assistance', () => {
      // 98 kg lifter, 18 kg assistance = 80 kg working. 60% = 48 kg effective,
      // i.e. 50 kg of assistance.
      const r = resolveWarmupLoad({
        percentOfWorking: 60,
        workingLoadKg: 80,
        mode: 'assisted',
        userBodyweightKg: 98,
      });
      expect(r.dimension).toBe('assistance');
      expect(r.dimensionKg).toBeCloseTo(50);
      expect(r.effectiveKg).toBeCloseTo(48);
    });

    it('caps assistance below full unloading and says so', () => {
      const r = resolveWarmupLoad({
        percentOfWorking: 0,
        workingLoadKg: 80,
        mode: 'assisted',
        userBodyweightKg: 100,
      });
      expect(r.dimensionKg).toBeCloseTo(90); // 90% of bodyweight
      expect(r.clamped).toBe(true);
    });
  });

  describe('pure bodyweight', () => {
    it('has no lighter option — every ramp step is bodyweight', () => {
      const r = resolveWarmupLoad({
        percentOfWorking: 50,
        workingLoadKg: 98,
        mode: 'bodyweight',
        userBodyweightKg: 98,
      });
      expect(r.dimension).toBe('none');
      expect(r.dimensionKg).toBe(0);
      expect(r.effectiveKg).toBe(98);
      expect(r.clamped).toBe(true);
    });
  });
});
